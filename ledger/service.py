"""`ledger service run` and `ledger service check`: the Dolt service of the research ledger as compose runs it
(docs/plans/ledger-compose-service.zh.md).

`run` stays in the foreground for the container's life, with the Dolt server as its child. With no
service.json it bootstraps, and only into an empty service directory, an empty data directory and a
profile directory without profiles (anything else is BOOTSTRAP_REFUSED and nothing is touched):

- the DoltHub key is installed first (none is DOLTHUB_CREDENTIALS, before anything is downloaded);
- `research` is made from its public copy's `main`, the ledger in use, which stays its `origin`: only that branch is
  fetched, into the local `main` (`dolt init`, a fetch of one refspec, `reset --hard`; a clone would copy every
  archived line's data too). It must be a ledger of this version's line (its line tag, publish.LINE). An active or
  isolated service whose copy holds no `main` yet makes a new ledger instead, with that copy as `origin`, and
  publishes it before anything else can write. One whose `main` holds the ledger of an earlier line starts this
  line (docs/plans/main-is-the-ledger-in-use-20261123.zh.md): it pushes that `main` to the branch named after its
  line and checks it (publish.archive, never forced), then makes a new ledger and puts it on `main` in its place
  (publish.replace, the one forced push). A mirror only ever copies a `main` of its own line;
- its schema version is checked before any account exists;
- root gets its password and `'root'@'%'` (the published port and the other containers are not
  localhost), the service is secured, the database gets its accounts as `ledger init` would make them;
- the profile and then service.json (no socket: a service compose runs) are written last, after a new ledger is on
  `main`: until then `check` fails, and every start that finds service.json finds a published ledger.

A bootstrap that fails or is stopped removes what it made (the directories were empty) and raises; one killed midway
leaves files without service.json, so later starts are BOOTSTRAP_REFUSED (deploy/README.md, First start). With a
service.json it checks before serving: every recorded database, the schema version of each profile's
database; any failure stops the server and is SERVICE_CHECK_FAILED.
config.yaml is written from the arguments at every start: the data directory may be a volume only the
container sees (a Dolt lock does not reach the host across a Docker Desktop bind mount, measured). It keeps
Dolt's automatic garbage collection on: Dolt collects only chunks no branch, tag or working set reaches,
so history stays whole while discarded working sets stop filling the disk. A later start first empties
`<data>/.dolt/tmp`, where an interrupted Dolt transfer leaves its buffer file (1.59 GB, measured); neither
a restart nor a collection removes it, and before the server starts nothing holds it.
With --readers, every start writes `<readers>/service.json` before serving: only the port and each
database's reader account, for a container that only reads (the IDE), which never sees service.json. With
--controllers it also writes the Paper controller's directory (write_controllers): Paper's two accounts and the
research reader, never the administrator.
Every start of a writable service (not a mirror, which makes its own) also makes the Paper database `paper`
(ledger/paper.sql, an isolated profile) when the service lacks it: Paper's execution records never enter the
research ledger.
With --setup, a first start that lacks or fails on the repository or the key waits on the IDE's page instead of
exiting (`ledger.first_run`); a later start is unchanged.

While it serves, `run` publishes the ledger every PUBLISH_RETRY seconds when origin is behind it: commands that
change the ledger only commit locally, so these rounds (and `ledger publish`) are what publishes, and the public copy
lags the ledger by up to one round and a push. What is still behind shows on the IDE's page. In the same rounds it syncs
the Paper database's backup when Paper's head moved (`ledger mirror` too): Paper's containers hold no administrator,
and dolt_backup needs one.
"""

from __future__ import annotations

from collections.abc import Callable
import os
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import threading

import pymysql

from ledger import admin, db, first_run, publish, server
from shared import paths, profiles
from shared.version import order
from shared.errors import Refusal
from shared.refusals import refuse

PORT = 13330
LISTEN = "0.0.0.0"  # inside its container; compose publishes the port on the host's loopback only
LEDGER = "research"  # the profile and database name
PAPER = "paper"  # the Paper database's profile and database name, on the same service
PUBLISH_RETRY = 300  # seconds between checks that origin holds the ledger; the check reads locally, a push follows


