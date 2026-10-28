"""`ledger service run` and `ledger service check`: the Dolt service of the research ledger and the
market database as compose runs it (docs/plans/ledger-compose-service.zh.md).

`run` stays in the foreground for the container's life, with the Dolt server as its child. With no
service.json it bootstraps, and only into an empty service directory, an empty data directory and a
profile directory without profiles (anything else is BOOTSTRAP_REFUSED and nothing is touched):

- the DoltHub key is installed first (none is DOLTHUB_CREDENTIALS, before anything is downloaded);
- `research` and `market` are cloned from their public copies, which stay their `origin`, and every
  remote branch becomes a local one;
- both are checked (schema version, commit tests) before any account exists;
- root gets its password and `'root'@'%'` (the published port and the other containers are not
  localhost), the service is secured, each database gets its accounts as `ledger init` and `market
  init` would make them;
- service.json (no socket: a service compose runs) and the two profiles are written last.

A bootstrap that fails removes what it made (the directories were empty) and raises. With a
service.json it checks before serving: the commit verification group, every recorded database, the
schema version of each profile's database; any failure stops the server and is SERVICE_CHECK_FAILED.
config.yaml is written from the arguments at every start: the data directory may be a volume only the
container sees (a Dolt lock does not reach the host across a Docker Desktop bind mount, measured).
"""

from __future__ import annotations

import os
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import sys
import time

import pymysql

from ledger import db, publish
from ledger.refusals import refuse
from market import store
from report import review

PORT = 13330
LISTEN = "0.0.0.0"  # inside its container; compose publishes the port on the host's loopback only
LEDGER, MARKET = "research", "market"  # profile and database names of the two databases
BRANCH = "main"


def _log(text: str) -> None:
    print(f"ledger service run: {text}", file=sys.stderr, flush=True)


def _write_config(service_root: Path, data_dir: Path, port: int) -> None:
    (service_root / "config.yaml").write_text(
        "log_level: warning\n"
        "behavior:\n  autocommit: true\n"
        f"listener:\n  host: {LISTEN}\n  port: {port}\n"
        f"data_dir: {data_dir}\ncfg_dir: {service_root / 'cfg'}\n"
        f"privilege_file: {service_root / 'cfg' / 'privileges.db'}\n"
        f"branch_control_file: {service_root / 'cfg' / 'branch_control.db'}\n", encoding="utf-8")


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


def _rows(cursor, statement: str, arguments=()) -> list[tuple]:
    cursor.execute(statement, arguments)
    return list(cursor.fetchall())


def _root_anywhere(cursor, password: str) -> None:
    """root from beyond localhost (the published port, the other containers), with root's password;
    one already there is left as it is."""
    cursor.execute("CREATE USER IF NOT EXISTS 'root'@'%%' IDENTIFIED BY %s", (password,))
    cursor.execute("GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION")


def _root_admin(cursor) -> None:
    """Admin on every branch for root from beyond localhost (a database must be selected)."""
    cursor.execute("INSERT IGNORE INTO dolt_branch_control VALUES ('%', '%', 'root', '%', 'admin')")


def _check_database(cursor, database: str, holds: str) -> None:
    """The database's schema version (and, at a bootstrap, its commit tests) are the ones this code reads."""
    if holds == LEDGER:
        version, expected = _rows(cursor, f"SELECT version FROM `{database}`.ledger_schema WHERE singleton = 1"), \
            db.SCHEMA_VERSION
    else:
        version, expected = _rows(cursor, f"SELECT version FROM `{database}`.market_schema WHERE singleton = 1"), \
            store.SCHEMA_VERSION
    if version != [(expected,)]:
        raise refuse("SERVICE_CHECK_FAILED", f"{database} holds schema version {version[0][0] if version else None}, "
                                             f"this code reads {expected}", missing=(database,))


def _check_tests(cursor, database: str, holds: str) -> None:
    expected = set(review.product_commit_tests()) if holds == LEDGER else {name for name, _ in store.TESTS}
    found = {name for (name,) in _rows(cursor, f"SELECT test_name FROM `{database}`.dolt_tests")}
    if found != expected:
        raise refuse("SERVICE_CHECK_FAILED", f"the commit tests of {database} are not the ones this code defines",
                     missing=tuple(sorted(expected - found)) or (database,))


