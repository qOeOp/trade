"""The research ledger's service, accounts, connections and its single write protocol.

A service is one local `dolt sql-server` with its own directory, unix socket and accounts; it may
hold several databases. A profile names one research database on one service, its fixed research
branch and its kind (`active`, `isolated` or `temporary`). Each database has a writer account
(SELECT, INSERT, UPDATE of `ledger_head`, EXECUTE of `dolt_commit`, branch write on the research
branch only) and a reader account (SELECT). Administration stays inside `init`.

Every write is one transaction on one writer connection: look the operation up by `op_id` (a
retry returns the original record), refuse a dirty working set, insert, bump the single
`ledger_head` row and `dolt_commit`, which runs the commit verification group. Two concurrent
writers both change `ledger_head`, so Dolt refuses the later one (error 1213) instead of merging.
A write that records what cannot recur (a replay's sealed capture or run) reruns its transaction
a few times on that refusal; every other write returns it to the caller.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
from typing import Literal

import pymysql
import pymysql.constants.CR
import pymysql.cursors

from ledger.errors import Refusal
from ledger.paths import temporary_path
from ledger.refusals import refuse


SCHEMA_VERSION = 3
READABLE_VERSIONS = frozenset({3})
DOLT_VERSION = "2.4.2"
KINDS = ("active", "isolated", "temporary")
ROLES = ("writer", "reader")
SOCKET_LIMIT = 100  # macOS sun_path holds 104 bytes
# The host every service is reached at over TCP, on its own port, instead of its Unix socket: set in a
# container that cannot reach the socket (the paper daemon's, docs/plans/paper-compose-deployment.zh.md).
DOLT_HOST = "TRADE_DOLT_HOST"
COMMIT_TESTS = "commit"
SCHEMA = Path(__file__).with_name("schema.sql")
REPOSITORY = Path(__file__).resolve().parents[1]
DEFAULT_HOME = Path.home() / ".local/share/trade/ledgers"
NAME = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")
DATABASE = re.compile(r"[A-Za-z0-9_]{1,64}\Z")
REF = re.compile(r"[A-Za-z0-9][A-Za-z0-9_./-]{0,199}\Z")
COMMIT_HASH = re.compile(r"[0-9a-v]{32}\Z")
IDENTIFIER = re.compile(r"[a-z_][a-z0-9_]*\Z")
OP_ID_LIMIT = 160
SEAL_ATTEMPTS = 5  # transactions a sealing write tries before CONCURRENT_WRITE reaches its caller
RETRY_PAUSE = 0.5  # seconds before the next attempt, times the number of attempts made
VERIFICATION_FAILED = "commit verification failed"
# trial.image_ref is <repository>@sha256:<digest>; its digest is read, not stored.
IMAGE_DIGEST = "SUBSTRING_INDEX(image_ref, '@', -1) AS image_digest"
TRIAL_IMAGE_DIGEST = "SUBSTRING_INDEX(t.image_ref, '@', -1) AS image_digest"  # trial aliased `t`
SERVER_LAUNCH = '"$@" </dev/null >>server.log 2>&1 & echo $!'


# Profiles

@dataclass(frozen=True)
class LedgerProfile:
    """A named research database on one service; `kind` is its lifecycle, `holds` its content."""

    name: str
    database: str
    service_root: Path
    research_branch: str = "main"
    kind: str | None = "isolated"  # None: a profile file that names no lifecycle
    backup_root: Path | None = None
    holds: str = "research"

    def as_json(self) -> dict:
        return {"name": self.name, "holds": self.holds, "kind": self.kind, "database": self.database,
                "service": str(self.service_root), "research_branch": self.research_branch,
                "backup": str(self.backup_root) if self.backup_root else None}

    @classmethod
    def from_json(cls, value: dict) -> LedgerProfile:
        kind, holds = value.get("kind"), value.get("holds")
        if holds is None and kind in ("research", "market"):
            # The market profile format: `kind` holds the content and `role` the lifecycle.
            holds, kind = kind, value.get("role")
        return cls(name=value["name"], database=value["database"], service_root=Path(value["service"]),
                   research_branch=value.get("research_branch") or "main", kind=kind,
                   backup_root=Path(value["backup"]) if value.get("backup") else None, holds=holds or "research")


def home() -> Path:
    """The profile directory; `TRADE_LEDGER_HOME` overrides it for tests and rehearsals."""
    return Path(os.environ.get("TRADE_LEDGER_HOME", DEFAULT_HOME)).expanduser()


def profiles() -> dict[str, LedgerProfile]:
    directory = home()
    if not directory.is_dir():
        return {}
    found = {}
    for path in sorted(directory.glob("*.json")):
        try:
            found[path.stem] = LedgerProfile.from_json(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError, KeyError, TypeError):
            continue
    return found


def load_profile(name: str) -> LedgerProfile:
    found = profiles().get(name)
    if found is None:
        raise refuse("LEDGER_UNKNOWN", f"there is no ledger profile named {name!r}", missing=(name,))
    return found


def _private_write(path: Path, value: dict) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(4)}")
    with open(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write("\n")
    os.replace(temporary, path)


def _service(root: Path) -> dict | None:
    try:
        return json.loads((Path(root) / "service.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _known_service(root: Path) -> dict:
    """The service configuration of `root`; a directory without a readable one is no ledger service."""
    config = _service(root)
    if config is None:
        raise refuse("LEDGER_UNKNOWN", f"{root} is not a ledger service directory")
    return config


# Service lifecycle

def _binary(given: Path | str | None) -> str:
    candidate = given or os.environ.get("RESEARCH_DOLT_BINARY") or shutil.which("dolt")
    if not candidate:
        raise refuse("DOLT_BINARY", "no Dolt executable given, in RESEARCH_DOLT_BINARY or on PATH",
                     expected=f"dolt version {DOLT_VERSION}")
    binary = Path(candidate).expanduser().resolve()
    try:
        checked = subprocess.run([str(binary), "version"], capture_output=True, text=True, check=False, timeout=30)
    except OSError:
        checked = None
    if checked is None or checked.returncode or not checked.stdout.startswith(f"dolt version {DOLT_VERSION}"):
        raise refuse("DOLT_BINARY", f"{binary} is not a Dolt {DOLT_VERSION} executable",
                     expected=f"dolt version {DOLT_VERSION}")
    return str(binary)


def _pid(root: Path) -> int | None:
    pid_file = root / "server.pid"
    if not pid_file.exists():
        return None
    pid = int(pid_file.read_text())
    owner = subprocess.run(["ps", "-ww", "-p", str(pid), "-o", "args="], capture_output=True, text=True, check=False)
    if owner.returncode or "sql-server" not in owner.stdout or str(root / "config.yaml") not in owner.stdout:
        pid_file.unlink()
        return None
    return pid


def managed(config: dict) -> bool:
    """A service without a Unix socket is run by compose (`ledger service run`), not by a process of
    this host: it is reached over TCP and never started or stopped from here."""
    return not config.get("socket")


def address(config: dict) -> str:
    return f"127.0.0.1:{config['port']}" if managed(config) else config["socket"]


def service_connection(config: dict, **options) -> pymysql.Connection:
    """`pymysql.connect` to the service `config` describes: with `TRADE_DOLT_HOST` set over TCP to that
    host on the service's own port (a container beside the service); else over its Unix socket; a
    service compose runs (no socket) over TCP on this host's loopback, where compose publishes it.
    pymysql 1.1.2 leaks its socket when the Unix connect itself fails (a stopped service), so the
    socket is reached first by one that is closed either way, and an unreachable one raises the same
    OperationalError pymysql would."""
    if os.environ.get(DOLT_HOST):
        return pymysql.connect(host=os.environ[DOLT_HOST], port=int(config["port"]), **options)
    if managed(config):
        return pymysql.connect(host="127.0.0.1", port=int(config["port"]), **options)
    socket_path = config["socket"]
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
        probe.settimeout(options.get("connect_timeout", 10))
        try:
            probe.connect(socket_path)
        except OSError as exc:
            raise pymysql.err.OperationalError(
                pymysql.constants.CR.CR_CONN_HOST_ERROR, f"Can't connect to MySQL server on {socket_path!r} ({exc})",
            ) from exc
    return pymysql.connect(unix_socket=socket_path, **options)


def _root_password(config: dict) -> str:
    """The service administrator's password; a reader-only service file holds none."""
    if "root_password" not in config:
        raise refuse("LEDGER_UNKNOWN", "this service file holds only reader accounts, not the service administrator")
    return config["root_password"]