def _launch(binary: str, service_root: Path, log) -> subprocess.Popen:
    return subprocess.Popen([binary, "sql-server", "--config", str(service_root / "config.yaml")], cwd=service_root,
                            env=server.dolt_env(service_root / "home"), stdin=subprocess.DEVNULL, stdout=log,
                            stderr=log)


def _empty(directory: Path) -> bool:
    """No file under `directory`: empty directories, such as the run directory paper's mount makes, count."""
    return not directory.exists() or (directory.is_dir() and all(path.is_dir() and not path.is_symlink()
                                                                  for path in directory.rglob("*")))


def _clear(directory: Path, kept: frozenset[Path] = frozenset()) -> None:
    """Remove what is inside `directory` (it may be a mount point, kept); the directories `kept` stay, emptied."""
    if directory.is_dir():
        for child in directory.iterdir():
            if child in kept:
                _clear(child)
            elif child.is_dir() and not child.is_symlink():
                shutil.rmtree(child)
            else:
                child.unlink()


def _root_anywhere(cursor, password: str) -> None:
    """root from beyond localhost (the published port, the other containers), with root's password;
    one already there is left as it is."""
    cursor.execute("CREATE USER IF NOT EXISTS 'root'@'%%' IDENTIFIED BY %s", (password,))
    cursor.execute("GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION")


def _root_admin(cursor) -> None:
    """Admin on every branch for root from beyond localhost (a database must be selected)."""
    cursor.execute("INSERT IGNORE INTO dolt_branch_control VALUES ('%', '%', 'root', '%', 'admin')")


def _check_database(cursor, database: str, holds: str = "research") -> None:
    """The database's schema version is the one this code reads."""
    version, expected = server.cursor_rows(cursor, f"SELECT version FROM `{database}`.ledger_schema WHERE singleton = 1"), \
        db.SCHEMAS[holds][1]
    if version != [(expected,)]:
        raise refuse("SERVICE_CHECK_FAILED", f"{database} holds schema version {version[0][0] if version else None}, "
                                             f"this code reads {expected}", missing=(database,))


def _refuse_unless_empty(service_root: Path, data_dir: Path) -> None:
    if not (_empty(service_root) and _empty(data_dir) and not any(profiles.home().glob("*.json"))):
        raise refuse("BOOTSTRAP_REFUSED", f"no service.json in {service_root}, but it, the data directory {data_dir} "
                                          f"or the profile directory {profiles.home()} is not empty; nothing was changed",
                     missing=(str(service_root / "service.json"),))


