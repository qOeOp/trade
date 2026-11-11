"""`ledger service run` and `ledger service check`: the Dolt service of the research ledger as compose runs it
(docs/plans/ledger-compose-service.zh.md).

`run` stays in the foreground for the container's life, with the Dolt server as its child. With no
service.json it bootstraps, and only into an empty service directory, an empty data directory and a
profile directory without profiles (anything else is BOOTSTRAP_REFUSED and nothing is touched):

- the DoltHub key is installed first (none is DOLTHUB_CREDENTIALS, before anything is downloaded);
- `research` is cloned from its public copy, which stays its `origin`, and every remote branch becomes a
  local one. An active or isolated service whose copy holds no data yet (the operator's new repository) makes a
  new ledger instead, with that copy as `origin`, and publishes it before anything else can write;
- it is checked (schema version, no commit verification group) before any account exists;
- root gets its password and `'root'@'%'` (the published port and the other containers are not
  localhost), the service is secured, the database gets its accounts as `ledger init` would make them;
- service.json (no socket: a service compose runs) and the profile are written last.

A bootstrap that fails removes what it made (the directories were empty) and raises. With a
service.json it checks before serving: no commit verification group, every recorded database, the
schema version of each profile's database; any failure stops the server and is SERVICE_CHECK_FAILED.
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
exiting (`cli.first_run`); a later start is unchanged.

While it serves, `run` publishes the ledger every PUBLISH_RETRY seconds when origin is behind it, so a publish that
failed does not wait for the next write. What is still behind shows on the IDE's page.
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
import time

import pymysql

from cli import first_run
from cli.first_run import _log
from ledger import db, publish
from shared import paths, profiles
from shared.errors import Refusal
from ledger.publish import _rows
from shared.refusals import refuse

PORT = 13330
LISTEN = "0.0.0.0"  # inside its container; compose publishes the port on the host's loopback only
LEDGER = "research"  # the profile and database name
PAPER = "paper"  # the Paper database's profile and database name, on the same service
PUBLISH_RETRY = 300  # seconds between checks that origin holds the ledger; the check reads locally, a retry pushes
EMPTY_COPY = "remote at that url contains no Dolt data"  # Dolt's clone of a repository with no data (2.4.2 and 2.7.2)


def _write_config(service_root: Path, data_dir: Path, port: int) -> None:
    (service_root / "config.yaml").write_text(
        "log_level: warning\n"
        "behavior:\n  autocommit: true\n  auto_gc_behavior:\n    enable: true\n"
        f"listener:\n  host: {LISTEN}\n  port: {port}\n"
        f"data_dir: {data_dir}\ncfg_dir: {service_root / 'cfg'}\n"
        f"privilege_file: {service_root / 'cfg' / 'privileges.db'}\n"
        f"branch_control_file: {service_root / 'cfg' / 'branch_control.db'}\n" + db.NO_FILE_IO, encoding="utf-8")


def _environment(service_root: Path) -> dict:
    # No usage events: Dolt writes them into its home from a background process after a command exits,
    # which would refill a directory a failed bootstrap has just emptied (measured).
    return {**os.environ, "DOLT_ROOT_PATH": str(service_root / "home"), "DOLT_DISABLE_EVENT_FLUSH": "true"}


def _launch(binary: str, service_root: Path, log) -> subprocess.Popen:
    return subprocess.Popen([binary, "sql-server", "--config", str(service_root / "config.yaml")], cwd=service_root,
                            env=_environment(service_root), stdin=subprocess.DEVNULL, stdout=log, stderr=log)


def _stop(server: subprocess.Popen) -> None:
    if server.poll() is None:
        server.terminate()
        try:
            server.wait(timeout=30)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait()


def _ready(config: dict, server: subprocess.Popen, password: str | None = None) -> None:
    for _ in range(600):
        try:
            db._admin(config, password=password).close()
            return
        except pymysql.MySQLError:
            if server.poll() is not None:
                break
            time.sleep(0.1)
    raise refuse("LEDGER_START", f"the Dolt service did not accept connections at {db.address(config)}")


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
    version, expected = _rows(cursor, f"SELECT version FROM `{database}`.ledger_schema WHERE singleton = 1"), \
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
              say: Callable[[str], None] = _log) -> tuple[subprocess.Popen, dict]:
    """The new service with `research` cloned from `origin` (or new, when a publishing service finds `origin`
    empty), its accounts, service.json and profile; returns the running server and the configuration. `say` hears
    each step."""
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
    server = None
    try:
        for directory in (service_root / "cfg", service_root / "home", data_dir):
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(service_root, 0o700)
        environment = _environment(service_root)
        db.dolt_home(service_root / "home", {**db.QUIET, **db.IDENTITY})
        if kind is not None:
            assert credentials is not None  # checked before any directory was created
            publish.install_key(service_root, credentials)
        say(f"reading {origin}")
        cloned = subprocess.run([binary, "clone", origin, LEDGER], cwd=data_dir, env=environment, capture_output=True,
                                text=True)
        new = bool(cloned.returncode) and kind is not None and EMPTY_COPY in cloned.stderr
        if cloned.returncode and not new:
            raise refuse("BOOTSTRAP_FAILED", f"cloning {origin} failed: {cloned.stderr.strip()[-300:]}",
                         missing=(origin,))
        _write_config(service_root, data_dir, port)
        config: dict = {"binary": binary, "port": port, "root_password": secrets.token_urlsafe(24), "databases": {},
                        "secured": False}
        server = _launch(binary, service_root, log)
        _ready(config, server, password="")
        conn = db._admin(config, password="")
        try:
            with conn.cursor() as cursor:
                cursor.execute("ALTER USER 'root'@'localhost' IDENTIFIED BY %s", (config["root_password"],))
                _root_anywhere(cursor, config["root_password"])
        finally:
            conn.close()
        conn = db._admin(config)
        try:
            with conn.cursor() as cursor:
                if new:
                    say(f"{origin} is empty: making a new ledger")
                    cursor.execute(f"CREATE DATABASE `{LEDGER}`")
                    cursor.execute(f"USE `{LEDGER}`")
                    db.ledger_schema(cursor)
                    cursor.execute("CALL DOLT_REMOTE('add', %s, %s)", (publish.REMOTE, origin))
                try:
                    _check_database(cursor, LEDGER)
                except pymysql.MySQLError as exc:
                    raise refuse("BOOTSTRAP_FAILED", f"{origin} does not hold a research ledger: {exc.args[-1]}",
                                 missing=(origin,)) from exc
                cursor.execute(f"USE `{LEDGER}`")
                local = {branch for (branch,) in _rows(cursor, "SELECT name FROM dolt_branches")}
                for (remote,) in _rows(cursor, "SELECT name FROM dolt_remote_branches"):
                    branch = remote.removeprefix(f"remotes/{publish.REMOTE}/")
                    if branch not in local:
                        cursor.execute("CALL DOLT_BRANCH(%s, %s)", (branch, f"{publish.REMOTE}/{branch}"))
                accounts = {role: {"user": db._account_name(LEDGER, role), "password": secrets.token_urlsafe(24)}
                            for role in db.ROLES}
                db._clear(cursor, LEDGER, accounts)
                db._secure(cursor, config)
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
        profiles.private_write(service_root / "service.json", config)
        made = db.LedgerProfile(name=LEDGER, database=LEDGER, service_root=service_root, kind=kind,
                                backup_root=backup_root / LEDGER)
        profiles.private_write(profile, made.as_json())
        if new:
            say(f"publishing the new ledger to {origin}")
            publish.publish(made)  # a key or repository that cannot take it stops here, with nothing lost
        say("bootstrapped")
        return server, config
    except BaseException:
        if server is not None:
            _stop(server)
        profile.unlink(missing_ok=True)
        _clear(data_dir, kept[data_dir])
        _clear(service_root, kept[service_root])
        raise


def _check_service(service_root: Path, config: dict) -> None:
    """The checks of every start: no commit verification group (the ledger keeps no commit tests, so a group
    left by an earlier product version would refuse every commit), every database service.json records,
    the schema version of each ledger profile's database on this service."""
    conn = db._admin(config)
    try:
        with conn.cursor() as cursor:
            (group,), = _rows(cursor, "SELECT @@GLOBAL.dolt_commit_verification_groups")
            if group:
                raise refuse("SERVICE_CHECK_FAILED", f"the service's commit verification group is {group!r}, not "
                                                     "empty; `ledger init` of a new database clears it",
                             missing=("dolt_commit_verification_groups",))
            present = {name.lower() for (name,) in _rows(cursor, "SHOW DATABASES")}
            missing = sorted(name for name in config.get("databases", {}) if name.lower() not in present)
            if missing:
                raise refuse("SERVICE_CHECK_FAILED", f"service.json records databases the service does not hold: "
                                                     f"{', '.join(missing)}", missing=tuple(missing))
            for profile in db.profiles().values():
                if Path(profile.service_root).resolve() == service_root.resolve():
                    _check_database(cursor, profile.database, profile.holds)
    finally:
        conn.close()