def _admin(config: dict, password: str | None = None, database: str | None = None):
    return service_connection(config, user="root",
                           password=_root_password(config) if password is None else password,
                           database=database, autocommit=True, connect_timeout=5, max_allowed_packet=1 << 30)


def start_service(root: Path) -> dict:
    """Start the service of `root` unless it runs; wait until it accepts connections. A service compose
    runs is only waited for."""
    root = Path(root)
    config = _known_service(root)
    if managed(config):
        for _ in range(150):
            try:
                _admin(config).close()
                return {"running": True, "pid": None, "service": str(root)}
            except pymysql.MySQLError:
                time.sleep(0.1)
        raise refuse("LEDGER_START", f"the Dolt service compose runs does not accept connections at {address(config)}",
                     expected="`docker compose up -d ledger`")
    pid = _pid(root)
    if pid is None:
        environment = {**os.environ, "DOLT_ROOT_PATH": str(root / "home")}
        # The service outlives this process: a shell in a new session starts it in the background and
        # exits, and is waited here, so the server is nobody's unreaped child.
        launched = subprocess.run(["/bin/sh", "-c", SERVER_LAUNCH, "sh", config["binary"], "sql-server", "--config",
                                   str(root / "config.yaml")], cwd=root, env=environment, start_new_session=True,
                                  capture_output=True, text=True, check=True, timeout=30)
        pid = int(launched.stdout)
        (root / "server.pid").write_text(str(pid))
    for _ in range(150):
        try:
            _admin(config).close()
            return {"running": True, "pid": pid, "service": str(root)}
        except pymysql.MySQLError:
            if _pid(root) is None:
                break
            time.sleep(0.1)
    print(f"ledger service log: {root / 'server.log'}", file=sys.stderr)
    raise refuse("LEDGER_START", "the Dolt service did not accept connections in time or exited")


def stop_service(root: Path) -> dict:
    root = Path(root)
    config = _service(root)
    if config is not None and managed(config):
        raise refuse("SERVICE_MANAGED", f"the Dolt service at {root} is run by compose, not by this host",
                     expected="`docker compose stop ledger`")
    pid = _pid(root)
    if pid is None:
        return {"running": False, "service": str(root)}
    os.kill(pid, signal.SIGTERM)
    for _ in range(150):
        try:
            reaped, _ = os.waitpid(pid, os.WNOHANG)
            if reaped == pid:
                break
        except ChildProcessError:
            pass
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            break
        time.sleep(0.1)
    else:
        raise RuntimeError(f"Dolt server {pid} did not stop")
    (root / "server.pid").unlink(missing_ok=True)
    return {"running": False, "pid": pid, "service": str(root)}


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