def bootstrap(service_root: Path, data_dir: Path, backup_root: Path, credentials: Path | None,
              origins: dict[str, str], port: int, binary: str, kind: str, log) -> tuple[subprocess.Popen, dict]:
    """The new service with `research` and `market` cloned from `origins` ({LEDGER: url, MARKET: url}),
    their accounts, service.json and profiles; returns the running server and the configuration."""
    if not (_empty(service_root) and _empty(data_dir) and not any(db.home().glob("*.json"))):
        raise refuse("BOOTSTRAP_REFUSED", f"no service.json in {service_root}, but it, the data directory {data_dir} "
                                          f"or the profile directory {db.home()} is not empty; nothing was changed",
                     missing=(str(service_root / "service.json"),))
    if not all(origins.get(name) for name in (LEDGER, MARKET)):
        raise refuse("USAGE_ERROR", "a first start clones the databases: it needs --research-origin and --market-origin")
    if credentials is None or not (credentials / "config_global.json").is_file():
        raise refuse("DOLTHUB_CREDENTIALS", f"no DoltHub key (a `dolt login` ~/.dolt) at {credentials}; the active "
                                            "ledger publishes every write", missing=("TRADE_DOLTHUB",))
    if kind == "active":
        for path in (service_root, data_dir, backup_root):
            if db._inside(path, db.REPOSITORY) or db._is_temporary(path):
                raise refuse("ISOLATION_BREACH", "an active service keeps its data and backups outside the source "
                                                 "checkout and temporary roots", missing=(str(path),))
    profiles = {name: db.home() / f"{name}.json" for name in (LEDGER, MARKET)}
    kept = {path: frozenset(path.iterdir() if path.is_dir() else ()) for path in (service_root, data_dir)}
    server = None
    try:
        for directory in (service_root / "cfg", service_root / "home", data_dir):
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(service_root, 0o700)
        environment = _environment(service_root)
        for key, value in (("metrics.disabled", "true"), ("user.name", "Research Ledger"),
                           ("user.email", "research-ledger@example.invalid")):
            subprocess.run([binary, "config", "--global", "--add", key, value], env=environment, check=True,
                           capture_output=True)
        publish.install_key(service_root, credentials)
        for name in (LEDGER, MARKET):
            _log(f"cloning {name} from {origins[name]}")
            cloned = subprocess.run([binary, "clone", origins[name], name], cwd=data_dir, env=environment,
                                    capture_output=True, text=True)
            if cloned.returncode:
                raise refuse("BOOTSTRAP_FAILED", f"cloning {origins[name]} failed: {cloned.stderr.strip()[-300:]}",
                             missing=(origins[name],))
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
                for name, holds in ((LEDGER, LEDGER), (MARKET, MARKET)):
                    _check_database(cursor, name, holds)
                    _check_tests(cursor, name, holds)
                    cursor.execute(f"USE `{name}`")
                    local = {branch for (branch,) in _rows(cursor, "SELECT name FROM dolt_branches")}
                    for (remote,) in _rows(cursor, "SELECT name FROM dolt_remote_branches"):
                        branch = remote.removeprefix(f"remotes/{publish.REMOTE}/")
                        if branch not in local:
                            cursor.execute("CALL DOLT_BRANCH(%s, %s)", (branch, f"{publish.REMOTE}/{branch}"))
                    accounts = {role: {"user": db._account_name(name, role), "password": secrets.token_urlsafe(24)}
                                for role in db.ROLES}
                    db._clear(cursor, name, accounts)
                    db._secure(cursor, config)
                    config["secured"] = True
                    _root_admin(cursor)
                    if holds == LEDGER:
                        db.ledger_accounts(cursor, name, BRANCH, accounts)
                    else:
                        db.market_accounts(cursor, name, accounts)
                    config["databases"][name] = accounts
        finally:
            conn.close()
        db._private_write(service_root / "service.json", config)
        db._private_write(profiles[LEDGER], db.LedgerProfile(
            name=LEDGER, database=LEDGER, service_root=service_root, research_branch=BRANCH, kind=kind,
            backup_root=backup_root / LEDGER).as_json())
        db._private_write(profiles[MARKET], {"name": MARKET, "kind": "market", "role": kind,
                                             "service": str(service_root), "database": MARKET,
                                             "backup": str(backup_root / MARKET)})
        _log("bootstrapped")
        return server, config
    except BaseException:
        if server is not None:
            _stop(server)
        for path in profiles.values():
            path.unlink(missing_ok=True)
        _clear(data_dir, kept[data_dir])
        _clear(service_root, kept[service_root])
        raise