def bootstrap(service_root: Path, data_dir: Path, backup_root: Path, credentials: Path | None,
              origin: str | None, port: int, binary: str, kind: str | None, log,
              say: Callable[[str], None] = first_run.log) -> tuple[subprocess.Popen, dict]:
    """The new service with `research` made from origin's `main` (or new, when a publishing service finds `origin`
    without one or with an earlier line's), its accounts, service.json and profile; returns the running server and
    the configuration. `say` hears each step."""
    _refuse_unless_empty(service_root, data_dir)
    if not origin:
        raise refuse("USAGE_ERROR", "a first start needs --research-origin, the DoltHub repository of this ledger "
                                    "(TRADE_RESEARCH_ORIGIN in deploy/.env): an empty one starts a new ledger",
                     expected="https://doltremoteapi.dolthub.com/<owner>/<repository>")
    if kind is not None and (credentials is None or not (credentials / "config_global.json").is_file()):
        raise refuse("DOLTHUB_CREDENTIALS", f"no DoltHub key (a `dolt login` ~/.dolt) at {credentials}; the active "
                                            "ledger publishes every write", missing=("TRADE_DOLTHUB",))
    if kind == "active":
        for path in (service_root, data_dir, backup_root):
            if paths.inside(path, paths.REPOSITORY) or paths.is_temporary(path):
                raise refuse("ISOLATION_BREACH", "an active service keeps its data and backups outside the source "
                                                 "checkout and temporary roots", missing=(str(path),))
    profile = profiles.home() / f"{LEDGER}.json"
    kept = {path: frozenset(path.iterdir() if path.is_dir() else ()) for path in (service_root, data_dir)}
    process = None
    try:
        for directory in (service_root / "cfg", service_root / "home", data_dir):
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(service_root, 0o700)
        environment = server.dolt_env(service_root / "home")
        server.dolt_home(service_root / "home", {**server.QUIET, **server.IDENTITY})
        if kind is not None:
            assert credentials is not None  # checked before any directory was created
            publish.install_key(service_root, credentials)
        say(f"reading main of {origin}")
        new, replacing = _from_main(binary, data_dir / LEDGER, environment, origin, kind, say)
        if new:
            shutil.rmtree(data_dir / LEDGER)
        server.write_config(service_root, data_dir, LISTEN, port, auto_gc=True)
        config: dict = {"binary": binary, "port": port, "root_password": secrets.token_urlsafe(24), "databases": {},
                        "secured": False}
        process = _launch(binary, service_root, log)
        server.wait_ready(config, lambda: process.poll() is None, password="", seconds=60)
        conn = server.connect_root(config, password="")
        try:
            with conn.cursor() as cursor:
                cursor.execute("ALTER USER 'root'@'localhost' IDENTIFIED BY %s", (config["root_password"],))
                _root_anywhere(cursor, config["root_password"])
        finally:
            conn.close()
        conn = server.connect_root(config)
        try:
            with conn.cursor() as cursor:
                if new:
                    say(f"{origin} is empty: making a new ledger")
                    cursor.execute(f"CREATE DATABASE `{LEDGER}`")
                    cursor.execute(f"USE `{LEDGER}`")
                    db.ledger_schema(cursor)
                    cursor.execute("CALL DOLT_REMOTE('add', %s, %s)", (server.REMOTE, origin))
                try:
                    _check_database(cursor, LEDGER)
                except pymysql.MySQLError as exc:
                    raise refuse("BOOTSTRAP_FAILED", f"{origin} does not hold a research ledger: {exc.args[-1]}",
                                 missing=(origin,)) from exc
                cursor.execute(f"USE `{LEDGER}`")
                accounts = {role: {"user": db.account_name(LEDGER, role), "password": secrets.token_urlsafe(24)}
                            for role in db.ROLES}
                db.clear_accounts(cursor, LEDGER, accounts)
                db.secure(cursor, config)
                config["secured"] = True
                _root_admin(cursor)
                db.ledger_accounts(cursor, LEDGER, accounts)
                if kind is None:
                    # A public research replica has no writer account or publishing key.
                    cursor.execute("DELETE FROM dolt_branch_control WHERE `database` = %s AND user = %s",
                                   (LEDGER, accounts["writer"]["user"]))
                    cursor.execute(f"DROP USER '{accounts['writer']['user']}'@'%'")
                    del accounts["writer"]
                config["databases"][LEDGER] = accounts
        finally:
            conn.close()
        made = db.LedgerProfile(name=LEDGER, database=LEDGER, service_root=service_root, kind=kind,
                                backup_root=backup_root / LEDGER)
        if new:
            say(f"publishing the new ledger to {origin}" + (" in place of the earlier line's" if replacing else ""))
            # A key or repository that cannot take it stops here, with nothing lost.
            (publish.replace if replacing else publish.publish)(made, config)
        profiles.private_write(profile, made.as_json())
        profiles.private_write(service_root / "service.json", config)
        say("bootstrapped")
        return process, config
    except BaseException:
        if process is not None:
            server.stop(process)
        # First: killed while clearing, it must not leave a service.json over cleared data.
        (service_root / "service.json").unlink(missing_ok=True)
        profile.unlink(missing_ok=True)
        _clear(data_dir, kept[data_dir])
        _clear(service_root, kept[service_root])
        raise