# secure_file_priv: a directory that can never exist, so no account reads or writes a server file
# (SELECT INTO OUTFILE/DUMPFILE, LOAD_FILE); Dolt 2.4.2 allows both to a SELECT-only account otherwise.
NO_FILE_IO = "system_variables:\n  secure_file_priv: /dev/null/no-file-io\n"


def _create_service(root: Path, binary: str) -> dict:
    socket_path = root / "mysql.sock"
    if len(str(socket_path)) > SOCKET_LIMIT:
        raise refuse("LEDGER_START", f"the service socket path would exceed {SOCKET_LIMIT} bytes",
                     expected="a shorter service directory")
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    for name in ("data", "cfg", "home"):
        (root / name).mkdir(mode=0o700)
    port = _free_port()
    (root / "config.yaml").write_text(
        "log_level: warning\n"
        "behavior:\n  autocommit: true\n"
        f"listener:\n  host: 127.0.0.1\n  port: {port}\n  socket: {socket_path}\n"
        f"data_dir: {root / 'data'}\ncfg_dir: {root / 'cfg'}\n"
        f"privilege_file: {root / 'cfg' / 'privileges.db'}\n"
        f"branch_control_file: {root / 'cfg' / 'branch_control.db'}\n" + NO_FILE_IO, encoding="utf-8")
    environment = {**os.environ, "DOLT_ROOT_PATH": str(root / "home")}
    for key, value in (("user.name", "Research Ledger"), ("user.email", "research-ledger@example.invalid")):
        subprocess.run([binary, "config", "--global", "--add", key, value], env=environment, check=True,
                       capture_output=True)
    config = {"binary": binary, "socket": str(socket_path), "port": port,
              "root_password": secrets.token_urlsafe(24), "databases": {}, "secured": False}
    _private_write(root / "service.json", {**config, "root_password": ""})
    start_service(root)
    conn = _admin(config, password="")
    try:
        with conn.cursor() as cursor:
            cursor.execute("ALTER USER 'root'@'localhost' IDENTIFIED BY %s", (config["root_password"],))
    finally:
        conn.close()
    _private_write(root / "service.json", config)
    return config


def _statements(text: str) -> list[str]:
    lines = [line for line in text.splitlines() if not line.lstrip().startswith("--")]
    return [part.strip().rstrip(";") for part in "\n".join(lines).split(";\n") if part.strip().rstrip(";")]


def _inside(path: Path, root: Path) -> bool:
    return Path(path).expanduser().resolve().is_relative_to(root.resolve())


def init(name: str, database: str, service_root: Path, kind: Literal["active", "isolated", "temporary"],
         research_branch: str = "main", backup_root: Path | None = None, dolt_binary: Path | None = None) -> dict:
    """Create the database, its schema and accounts on a (new or running) service; write the profile."""
    if (not isinstance(name, str) or not NAME.fullmatch(name) or not isinstance(database, str)
            or not DATABASE.fullmatch(database) or kind not in KINDS
            or not isinstance(research_branch, str) or not REF.fullmatch(research_branch) or ".." in research_branch):
        raise refuse("INVALID_NAME", "the profile name, database name, kind or research branch is malformed",
                     expected="name [A-Za-z0-9_-], database [A-Za-z0-9_], kind active|isolated|temporary")
    found = profiles()
    if name in found:
        raise refuse("LEDGER_EXISTS", f"a ledger profile named {name} already exists; nothing is replaced")
    actives = [value for value in found.values() if value.kind == "active"]
    if kind == "active" and any(value.holds == "research" for value in actives):
        raise refuse("LEDGER_EXISTS", "an active research ledger already exists; there is only one")
    if kind != "active" and any(value.database == database for value in actives):
        raise refuse("ISOLATION_BREACH", f"database {database} is an active ledger's name; use another")
    service_root = Path(service_root).expanduser().absolute()
    if kind == "active":
        if backup_root is None:
            raise refuse("ISOLATION_BREACH", "an active ledger needs a backup directory outside its service",
                         missing=("backup_root",))
        for path in (service_root, Path(backup_root)):
            if _inside(path, REPOSITORY) or _is_temporary(path):
                raise refuse("ISOLATION_BREACH", "an active ledger keeps its service and backup outside the "
                                                 "source checkout and temporary roots")
    binary = _binary(dolt_binary)
    config = _known_service(service_root) if (service_root / "service.json").exists() else _create_service(
        service_root, binary)
    start_service(service_root)
    profile = LedgerProfile(name=name, database=database, service_root=service_root, research_branch=research_branch,
                            kind=kind, backup_root=Path(backup_root).expanduser().absolute() if backup_root else None)
    _, commit = _provision(service_root, config, database,
                           lambda cursor, accounts: _ledger_tables(cursor, database, research_branch, accounts),
                           home() / f"{name}.json", profile.as_json())
    return {"profile": profile, "accounts_created": list(ROLES), "branch_grant": research_branch,
            "schema_version": SCHEMA_VERSION, "commit": commit}


def _is_temporary(path: Path) -> bool:
    try:
        temporary_path(path, require_new=False)
    except Refusal:
        return False
    return True


def _secure(cursor, config: dict) -> None:
    if not config.get("secured"):
        # Once per service, with a database selected: branch writes need an explicit grant; root keeps
        # admin everywhere (deleting the wildcard row alone would also remove root's write).
        # IGNORE: a failed init that was rolled back may already have secured the service.
        cursor.execute("INSERT IGNORE INTO dolt_branch_control VALUES ('%', '%', 'root', 'localhost', 'admin')")
        cursor.execute("DELETE FROM dolt_branch_control WHERE `database` = '%' AND branch = '%' "
                       "AND user = '%' AND host = '%'")
        # Service-wide: every database on this service needs at least one test in this group.
        cursor.execute(f"SET PERSIST dolt_commit_verification_groups = '{COMMIT_TESTS}'")