def paper_database(service_root: Path, backup_root: Path, binary: str | None = None) -> dict:
    """The service's Paper database (ledger/paper.sql, profile and database PAPER), made empty at a start that lacks
    it; returns the service configuration. Paper's execution records never enter the research ledger."""
    if PAPER not in db._known_service(service_root).get("databases", {}):
        db.init(PAPER, PAPER, service_root, "isolated", backup_root=backup_root / PAPER,
                dolt_binary=Path(binary) if binary else None, holds="paper")
    found = db.load_profile(PAPER)
    if (found.holds != "paper" or found.database != PAPER or found.kind != "isolated"
            or found.service_root.resolve() != service_root.resolve()):
        raise refuse("SERVICE_CHECK_FAILED", f"profile {PAPER} is not this service's Paper database",
                     missing=(PAPER,))
    return db._known_service(service_root)


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
          readers: Path | None = None, say: Callable[[str], None] = _log,
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
    binary = db._binary(binary)
    config = db._service(service_root)
    if config is None:
        server, config = bootstrap(service_root, data_dir, backup_root, credentials, origin, port, binary, kind, log,
                                   say)
        return server, _serve_readers(server, readers, controllers, service_root, backup_root,
                                      _with_paper(server, config, service_root, backup_root, binary, kind))
    if not db.managed(config) or int(config["port"]) != port:
        raise refuse("SERVICE_CHECK_FAILED", f"{service_root}/service.json names a socket or port "
                                             f"{config.get('port')}, not a service compose runs on port {port}",
                     missing=(str(service_root / "service.json"),))
    if credentials is not None and (credentials / "config_global.json").is_file():
        publish.install_key(service_root, credentials)
    _write_config(service_root, data_dir, port)
    _clear(data_dir / ".dolt" / "tmp")
    server = _launch(binary, service_root, log)
    try:
        _ready(config, server)
        _check_service(service_root, config)
    except BaseException:
        _stop(server)
        raise
    _log(f"serving on port {port}")
    return server, _serve_readers(server, readers, controllers, service_root, backup_root,
                                  _with_paper(server, config, service_root, backup_root, binary, kind))