def _from_main(binary: str, directory: Path, environment: dict, origin: str, kind: str | None,
               say: Callable[[str], None]) -> tuple[bool, bool]:
    """Read origin's `main` into `directory` (publish.read_main): a ledger of this line stays there as the ledger
    (False, False); a publishing service makes a new one when origin has no `main` (True, False) or, after archiving
    it under its line's name, when `main` holds an earlier line's (True, True). Anything else is BOOTSTRAP_FAILED.
    The collection drops `init`'s own commit and main's reflog with it, and the second reset records the bootstrap as
    main's first move (ledger/replica.py _history), as a clone did (Dolt 2.7.2)."""
    try:
        main = publish.read_main(binary, directory, environment, origin)
        if main is not None and main["line"] == publish.LINE:
            for arguments in (("gc",), ("reset", "--hard", publish.TRACKING)):
                publish.dolt_cli(binary, directory, environment, *arguments)
            return False, False
        if kind is None or (main is not None and (
                main["line"] is None or order(main["line"]) >= order(publish.LINE))):
            found = "no main" if main is None else f"main of line {main['line'] or 'unknown (no line tag)'}"
            raise refuse("BOOTSTRAP_FAILED", f"{origin} holds {found}, not a ledger of line {publish.LINE}",
                         missing=(origin,))
        if main is not None:
            say(f"archiving line {main['line']} of {origin} as its branch {main['line']}")
            publish.archive(binary, directory, environment, main["line"], main["head"])
        return True, main is not None
    except publish.DoltFailed as failed:
        raise refuse("BOOTSTRAP_FAILED", f"reading main of {origin} failed: {str(failed)[-300:]}",
                     missing=(origin,)) from failed


def _check_service(service_root: Path, config: dict) -> None:
    """The checks of every start: every database service.json records, held by the service and named by a ledger
    profile of this service directory, and the schema version of each such profile's database. A recorded database
    without one (a data directory moved while its profiles name the old one, #3695) is refused, never served
    unchecked."""
    recorded = config.get("databases", {})
    conn = server.connect_root(config)
    try:
        with conn.cursor() as cursor:
            present = {name.lower() for (name,) in server.cursor_rows(cursor, "SHOW DATABASES")}
            missing = sorted(name for name in recorded if name.lower() not in present)
            if missing:
                raise refuse("SERVICE_CHECK_FAILED", f"service.json records databases the service does not hold: "
                                                     f"{', '.join(missing)}", missing=tuple(missing))
            checked = set()
            for profile in db.profiles().values():
                if Path(profile.service_root).resolve() == service_root.resolve():
                    _check_database(cursor, profile.database, profile.holds)
                    checked.add(profile.database.lower())
            unnamed = sorted(name for name in recorded if name.lower() not in checked)
            if unnamed:
                raise refuse("SERVICE_CHECK_FAILED", f"service.json records databases no ledger profile in "
                                                     f"{profiles.home()} names at {service_root}: "
                                                     f"{', '.join(unnamed)}; put each one's profile there, naming "
                                                     f"this service directory, and start again",
                             missing=tuple(unnamed))
    finally:
        conn.close()


def paper_database(service_root: Path, backup_root: Path, binary: str | None = None) -> dict:
    """The service's Paper database (ledger/paper.sql, profile and database PAPER), made empty at a start that lacks
    it; returns the service configuration. Paper's execution records never enter the research ledger."""
    if PAPER not in server.known_service(service_root).get("databases", {}):
        db.init(PAPER, PAPER, service_root, "isolated", backup_root=backup_root / PAPER,
                dolt_binary=Path(binary) if binary else None, holds="paper")
    found = db.load_profile(PAPER)
    if (found.holds != "paper" or found.database != PAPER or found.kind != "isolated"
            or found.service_root.resolve() != service_root.resolve()):
        raise refuse("SERVICE_CHECK_FAILED", f"profile {PAPER} is not this service's Paper database",
                     missing=(PAPER,))
    return server.known_service(service_root)


def write_readers(readers: Path, config: dict) -> None:
    """`<readers>/service.json` for a container that only reads (docs/plans/ide-reads-ledger-service.zh.md):
    the port and each database's reader account, derived from service.json at every start. No root
    password, writer account, binary or socket, so a profile naming this directory reaches the service
    over TCP and can only read."""
    readers.mkdir(mode=0o700, parents=True, exist_ok=True)
    profiles.private_write(readers / "service.json", {
        "port": config["port"],
        "databases": {name: {"reader": accounts["reader"]} for name, accounts in config["databases"].items()}})