def _account_name(database: str, role: str) -> str:
    legacy = f"{database}_{role}"
    if len(legacy) <= 32:
        return legacy
    # '-' cannot occur in a database name, so these cannot alias legacy account names.
    return "lg-" + hashlib.sha256(f"{database}:{role}".encode()).hexdigest()[:29]


def _provision(service_root: Path, config: dict, database: str, build: Callable[[object, dict], str],
               profile_path: Path, profile: dict) -> tuple[dict, str]:
    """Create `database` on the running service with `build(cursor, accounts)` (its tables, its two
    accounts and their grants; returns the creating commit), record the accounts in service.json and
    write the profile. The service alone says whether the database exists: a service.json entry,
    branch grants or accounts left for a name it does not hold belong to a dropped database and are
    replaced. Any failure once the database is created removes what this call created (the database,
    its branch grants and accounts, its service.json entry) and re-raises."""
    accounts = {role: {"user": _account_name(database, role), "password": secrets.token_urlsafe(24)} for role in ROLES}
    created = recorded = False
    conn = _admin(config)
    try:
        with conn.cursor() as cursor:
            cursor.execute("SHOW DATABASES")
            # Dolt database names are case-insensitive (`CREATE DATABASE A` fails while `a` exists).
            if database.lower() in {row[0].lower() for row in cursor.fetchall()}:
                raise refuse("LEDGER_EXISTS", f"the service already holds database {database}")
            cursor.execute(f"CREATE DATABASE `{database}`")
            created = True
            cursor.execute(f"USE `{database}`")
            _clear(cursor, database, accounts)
            _secure(cursor, config)
            commit = build(cursor, accounts)
        config["secured"] = True
        config["databases"][database] = accounts
        recorded = True
        _private_write(service_root / "service.json", config)
        _private_write(profile_path, profile)
    except BaseException as failure:
        if created:
            try:
                _remove(service_root, config, database, accounts, recorded)
            except Exception as cleanup:  # the original failure stays the one raised
                failure.add_note(f"database {database} and its accounts could not be removed: {cleanup}")
        raise
    finally:
        conn.close()
    return accounts, commit


def _clear(cursor, database: str, accounts: dict) -> None:
    """Delete the branch grants and the generated accounts of `database`, with it selected
    (dolt_branch_control is service-wide, outlives a dropped database and needs one selected). While
    the service held no database of that name before this call, they can only be this call's or a
    dropped database's: account names are derived from the full database name and role."""
    cursor.execute("DELETE FROM dolt_branch_control WHERE `database` = %s", (database,))
    for account in accounts.values():
        cursor.execute(f"DROP USER IF EXISTS '{account['user']}'@'%'")


def _remove(service_root: Path, config: dict, database: str, accounts: dict, recorded: bool) -> None:
    """Undo a failed `_provision` after it created `database`."""
    conn = _admin(config, database=database)
    try:
        with conn.cursor() as cursor:
            _clear(cursor, database, accounts)
            cursor.execute(f"DROP DATABASE `{database}`")
    finally:
        conn.close()
    if recorded:
        del config["databases"][database]
        _private_write(service_root / "service.json", config)


def _ledger_tables(cursor, database: str, branch: str, accounts: dict) -> str:
    for statement in _statements(SCHEMA.read_text(encoding="utf-8")):
        cursor.execute(statement)
    cursor.execute("INSERT INTO ledger_schema VALUES (1, %s)", (SCHEMA_VERSION,))
    cursor.execute("INSERT INTO ledger_head VALUES (1, 0, 'schema')")
    cursor.execute("CALL DOLT_COMMIT('-A', '-m', %s)", (f"schema:{SCHEMA_VERSION}",))
    (commit,), = cursor.fetchall()
    if branch != "main":
        cursor.execute("CALL DOLT_BRANCH(%s, 'main')", (branch,))
    ledger_accounts(cursor, database, branch, accounts)
    return commit


def ledger_accounts(cursor, database: str, branch: str, accounts: dict) -> None:
    """The writer and reader accounts of a research database, their grants and the writer's branch."""
    writer, reader = accounts["writer"]["user"], accounts["reader"]["user"]
    cursor.execute(f"CREATE USER '{writer}'@'%%' IDENTIFIED BY %s", (accounts["writer"]["password"],))
    cursor.execute(f"CREATE USER '{reader}'@'%%' IDENTIFIED BY %s", (accounts["reader"]["password"],))
    # Least privilege: no UPDATE or DELETE except the concurrency row, no database-wide EXECUTE (it
    # would allow reset, tagging and branching), only DOLT_COMMIT by name. Known limit (measured on
    # Dolt 2.4.2): DOLT_COMMIT itself still accepts --amend and --date from the writer; review finds it.
    cursor.execute(f"GRANT SELECT, INSERT ON `{database}`.* TO '{writer}'@'%'")
    cursor.execute(f"GRANT UPDATE ON `{database}`.ledger_head TO '{writer}'@'%'")
    cursor.execute(f"GRANT EXECUTE ON PROCEDURE `{database}`.dolt_commit TO '{writer}'@'%'")
    # dolt_branch_control matches database, branch and user as LIKE patterns, so `_` in them is a
    # wildcard (a research branch res_1 also grants resx1, measured). Dolt 2.4.2 does not honour
    # backslash escapes there: an escaped row stops matching the literal name, so names stay as given.
    # A lookalike branch can only come from the administrator; SQL grants are per literal database.
    cursor.execute("INSERT INTO dolt_branch_control VALUES (%s, %s, %s, '%%', 'write')", (database, branch, writer))
    cursor.execute(f"GRANT SELECT ON `{database}`.* TO '{reader}'@'%'")