def _with_paper(server: subprocess.Popen, config: dict, service_root: Path, backup_root: Path, binary: str,
                kind: str | None) -> dict:
    """A writable service (kind not None) holds the Paper database beside the ledger; a mirror makes its own."""
    if kind is None:
        return config
    try:
        return paper_database(service_root, backup_root, binary)
    except BaseException:
        _stop(server)
        raise


def _serve_readers(server: subprocess.Popen, readers: Path | None, controllers: Path | None, service_root: Path,
                   backup_root: Path, config: dict) -> dict:
    try:
        if readers is not None:
            write_readers(Path(readers).absolute(), config)
        if controllers is not None:
            write_controllers(Path(controllers).absolute(), service_root, backup_root, config)
    except BaseException:
        _stop(server)
        raise
    return config


def _first_start(service_root: Path, data_dir: Path, backup_root: Path, credentials: Path | None, origin: str | None,
                 port: int, readers: Path | None, setup: str, controllers: Path | None = None) -> subprocess.Popen:
    """The server of a first start the IDE's page finishes (`cli.first_run`)."""
    if credentials is None:
        raise refuse("USAGE_ERROR", "ledger service run --setup needs --credentials, the directory of the DoltHub key")
    binary = db._binary(None)
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
            _log(f"published {publish.publish(profile)['head']}, which origin was behind")
    except Refusal as exc:
        _log(f"publish retry refused: {exc}")
    except Exception as exc:  # a connection lost mid-push, for one
        _log(f"publish retry failed: {type(exc).__name__}: {exc}")


def _keep_published(stop: threading.Event) -> None:
    while not stop.wait(PUBLISH_RETRY):
        _publish_if_behind()


def run(service_root: Path, data_dir: Path, backup_root: Path, credentials: Path | None, origin: str | None,
        port: int = PORT, readers: Path | None = None, setup: str | None = None,
        controllers: Path | None = None) -> tuple[dict, int]:
    """ledger service run: serve until the server exits; SIGTERM and SIGINT are passed to it."""
    if setup is not None and db._service(Path(service_root).absolute()) is None:
        server = _first_start(service_root, data_dir, backup_root, credentials, origin, port, readers, setup,
                              controllers)
    else:
        server, _ = start(service_root, data_dir, backup_root, credentials, origin, port, readers=readers,
                          controllers=controllers)
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda received, frame: server.send_signal(received))
    stop = threading.Event()
    threading.Thread(target=_keep_published, args=(stop,), daemon=True).start()
    code = server.wait()
    stop.set()
    return {"action": "run", "server_exit": code}, 0 if code in (0, -signal.SIGTERM, -signal.SIGINT) else 1


def check(ledger: db.LedgerProfile) -> dict:
    """ledger service check: the ledger read with its reader account at the schema version this code reads
    (the container's healthcheck)."""
    with db.read_as_of(ledger) as conn:
        commit = conn.resolved_commit
    return {"action": "check", "running": True, "ledger_commit": commit}