def write_controllers(controllers: Path, service_root: Path, backup_root: Path, config: dict) -> None:
    """`<controllers>/` for the Paper controller, which mounts it read-only at the service directory and as its
    profile directory: service.json with the port, the Paper database's writer and reader and the research
    reader (never the administrator, a research writer or a DoltHub key), the two profiles, and the empty
    `paper/` mountpoint Docker needs for the writable run directory beneath the read-only mount."""
    controllers.mkdir(parents=True, mode=0o700, exist_ok=True)
    (controllers / "paper").mkdir(mode=0o700, exist_ok=True)
    profiles.private_write(controllers / "service.json", {
        "port": config["port"], "databases": {
            LEDGER: {"reader": config["databases"][LEDGER]["reader"]}, PAPER: config["databases"][PAPER]}})
    profiles.private_write(controllers / f"{LEDGER}.json", db.LedgerProfile(
        LEDGER, LEDGER, service_root, kind=None).as_json())
    profiles.private_write(controllers / f"{PAPER}.json", db.LedgerProfile(
        PAPER, PAPER, service_root, kind="isolated", backup_root=backup_root / PAPER, holds="paper").as_json())


def start(service_root: Path, data_dir: Path, backup_root: Path, credentials: Path | None, origin: str | None,
          port: int = PORT, binary: str | None = None, kind: str | None = "active", log=None,
          readers: Path | None = None, say: Callable[[str], None] = first_run.log,
          controllers: Path | None = None) -> tuple[subprocess.Popen, dict]:
    """Bootstrap or check the service and return its running server (the caller waits on it); with
    `readers`, write the reader-only service file there before serving, and with `controllers` (a writable
    service only) the Paper controller's (write_controllers)."""
    service_root, data_dir = Path(service_root).absolute(), Path(data_dir).absolute()
    backup_root = Path(backup_root).absolute()
    for option, directory in (("--readers", readers), ("--controllers", controllers)):
        if directory is not None and Path(directory).absolute().resolve() == service_root.resolve():
            raise refuse("USAGE_ERROR", f"{option} names the service directory: its service.json is not replaced")
    if controllers is not None and kind is None:
        raise refuse("USAGE_ERROR", "--controllers needs a writable service, which holds the Paper database")
    binary = server.binary(binary)
    config = server.service_config(service_root)
    if config is None:
        process, config = bootstrap(service_root, data_dir, backup_root, credentials, origin, port, binary, kind, log,
                                   say)
        return process, _serve_readers(process, readers, controllers, service_root, backup_root,
                                      _with_paper(process, config, service_root, backup_root, binary, kind))
    if not server.managed(config) or int(config["port"]) != port:
        raise refuse("SERVICE_CHECK_FAILED", f"{service_root}/service.json names a socket or port "
                                             f"{config.get('port')}, not a service compose runs on port {port}",
                     missing=(str(service_root / "service.json"),))
    if credentials is not None and (credentials / "config_global.json").is_file():
        publish.install_key(service_root, credentials)
    server.write_config(service_root, data_dir, LISTEN, port, auto_gc=True)
    _clear(data_dir / ".dolt" / "tmp")
    process = _launch(binary, service_root, log)
    try:
        server.wait_ready(config, lambda: process.poll() is None, seconds=60)
        _check_service(service_root, config)
    except BaseException:
        server.stop(process)
        raise
    first_run.log(f"serving on port {port}")
    return process, _serve_readers(process, readers, controllers, service_root, backup_root,
                                  _with_paper(process, config, service_root, backup_root, binary, kind))


def _with_paper(process: subprocess.Popen, config: dict, service_root: Path, backup_root: Path, binary: str,
                kind: str | None) -> dict:
    """A writable service (kind not None) holds the Paper database beside the ledger; a mirror makes its own."""
    if kind is None:
        return config
    try:
        return paper_database(service_root, backup_root, binary)
    except BaseException:
        server.stop(process)
        raise


def _serve_readers(process: subprocess.Popen, readers: Path | None, controllers: Path | None, service_root: Path,
                   backup_root: Path, config: dict) -> dict:
    try:
        if readers is not None:
            write_readers(Path(readers).absolute(), config)
        if controllers is not None:
            write_controllers(Path(controllers).absolute(), service_root, backup_root, config)
    except BaseException:
        server.stop(process)
        raise
    return config