MARKET_SCHEMA = REPOSITORY / "market" / "schema.sql"


def init_market(name: str, database: str, service_root: Path, kind: Literal["active", "isolated", "temporary"],
                backup_root: Path | None = None, dolt_binary: Path | None = None) -> dict:
    """Create an empty market database (its tables, committed once by the administrator; no
    market_schema row: the first `market import` writes it and the commit tests), its import and
    reader accounts and its profile (kind market, with its backup directory). An active market
    database, like the active ledger, needs a backup directory, and keeps its service and backup
    outside the source checkout and temporary roots."""
    if (not isinstance(name, str) or not NAME.fullmatch(name) or not isinstance(database, str)
            or not DATABASE.fullmatch(database) or kind not in KINDS):
        raise refuse("INVALID_NAME", "the profile name, database name or kind is malformed",
                     expected="name [A-Za-z0-9_-], database [A-Za-z0-9_], kind active|isolated|temporary")
    found = profiles()
    if name in found:
        raise refuse("LEDGER_EXISTS", f"a profile named {name} already exists; nothing is replaced")
    actives = [value for value in found.values() if value.kind == "active"]
    if kind == "active" and any(value.holds == "market" for value in actives):
        raise refuse("LEDGER_EXISTS", "an active market database already exists; there is only one")
    if kind != "active" and any(value.database == database for value in actives):
        raise refuse("ISOLATION_BREACH", f"database {database} is an active database's name; use another")
    service_root = Path(service_root).expanduser().absolute()
    if kind == "active":
        if backup_root is None:
            raise refuse("ISOLATION_BREACH", "an active market database needs a backup directory outside its service",
                         missing=("backup_root",))
        for path in (service_root, Path(backup_root)):
            if _inside(path, REPOSITORY) or _is_temporary(path):
                raise refuse("ISOLATION_BREACH", "an active market database keeps its service and backup outside "
                                                 "the source checkout and temporary roots")
    binary = _binary(dolt_binary)
    config = _known_service(service_root) if (service_root / "service.json").exists() else _create_service(
        service_root, binary)
    start_service(service_root)
    backup = str(Path(backup_root).expanduser().absolute()) if backup_root else None
    profile = {"name": name, "kind": "market", "role": kind, "service": str(service_root), "database": database,
               "backup": backup}
    accounts, commit = _provision(service_root, config, database, lambda cursor, accounts: _market_tables(
        cursor, database, accounts), home() / f"{name}.json", profile)
    return {"profile": str(home() / f"{name}.json"), "name": name, "database": database, "kind": kind,
            "service_root": str(service_root), "backup": backup,
            "accounts": {role: accounts[role]["user"] for role in ROLES}, "commit": commit}


def _market_tables(cursor, database: str, accounts: dict) -> str:
    for statement in _statements(MARKET_SCHEMA.read_text(encoding="utf-8")):
        cursor.execute(statement)
    # The tables only: there are no commit tests yet, so this one commit skips verification.
    cursor.execute("CALL DOLT_COMMIT('-A', '--skip-verification', '-m', 'market tables')")
    (commit,), = cursor.fetchall()
    market_accounts(cursor, database, accounts)
    return commit


def market_accounts(cursor, database: str, accounts: dict) -> None:
    """The import and reader accounts of a market database, their grants and the import account's branch."""
    writer, reader = accounts["writer"]["user"], accounts["reader"]["user"]
    cursor.execute(f"CREATE USER '{writer}'@'%%' IDENTIFIED BY %s", (accounts["writer"]["password"],))
    cursor.execute(f"CREATE USER '{reader}'@'%%' IDENTIFIED BY %s", (accounts["reader"]["password"],))
    # The import account inserts (the commit tests included, once) and updates only market_schema's
    # import sequence; it may not delete, reset, tag or branch.
    cursor.execute(f"GRANT SELECT, INSERT ON `{database}`.* TO '{writer}'@'%'")
    cursor.execute(f"GRANT UPDATE ON `{database}`.market_schema TO '{writer}'@'%'")
    cursor.execute(f"GRANT EXECUTE ON PROCEDURE `{database}`.dolt_commit TO '{writer}'@'%'")
    cursor.execute("INSERT INTO dolt_branch_control VALUES (%s, 'main', %s, '%%', 'write')", (database, writer))
    cursor.execute(f"GRANT SELECT ON `{database}`.* TO '{reader}'@'%'")


# Connections

class LedgerConnection:
    """One command's connection to one database/branch, with its account role."""

    def __init__(self, raw, profile: LedgerProfile, role: str, branch: str, schema_version: int):
        self.raw, self._profile, self._role, self._branch = raw, profile, role, branch
        self._schema_version = schema_version
        self.in_write = False

    profile = property(lambda self: self._profile)
    role = property(lambda self: self._role)
    database = property(lambda self: self._profile.database)
    branch = property(lambda self: self._branch)
    schema_version = property(lambda self: self._schema_version)

    def rows(self, statement: str, params=None) -> list[tuple]:
        try:
            with self.raw.cursor() as cursor:
                cursor.execute(statement, params)
                result = list(cursor.fetchall())
                while cursor.nextset():
                    cursor.fetchall()
                return result
        except pymysql.MySQLError as exc:
            raise _sql_error(exc) from exc

    def dicts(self, statement: str, params=None) -> list[dict]:
        try:
            with self.raw.cursor() as cursor:
                cursor.execute(statement, params)
                names = [column[0] for column in cursor.description or ()]
                return [dict(zip(names, row, strict=True)) for row in cursor.fetchall()]
        except pymysql.MySQLError as exc:
            raise _sql_error(exc) from exc

    def one(self, statement: str, params=None) -> dict | None:
        found = self.dicts(statement, params)
        return found[0] if found else None

    def many(self, statement: str, rows: list[tuple]) -> None:
        try:
            with self.raw.cursor() as cursor:
                cursor.executemany(statement, rows)
        except pymysql.MySQLError as exc:
            raise _sql_error(exc) from exc

    def close(self) -> None:
        try:
            self.raw.close()
        except pymysql.MySQLError:
            pass

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> None:
        self.close()