def _check_service(service_root: Path, config: dict) -> None:
    """The checks of every start: the commit verification group, every database service.json records,
    the schema version of each profile's database on this service. Then root from beyond localhost
    (a service that a host process ran before has only root@localhost)."""
    conn = db._admin(config)
    try:
        with conn.cursor() as cursor:
            (group,), = _rows(cursor, "SELECT @@GLOBAL.dolt_commit_verification_groups")
            if group != db.COMMIT_TESTS:
                raise refuse("SERVICE_CHECK_FAILED", f"the service's commit verification group is {group!r}, not "
                                                     f"{db.COMMIT_TESTS!r}", missing=("dolt_commit_verification_groups",))
            present = {name.lower() for (name,) in _rows(cursor, "SHOW DATABASES")}
            missing = sorted(name for name in config.get("databases", {}) if name.lower() not in present)
            if missing:
                raise refuse("SERVICE_CHECK_FAILED", f"service.json records databases the service does not hold: "
                                                     f"{', '.join(missing)}", missing=tuple(missing))
            for profile in db.profiles().values():
                if Path(profile.service_root).resolve() == service_root.resolve():
                    _check_database(cursor, profile.database, MARKET if profile.holds == MARKET else LEDGER)
            _root_anywhere(cursor, config["root_password"])
            if config.get("databases"):
                cursor.execute(f"USE `{next(iter(config['databases']))}`")
                _root_admin(cursor)
    finally:
        conn.close()


def start(service_root: Path, data_dir: Path, backup_root: Path, credentials: Path | None, origins: dict[str, str],
          port: int = PORT, binary: str | None = None, kind: str = "active", log=None) -> tuple[subprocess.Popen, dict]:
    """Bootstrap or check the service and return its running server (the caller waits on it)."""
    service_root, data_dir = Path(service_root).absolute(), Path(data_dir).absolute()
    backup_root = Path(backup_root).absolute()
    binary = db._binary(binary)
    config = db._service(service_root)
    if config is None:
        return bootstrap(service_root, data_dir, backup_root, credentials, origins, port, binary, kind, log)
    if not db.managed(config) or int(config["port"]) != port:
        raise refuse("SERVICE_CHECK_FAILED", f"{service_root}/service.json names a socket or port "
                                             f"{config.get('port')}, not a service compose runs on port {port}",
                     missing=(str(service_root / "service.json"),))
    if credentials is not None and (credentials / "config_global.json").is_file():
        publish.install_key(service_root, credentials)
    _write_config(service_root, data_dir, port)
    server = _launch(binary, service_root, log)
    try:
        _ready(config, server)
        _check_service(service_root, config)
    except BaseException:
        _stop(server)
        raise
    _log(f"serving on port {port}")
    return server, config


def run(service_root: Path, data_dir: Path, backup_root: Path, credentials: Path | None,
        origins: dict[str, str], port: int = PORT) -> tuple[dict, int]:
    """ledger service run: serve until the server exits; SIGTERM and SIGINT are passed to it."""
    server, _ = start(service_root, data_dir, backup_root, credentials, origins, port)
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda received, frame: server.send_signal(received))
    code = server.wait()
    return {"action": "run", "server_exit": code}, 0 if code in (0, -signal.SIGTERM, -signal.SIGINT) else 1


def check(ledger: db.LedgerProfile, market: dict) -> dict:
    """ledger service check: the ledger and the market database both read with their reader accounts
    at the schema version this code reads (the container's healthcheck)."""
    with db.read_as_of(ledger) as conn:
        commit = conn.resolved_commit
    with store.connect(market, "reader") as conn:
        version = conn.version
    return {"action": "check", "running": True, "ledger_commit": commit, "market_schema": version}