def _first_start(service_root: Path, data_dir: Path, backup_root: Path, credentials: Path | None, origin: str | None,
                 port: int, readers: Path | None, setup: str, controllers: Path | None = None) -> subprocess.Popen:
    """The server of a first start the IDE's page finishes (`ledger.first_run`)."""
    if credentials is None:
        raise refuse("USAGE_ERROR", "ledger service run --setup needs --credentials, the directory of the DoltHub key")
    binary = server.binary(None)
    return first_run.serve(
        setup, origin or None, Path(credentials), binary, LISTEN,
        lambda: _refuse_unless_empty(Path(service_root).absolute(), Path(data_dir).absolute()),
        lambda chosen, say: start(service_root, data_dir, backup_root, credentials, chosen, port, binary,
                                  readers=readers, say=say, controllers=controllers)[0])


def _publish_if_behind() -> None:
    """Publish the ledger once when origin is behind it. It never raises: the server outlives any failure, and the
    next round tries again. A refused publish stays visible through `publish.state`."""
    try:
        profile = db.load_profile(LEDGER)
        if profile.kind is not None and publish.unpublished(profile):
            first_run.log(f"published {publish.publish(profile)['head']}, which origin was behind")
    except Refusal as exc:
        first_run.log(f"publish retry refused: {exc}")
    except Exception as exc:  # a connection lost mid-push, for one
        first_run.log(f"publish retry failed: {type(exc).__name__}: {exc}")


def _back_up_paper(synced: dict) -> None:
    """Sync the Paper database's backup when its head moved since the last sync, so a stop or a seal has a copy
    within PUBLISH_RETRY. `synced` keeps the head synced last. It never raises, as _publish_if_behind."""
    try:
        profile = db.profiles().get(PAPER)
        target = None if profile is None or profile.holds != "paper" else admin.backup_path(profile)
        if profile is None or target is None:
            return
        with db.read_as_of(profile) as conn:
            head = db.head_commit(conn)
        if synced.get(PAPER) == head:
            return
        if admin.backup_head(target) != head:
            admin.sync_backup(profile, target, head)
            first_run.log(f"synced the Paper backup to {head}")
        synced[PAPER] = head
    except Refusal as exc:
        first_run.log(f"Paper backup refused: {exc}")
    except Exception as exc:
        first_run.log(f"Paper backup failed: {type(exc).__name__}: {exc}")


def keep_backed_up(stop: threading.Event, publishing: bool = True) -> None:
    """Every PUBLISH_RETRY seconds until `stop`: publish the ledger when origin is behind (`publishing`), then the
    Paper backup."""
    synced: dict = {}
    while not stop.wait(PUBLISH_RETRY):
        if publishing:
            _publish_if_behind()
        _back_up_paper(synced)


def run(service_root: Path, data_dir: Path, backup_root: Path, credentials: Path | None, origin: str | None,
        port: int = PORT, readers: Path | None = None, setup: str | None = None,
        controllers: Path | None = None) -> tuple[dict, int]:
    """ledger service run: serve until the server exits; SIGTERM and SIGINT are passed to it."""
    if setup is not None and server.service_config(Path(service_root).absolute()) is None:
        process = _first_start(service_root, data_dir, backup_root, credentials, origin, port, readers, setup,
                              controllers)
    else:
        process, _ = start(service_root, data_dir, backup_root, credentials, origin, port, readers=readers,
                          controllers=controllers)
    return serve("run", process)


def serve(action: str, process: subprocess.Popen, publishing: bool = True,
          *work: Callable[[threading.Event], None]) -> tuple[dict, int]:
    """Wait on the server with SIGTERM and SIGINT passed to it, keep_backed_up (`publishing`) and each of `work`
    running beside it until it exits; a signalled exit is a clean one."""
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda received, frame: process.send_signal(received))
    stop = threading.Event()
    for target in (lambda stop: keep_backed_up(stop, publishing), *work):
        threading.Thread(target=target, args=(stop,), daemon=True).start()
    code = process.wait()
    stop.set()
    return {"action": action, "server_exit": code}, 0 if code in (0, -signal.SIGTERM, -signal.SIGINT) else 1


def check(ledger: db.LedgerProfile) -> dict:
    """ledger service check: the ledger read with its reader account at the schema version this code reads
    (the container's healthcheck)."""
    with db.read_as_of(ledger) as conn:
        commit = conn.resolved_commit
    return {"action": "check", "running": True, "ledger_commit": commit}