class ReadConnection(LedgerConnection):
    """A reader connection pinned on the revision database of one exact commit."""

    def __init__(self, raw, profile, branch, schema_version, resolved_commit: str, ref: str):
        super().__init__(raw, profile, "reader", branch, schema_version)
        self.resolved_commit, self.ref = resolved_commit, ref


def _connection_error(exc: pymysql.MySQLError) -> Refusal:
    code = exc.args[0] if exc.args else None
    if code in (1044, 1045, 1227):
        return refuse("LEDGER_PERMISSION", "the ledger service refused this account")
    if code == 1049:
        return refuse("UNKNOWN_REF", "the ledger has no such branch")
    return refuse("LEDGER_UNAVAILABLE", "the ledger service is not running or does not accept connections")


def connect(profile: LedgerProfile, role: Literal["writer", "reader"], branch: str | None = None, *,
            _streaming: bool = False) -> LedgerConnection:
    """Open a writer or reader connection on `branch` (the fixed research branch by default)."""
    if role not in ROLES:
        raise refuse("INVALID_ROLE", f"role must be writer or reader, got {role!r}", expected="writer | reader")
    if profile.holds != "research":
        raise refuse("LEDGER_KIND", f"profile {profile.name} holds {profile.holds} data, not a research ledger")
    branch = branch or profile.research_branch
    if role == "writer" and branch != profile.research_branch:
        raise refuse("BRANCH_FORBIDDEN", f"the writer writes only the research branch {profile.research_branch}",
                     expected=profile.research_branch)
    if not REF.fullmatch(branch) or ".." in branch:
        raise refuse("INVALID_REF", f"invalid branch name {branch!r}")
    config = _service(profile.service_root) or {}
    accounts = config.get("databases", {}).get(profile.database)
    if accounts is None or role not in accounts:
        raise refuse("LEDGER_UNKNOWN", f"the service of {profile.name} has no accounts for {profile.database}")
    try:
        raw = service_connection(config, user=accounts[role]["user"],
                                 password=accounts[role]["password"], database=f"{profile.database}/{branch}",
                                 charset="utf8mb4", autocommit=True, connect_timeout=5, read_timeout=600,
                                 write_timeout=600, max_allowed_packet=1 << 30,
                                 cursorclass=pymysql.cursors.SSCursor if _streaming else pymysql.cursors.Cursor)
    except pymysql.MySQLError as exc:
        raise _connection_error(exc) from exc
    conn = LedgerConnection(raw, profile, role, branch, 0)
    try:
        version = _schema_version(conn)
        if version != SCHEMA_VERSION:
            raise refuse("SCHEMA_MISMATCH", f"ledger schema version {version}, this code expects {SCHEMA_VERSION}",
                         expected=str(SCHEMA_VERSION))
    except BaseException:
        conn.close()
        raise
    conn._schema_version = version
    try:
        require_commit_checks(conn)
    except BaseException:
        conn.close()
        raise
    return conn


def require_commit_checks(conn: LedgerConnection) -> None:
    """Refuse unless the service-wide commit verification group is the ledger's.

    Any account can SET PERSIST it on Dolt 2.4.2. DOLT_COMMIT reads the GLOBAL value; a session's
    @@ copy is taken when it connects and goes stale (measured), so only the GLOBAL value counts.
    """
    (groups,), = conn.rows("SELECT @@GLOBAL.dolt_commit_verification_groups")
    if groups != COMMIT_TESTS:
        raise refuse("COMMIT_CHECKS_DISABLED", "the service's commit verification group is not "
                                               f"{COMMIT_TESTS!r}; nothing is committed unchecked",
                     expected=COMMIT_TESTS)


def _schema_version(conn: LedgerConnection) -> int | None:
    found = conn.rows("SELECT version FROM ledger_schema WHERE singleton = 1")
    return found[0][0] if found else None


def check_ref(ref) -> str:
    if not isinstance(ref, str) or not REF.fullmatch(ref) or ".." in ref:
        raise refuse("INVALID_REF", f"invalid ledger reference {ref!r}",
                     expected="a commit hash, tag or branch name ([A-Za-z0-9_./-])")
    return ref


def resolve_commit(conn: LedgerConnection, ref: str) -> str:
    """The commit hash a branch, tag or commit hash names on this database."""
    check_ref(ref)
    for statement in ("SELECT hash FROM dolt_branches WHERE name = %s",
                      "SELECT tag_hash FROM dolt_tags WHERE tag_name = %s"):
        found = conn.rows(statement, (ref,))
        if found:
            return found[0][0]
    if COMMIT_HASH.fullmatch(ref) and conn.rows("SELECT 1 FROM dolt_commits WHERE commit_hash = %s", (ref,)):
        return ref
    raise refuse("UNKNOWN_REF", f"{ref!r} is no commit, tag or branch of this ledger", missing=(ref,))


def read_as_of(profile: LedgerProfile, at: str | None = None, readonly_sql: bool = True) -> ReadConnection:
    """A reader connection on `database/<commit>` for the exact commit `at` names (default: research head)."""
    ref = profile.research_branch if at is None else check_ref(at)
    base = connect(profile, "reader", _streaming=not readonly_sql)
    try:
        commit = resolve_commit(base, ref)
        base.rows(f"USE `{profile.database}/{commit}`")
        version = _schema_version(base)
        if version not in READABLE_VERSIONS:
            raise refuse("SCHEMA_MISMATCH", f"ledger schema version {version} at {commit} is not readable here",
                         expected=", ".join(str(item) for item in sorted(READABLE_VERSIONS)))
    except BaseException:
        base.close()
        raise
    return ReadConnection(base.raw, profile, profile.research_branch, version, commit, ref)


def head_commit(conn: LedgerConnection) -> str:
    """The commit a connection reads: its pinned commit, else its branch head."""
    if isinstance(conn, ReadConnection):
        return conn.resolved_commit
    return conn.rows("SELECT DOLT_HASHOF('HEAD')")[0][0]


def as_of(conn: LedgerConnection, at: str | None) -> tuple[str, str]:
    """`(commit, clause)` for reading tables at `at` on this connection; `at=None` reads what the
    connection sees now (inside a write, its own uncommitted rows too) and names its head commit."""
    if at is None:
        return head_commit(conn), ""
    commit = resolve_commit(conn, at)
    return commit, f" AS OF '{commit}'"


# Writes

def canonical_json(payload) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def derive_op_id(kind: str, payload: Mapping) -> str:
    """`kind:sha256(kind ‖ canonical_json(payload))`; the same payload gives the same ID."""
    digest = hashlib.sha256(kind.encode() + b"\x00" + canonical_json(payload).encode()).hexdigest()
    return f"{kind}:{digest}"


ERROR_TEXT_LIMIT = 300  # characters of the server's error text a refusal carries


def _error_text(exc: pymysql.MySQLError) -> str:
    return str(exc.args[1]) if len(exc.args) > 1 else str(exc)


def _sql_error(exc: pymysql.MySQLError, operation_id: str | None = None, test_names: tuple[str, ...] = (),
               statement: bool = False) -> Refusal:
    """The refusal of a server error; `statement`: the error of a caller's own read statement (`ledger sql`)."""
    code = exc.args[0] if exc.args else None
    text = _error_text(exc)
    shown = text if len(text) <= ERROR_TEXT_LIMIT else text[:ERROR_TEXT_LIMIT] + "..."
    if code == 1213:
        return refuse("CONCURRENT_WRITE", "another write landed first; this transaction was rolled back")
    if text.startswith(VERIFICATION_FAILED):
        failed = tuple(sorted(name for name in test_names if name in text))
        return refuse("COMMIT_CHECK_FAILED", "commit verification failed: " + ", ".join(failed or ("unknown",)),
                      missing=failed)
    if code in (1142, 1143, 1370) or (code == 1105 and "permission" in text.lower()):
        return refuse("LEDGER_PERMISSION", "the ledger account may not run this statement")
    if code in (2006, 2013) and operation_id:
        return refuse("DOLT_SQL_ERROR", "the connection was lost while committing; rerun with the same operation",
                      write_status="unknown", operation_id=operation_id)
    if statement:
        return refuse("SQL_STATEMENT_FAILED", f"the ledger refused the statement (MySQL error {code}): {shown}")
    return refuse("DOLT_SQL_ERROR", f"the ledger refused the statement (MySQL error {code}): {shown}")


def _commit_of(conn: LedgerConnection, table: str, op_id: str) -> str | None:
    found = conn.rows(f"SELECT to_commit FROM `dolt_diff_{table}` WHERE to_op_id = %s AND diff_type = 'added' "
                      "LIMIT 1", (op_id,))
    return found[0][0] if found else None


def write(conn: LedgerConnection, kind: str, payload: Mapping, table: str,
          insert: Callable[[LedgerConnection, str], Mapping],
          replay: Callable[[LedgerConnection, Mapping], Mapping] | None = None, *, op_id: str | None = None,
          attempts: int = 1) -> dict:
    """Run `insert(conn, op_id)` as one idempotent transaction and one Dolt commit.

    `table` holds the record's `op_id`; a prior row with that ID is returned through
    `replay(conn, row)` (default: the row) without writing. `op_id` overrides the ID derived
    from `kind` and `payload` where a function defines its own. Called while `conn` is already
    inside a write, the insert joins that transaction and the outer write commits it.
    `attempts` above one reruns the whole transaction on CONCURRENT_WRITE, up to that many
    transactions: the rerun looks the operation up again and runs `insert`, with its checks, on the
    new head.
    """
    nested, attempt = conn.in_write, 1
    while True:
        try:
            return _write_once(conn, kind, payload, table, insert, replay, op_id)
        except Refusal as exc:
            if exc.code != "CONCURRENT_WRITE" or nested or attempt >= attempts:
                raise
        time.sleep(RETRY_PAUSE * attempt)
        attempt += 1


def _write_once(conn: LedgerConnection, kind: str, payload: Mapping, table: str,
                insert: Callable[[LedgerConnection, str], Mapping],
                replay: Callable[[LedgerConnection, Mapping], Mapping] | None, op_id: str | None) -> dict:
    if (conn.role != "writer" or isinstance(conn, ReadConnection)
            or conn.branch != conn.profile.research_branch):
        raise refuse("READ_ONLY_CONNECTION", "writes need the writer connection on the research branch")
    if not IDENTIFIER.fullmatch(table):
        raise ValueError(f"invalid table name {table!r}")
    op = op_id or derive_op_id(kind, payload)
    if len(op) > OP_ID_LIMIT:
        raise ValueError(f"operation ID longer than {OP_ID_LIMIT} characters")
    if conn.in_write:
        prior = conn.one(f"SELECT * FROM `{table}` WHERE op_id = %s", (op,))
        if prior is not None:
            return {"record": replay(conn, prior) if replay else prior, "op_id": op, "commit": None,
                    "replayed": True, "write_status": "replayed"}
        return {"record": insert(conn, op), "op_id": op, "commit": None, "replayed": False,
                "write_status": "written"}
    raw = conn.raw
    try:
        raw.autocommit(False)
        raw.begin()
        conn.in_write = True
        try:
            prior = conn.one(f"SELECT * FROM `{table}` WHERE op_id = %s", (op,))
            if prior is not None:
                raw.rollback()
                conn.in_write = False
                record = replay(conn, prior) if replay else prior
                return {"record": record, "op_id": op, "commit": _commit_of(conn, table, op), "replayed": True,
                        "write_status": "replayed"}
            if conn.rows("SELECT table_name FROM dolt_status"):
                raise refuse("DIRTY_WORKING_SET", "the research branch has uncommitted SQL changes; nothing was "
                                                  "written")
            record = insert(conn, op)
            conn.rows("UPDATE ledger_head SET seq = seq + 1, op_id = %s WHERE singleton = 1", (op,))
            require_commit_checks(conn)
            try:
                with raw.cursor() as cursor:
                    cursor.execute("CALL DOLT_COMMIT('-a', '-m', %s)", (f"{kind}:{op}",))
                    (commit,), = cursor.fetchall()
                raw.commit()
            except pymysql.MySQLError as exc:
                names: tuple[str, ...] = ()
                if _error_text(exc).startswith(VERIFICATION_FAILED):
                    raw.rollback()
                    names = tuple(name for (name,) in conn.rows("SELECT test_name FROM dolt_tests"))
                raise _sql_error(exc, operation_id=op, test_names=names) from exc
        except BaseException:
            try:
                raw.rollback()
            except pymysql.MySQLError:
                pass
            raise
        finally:
            conn.in_write = False
            try:
                raw.autocommit(True)
            except pymysql.MySQLError:
                pass
    except pymysql.MySQLError as exc:
        raise _sql_error(exc, operation_id=op) from exc
    return {"record": record, "op_id": op, "commit": commit, "replayed": False, "write_status": "written"}


def upgrade(profile: LedgerProfile) -> dict:
    """ledger upgrade: create the tables and triggers of ledger/schema.sql that the research branch lacks
    (the administrator, one commit through the commit verification group). The schema version, existing
    tables, rows, accounts and grants are untouched (the accounts' grants are database-wide); a clean
    working set is required."""
    config = _known_service(profile.service_root)
    start_service(profile.service_root)
    conn = _admin(config, database=f"{profile.database}/{profile.research_branch}")
    created: list[str] = []
    commit = None
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT table_name FROM dolt_status")
            if cursor.fetchall():
                raise refuse("DIRTY_WORKING_SET", f"ledger {profile.database} has uncommitted changes")
            cursor.execute("SHOW TABLES")
            existing = {"TABLE": {row[0].lower() for row in cursor.fetchall()}}
            cursor.execute("SHOW TRIGGERS")
            existing["TRIGGER"] = {row[0].lower() for row in cursor.fetchall()}
            for statement in _statements(SCHEMA.read_text(encoding="utf-8")):
                found = re.match(r"CREATE\s+(TABLE|TRIGGER)\s+`?(\w+)`?", statement, re.IGNORECASE)
                if found and found.group(2).lower() not in existing[found.group(1).upper()]:
                    cursor.execute(statement)
                    created.append(found.group(2))
            if created:
                cursor.execute("CALL DOLT_COMMIT('-A', '-m', %s)", ("schema: " + ", ".join(created),))
                (commit,), = cursor.fetchall()
    except pymysql.MySQLError as exc:
        raise _sql_error(exc) from exc
    finally:
        conn.close()
    return {"database": profile.database, "branch": profile.research_branch, "created": created, "commit": commit}


def upgrade_market(profile: dict) -> dict:
    """market upgrade: create the tables of market/schema.sql that the market database lacks (the
    administrator, one commit that skips the data tests: tables only). Existing tables, rows, accounts
    and grants are untouched; a clean working set is required. The import lock is held, so no import
    or backup runs meanwhile."""
    service_root = Path(profile["service"])
    config = _known_service(service_root)
    start_service(service_root)
    database = profile["database"]
    conn = _admin(config, database=database)
    created: list[str] = []
    commit = None
    try:
        with conn.cursor() as cursor:
            lock = f"market-import:{database}"
            cursor.execute("SELECT GET_LOCK(%s, 0)", (lock,))
            if cursor.fetchone()[0] != 1:
                raise refuse("CONCURRENT_IMPORT", f"an import or backup of {database} holds {lock}; nothing was "
                                                  "created", missing=(lock,))
            cursor.execute("SELECT table_name FROM dolt_status")
            if cursor.fetchall():
                raise refuse("DIRTY_WORKING_SET", f"market database {database} has uncommitted changes")
            cursor.execute("SHOW TABLES")
            existing = {row[0].lower() for row in cursor.fetchall()}
            for statement in _statements(MARKET_SCHEMA.read_text(encoding="utf-8")):
                table = re.match(r"CREATE TABLE\s+`?(\w+)`?", statement, re.IGNORECASE)
                if table and table.group(1).lower() not in existing:
                    cursor.execute(statement)
                    created.append(table.group(1))
            if created:
                cursor.execute("CALL DOLT_COMMIT('-A', '--skip-verification', '-m', %s)",
                               ("market tables: " + ", ".join(created),))
                (commit,), = cursor.fetchall()
    finally:
        conn.close()
    return {"database": database, "created": created, "commit": commit}
