"""The research ledger's service, accounts, connections and its single write protocol.

A service is one local `dolt sql-server` with its own directory, unix socket and accounts; it may
hold several databases. A profile names one database on one service, what it holds (`research`, the
research ledger of ledger/schema.sql, or `paper`, the Paper execution records of ledger/paper.sql) and
its kind (`active`, `isolated` or `temporary`; only a research ledger is active). Each database has a
writer account (SELECT, INSERT, UPDATE of `ledger_head`, EXECUTE of `dolt_commit`, branch write on
`BRANCH` only; a research ledger's writer may also UPDATE `run_reading`, a Paper database's writer
DELETE) and a reader account (SELECT). Administration stays inside `init`. On another branch Dolt 2.7.2
still lets the writer insert into a table with a BEFORE INSERT trigger (measured; accepted by the user
2026-11-11), but never commit there, so such rows stay in that branch's working set and reach no history.

Every write is one transaction on one writer connection: look the operation up by `op_id` (a
retry returns the original record), refuse a dirty working set, insert, bump the single
`ledger_head` row and `dolt_commit`. The schema's keys, CHECKs and foreign keys hold the records'
rules (`ledger review` verifies the foreign keys a writer session could switch off). Two concurrent
writers both change `ledger_head`, so Dolt refuses the later one (error 1213) instead of merging.
A write whose checks are rerun on the new head (opening a trial, a registration, a sealed capture,
run or reseal, a Paper source) reruns its transaction a few times on that refusal; every other write
returns it to the caller.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
import copy
from dataclasses import dataclass
from datetime import date
import functools
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
import tempfile
import time
from typing import Concatenate, Literal

import pymysql
import pymysql.constants.CR

from shared.errors import Refusal
from shared import paths, profiles as profile_directory
from shared.refusals import refuse


SCHEMA_VERSION = 1
PAPER_SCHEMA_VERSION = 1
DOLT_VERSION = "2.7.2"
KINDS = ("active", "isolated", "temporary")
ROLES = ("writer", "reader")
SOCKET_LIMIT = 100  # macOS sun_path holds 104 bytes
# The host every service is reached at over TCP, on its own port, instead of its Unix socket: set in a
# container that cannot reach the socket (the paper daemon's, docs/plans/paper-compose-deployment.zh.md).
DOLT_HOST = "TRADE_DOLT_HOST"
# Seconds a new connection waits for the server's greeting and login replies. A serving Dolt answers
# in milliseconds; the statements' own read timeout (600 s for ledger commands) applies only after.
HANDSHAKE_TIMEOUT = 30
SCHEMA = Path(__file__).with_name("schema.sql")
PAPER_SCHEMA = Path(__file__).with_name("paper.sql")
# What a database holds: its schema file and generation.
SCHEMAS = {"research": (SCHEMA, SCHEMA_VERSION), "paper": (PAPER_SCHEMA, PAPER_SCHEMA_VERSION)}
BRANCH = "main"  # the one branch of a research ledger
NAME = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")
DATABASE = re.compile(r"[A-Za-z0-9_]{1,64}\Z")
REF = re.compile(r"[A-Za-z0-9][A-Za-z0-9_./-]{0,199}\Z")
COMMIT_HASH = re.compile(r"[0-9a-v]{32}\Z")
IDENTIFIER = re.compile(r"[a-z_][a-z0-9_]*\Z")
OP_ID_LIMIT = 160
WRITE_ATTEMPTS = 5  # transactions a write that reruns its checks tries before CONCURRENT_WRITE reaches its caller
RETRY_PAUSE = 0.5  # seconds before the next attempt, times the number of attempts made
# trial.image_ref is <repository>@sha256:<digest>; its digest is read, not stored.
IMAGE_DIGEST = "SUBSTRING_INDEX(image_ref, '@', -1) AS image_digest"
TRIAL_IMAGE_DIGEST = "SUBSTRING_INDEX(t.image_ref, '@', -1) AS image_digest"  # trial aliased `t`
SERVER_LAUNCH = '"$@" </dev/null >>server.log 2>&1 & echo $!'


# Profiles

@dataclass(frozen=True)
class LedgerProfile:
    """A named database on one service; `kind` is its lifecycle, `holds` its content (a key of SCHEMAS)."""

    name: str
    database: str
    service_root: Path
    kind: str | None = "isolated"  # None: a profile file that names no lifecycle
    backup_root: Path | None = None
    holds: str = "research"

    def as_json(self) -> dict:
        return {"name": self.name, "kind": self.kind, "holds": self.holds, "database": self.database,
                "service": str(self.service_root),
                "backup": str(self.backup_root) if self.backup_root else None}

    @classmethod
    def from_json(cls, value: dict) -> LedgerProfile:
        if value.get("holds", "research") not in ("research", "paper"):
            raise KeyError("holds")  # a market's profile
        return cls(name=value["name"], database=value["database"], service_root=Path(value["service"]),
                   kind=value.get("kind"), backup_root=Path(value["backup"]) if value.get("backup") else None,
                   holds=value.get("holds", "research"))


def profiles() -> dict[str, LedgerProfile]:
    found = {}
    for name, value in profile_directory.entries().items():
        try:
            found[name] = LedgerProfile.from_json(value)
        except (KeyError, TypeError):
            continue
    return found


def load_profile(name: str) -> LedgerProfile:
    found = profiles().get(name)
    if found is None:
        raise refuse("LEDGER_UNKNOWN", f"there is no ledger profile named {name!r}", missing=(name,))
    return found


def profile(ledger: LedgerProfile | str | None, holds: str | None = "research") -> LedgerProfile:
    """The database holding `holds` named by a profile, a profile file path, a profile name, or None: the
    active research ledger, or the one Paper database. `holds` None takes a named database of either content
    (its service), and None the active research ledger."""
    if isinstance(ledger, LedgerProfile):
        found = ledger
    elif ledger is not None and profile_directory.is_path(ledger):
        try:
            found = LedgerProfile.from_json(profile_directory.read_file(Path(ledger).expanduser()))
        except (KeyError, TypeError) as exc:
            raise refuse("LEDGER_UNKNOWN", f"{ledger} is not a ledger profile", missing=(ledger,)) from exc
    elif ledger is not None:
        found = load_profile(ledger)
    else:
        holds = holds or "research"
        candidates = [value for value in profiles().values()
                      if value.holds == holds and (holds != "research" or value.kind == "active")]
        if len(candidates) != 1:
            what = "an active research ledger" if holds == "research" else f"one {holds} database"
            raise refuse("LEDGER_UNKNOWN", f"there is not exactly {what} profile; name one",
                         missing=("active" if holds == "research" else holds,))
        found = candidates[0]
    if holds is not None and found.holds != holds:
        raise refuse("LEDGER_KIND", f"profile {found.name} holds {found.holds}, not {holds}", expected=holds)
    return found


def service_config(root: Path) -> dict | None:
    try:
        return json.loads((Path(root) / "service.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _known_service(root: Path) -> dict:
    """The service configuration of `root`; a directory without a readable one is no ledger service."""
    config = service_config(root)
    if config is None:
        raise refuse("LEDGER_UNKNOWN", f"{root} is not a ledger service directory")
    return config


# Service lifecycle

IDENTITY = {"user.name": "Research Ledger", "user.email": "research-ledger@example.invalid"}
# Dolt otherwise queries GitHub for a newer release and records the answer in its home at a start, and writes
# usage events there from a detached process after a command exits.
QUIET = {"versioncheck.disabled": "true", "metrics.disabled": "true"}


def dolt_home(home: Path, settings: Mapping[str, str]) -> None:
    """Give a new Dolt home (its DOLT_ROOT_PATH) its global configuration in one atomic write, the file
    `dolt config --global --add` keeps, without starting Dolt once per setting."""
    profile_directory.private_write(Path(home) / ".dolt" / "config_global.json", dict(settings))


def _binary(given: Path | str | None) -> str:
    expected = f"dolt version {DOLT_VERSION}"
    candidate = given or os.environ.get("RESEARCH_DOLT_BINARY") or shutil.which("dolt")
    if not candidate:
        raise refuse("DOLT_BINARY", "no Dolt executable given, in RESEARCH_DOLT_BINARY or on PATH", expected=expected)
    binary = Path(candidate).expanduser().resolve()
    # Its own home and working directory: the caller's HOME and directory are shared with other processes.
    work = Path(tempfile.mkdtemp(prefix="dolt-version-"))
    try:
        dolt_home(work, QUIET)
        checked = subprocess.run([str(binary), "version"], cwd=work, capture_output=True, text=True, check=False,
                                 timeout=30, env={**os.environ, "DOLT_ROOT_PATH": str(work),
                                                  "DOLT_DISABLE_EVENT_FLUSH": "true"})
        output = " ".join(part.strip() for part in (checked.stdout, checked.stderr) if part.strip())
        problem = None if checked.returncode == 0 and checked.stdout.startswith(expected) else \
            f"exit {checked.returncode}: {output[-300:] or 'no output'}"
    except (OSError, subprocess.TimeoutExpired) as exc:
        problem = f"{type(exc).__name__}: {exc}"
    finally:
        shutil.rmtree(work, ignore_errors=True)
    if problem is not None:
        raise refuse("DOLT_BINARY", f"{binary} is not a Dolt {DOLT_VERSION} executable ({problem})", expected=expected)
    return str(binary)


def server_pid(root: Path) -> int | None:
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


class NoAnswer(pymysql.err.OperationalError):
    """The service accepted the connection but sent no greeting or login reply in HANDSHAKE_TIMEOUT:
    it is running, not stopped; a long write such as an import can stall it for minutes, or its process,
    its container or the Docker host is hung."""


def service_connection(config: dict, **options) -> pymysql.Connection:
    """`pymysql.connect` to the service `config` describes: with `TRADE_DOLT_HOST` set over TCP to that
    host on the service's own port (a container beside the service); else over its Unix socket; a
    service compose runs (no socket) over TCP on this host's loopback, where compose publishes it.
    pymysql 1.1.2 leaks its socket when the Unix connect itself fails (a stopped service), so the
    socket is reached first by one that is closed either way, and an unreachable one raises the same
    OperationalError pymysql would.

    pymysql reads the handshake under `read_timeout`, so a service that accepts but never answers
    would hold the caller for its whole statement budget (or forever without one). The handshake is
    read under HANDSHAKE_TIMEOUT instead and raises NoAnswer when it runs out; the caller's
    `read_timeout` then applies to its statements."""
    read_timeout = options.pop("read_timeout", None)
    options["read_timeout"] = HANDSHAKE_TIMEOUT
    if os.environ.get(DOLT_HOST):
        endpoint = f"{os.environ[DOLT_HOST]}:{config['port']}"
        target: dict = {"host": os.environ[DOLT_HOST], "port": int(config["port"])}
    elif managed(config):
        endpoint, target = address(config), {"host": "127.0.0.1", "port": int(config["port"])}
    else:
        socket_path = endpoint = config["socket"]
        target = {"unix_socket": socket_path}
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
            probe.settimeout(options.get("connect_timeout", 10))
            try:
                probe.connect(socket_path)
            except OSError as exc:
                raise pymysql.err.OperationalError(
                    pymysql.constants.CR.CR_CONN_HOST_ERROR,
                    f"Can't connect to MySQL server on {socket_path!r} ({exc})",
                ) from exc
    try:
        raw = pymysql.connect(**target, **options)
    except pymysql.err.OperationalError as exc:
        # A read that timed out (CR_SERVER_LOST over a TimeoutError); a TCP connect that timed out is
        # CR_CONN_HOST_ERROR and stays a service that does not accept connections.
        lost = pymysql.constants.CR.CR_SERVER_LOST
        if exc.args and exc.args[0] == lost and isinstance(exc.__context__, TimeoutError):
            raise NoAnswer(lost, f"the ledger service at {endpoint} accepts connections but did not answer within "
                                 f"{HANDSHAKE_TIMEOUT} s (a long write such as an import can stall it for minutes; "
                                 "otherwise its process, its container or the Docker host is hung)",
                           ) from exc
        raise
    # pymysql has no setter (nor a typed attribute); every read applies `_read_timeout` anew.
    raw._read_timeout = read_timeout  # type: ignore[attr-defined]
    return raw


def _root_password(config: dict) -> str:
    """The service administrator's password; a reader-only service file holds none."""
    if "root_password" not in config:
        raise refuse("LEDGER_UNKNOWN", "this service file holds only reader accounts, not the service administrator")
    return config["root_password"]


def _admin(config: dict, password: str | None = None, database: str | None = None):
    return service_connection(config, user="root",
                           password=_root_password(config) if password is None else password,
                           database=database, autocommit=True, connect_timeout=5, max_allowed_packet=1 << 30)


def cursor_rows(cursor, statement: str, arguments=()) -> list[tuple]:
    """The rows of one statement on a raw (administrator) cursor."""
    cursor.execute(statement, arguments)
    return list(cursor.fetchall())


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
            except NoAnswer as exc:
                raise refuse("LEDGER_START", exc.args[1], expected="an answer on a rerun after a minute or two; only "
                             "then `docker compose restart ledger`, which rolls back an import in progress") from exc
            except pymysql.MySQLError:
                time.sleep(0.1)
        raise refuse("LEDGER_START", f"the Dolt service compose runs does not accept connections at {address(config)}",
                     expected="the user starting the ledger service (`docker compose start ledger`); then rerun "
                     "the same command")
    pid = server_pid(root)
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
        except NoAnswer as exc:
            print(f"ledger service log: {root / 'server.log'}", file=sys.stderr)
            raise refuse("LEDGER_START", exc.args[1]) from exc
        except pymysql.MySQLError:
            if server_pid(root) is None:
                break
            time.sleep(0.1)
    print(f"ledger service log: {root / 'server.log'}", file=sys.stderr)
    raise refuse("LEDGER_START", "the Dolt service did not accept connections in time or exited")


def stop_service(root: Path) -> dict:
    root = Path(root)
    config = service_config(root)
    if config is not None and managed(config):
        raise refuse("SERVICE_MANAGED", f"the Dolt service at {root} is run by compose, not by this host",
                     expected="`docker compose stop ledger`")
    pid = server_pid(root)
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
# (SELECT INTO OUTFILE/DUMPFILE, LOAD_FILE): Dolt allows both to a SELECT-only account without it (2.4.2, and
# 2.7.2 measured 2026-11-11).
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
    dolt_home(root / "home", {**QUIET, **IDENTITY})
    config = {"binary": binary, "socket": str(socket_path), "port": port,
              "root_password": secrets.token_urlsafe(24), "databases": {}, "secured": False}
    profile_directory.private_write(root / "service.json", {**config, "root_password": ""})
    start_service(root)
    conn = _admin(config, password="")
    try:
        with conn.cursor() as cursor:
            cursor.execute("ALTER USER 'root'@'localhost' IDENTIFIED BY %s", (config["root_password"],))
    finally:
        conn.close()
    profile_directory.private_write(root / "service.json", config)
    return config


def _statements(text: str) -> list[str]:
    lines = [line for line in text.splitlines() if not line.lstrip().startswith("--")]
    return [part.strip().rstrip(";") for part in "\n".join(lines).split(";\n") if part.strip().rstrip(";")]


def init(name: str, database: str, service_root: Path, kind: Literal["active", "isolated", "temporary"],
         backup_root: Path | None = None, dolt_binary: Path | None = None, holds: str = "research") -> dict:
    """Create the database, its schema and accounts on a (new or running) service; write the profile."""
    if (not isinstance(name, str) or not NAME.fullmatch(name) or not isinstance(database, str)
            or not DATABASE.fullmatch(database) or kind not in KINDS or holds not in SCHEMAS):
        raise refuse("INVALID_NAME", "the profile name, database name, kind or content is malformed",
                     expected="name [A-Za-z0-9_-], database [A-Za-z0-9_], kind active|isolated|temporary, "
                              "holds research|paper")
    if holds != "research" and kind == "active":
        raise refuse("LEDGER_KIND", "only a research ledger is active; a paper database is isolated or temporary",
                     expected="isolated | temporary")
    found = profiles()
    if name in found:
        raise refuse("LEDGER_EXISTS", f"a ledger profile named {name} already exists; nothing is replaced")
    actives = [value for value in found.values() if value.kind == "active"]
    if kind == "active" and actives:
        raise refuse("LEDGER_EXISTS", "an active research ledger already exists; there is only one")
    if kind != "active" and any(value.database == database for value in actives):
        raise refuse("ISOLATION_BREACH", f"database {database} is an active ledger's name; use another")
    service_root = Path(service_root).expanduser().absolute()
    if kind == "active":
        if backup_root is None:
            raise refuse("ISOLATION_BREACH", "an active ledger needs a backup directory outside its service",
                         missing=("backup_root",))
        for path in (service_root, Path(backup_root)):
            if paths.inside(path, paths.REPOSITORY) or paths.is_temporary(path):
                raise refuse("ISOLATION_BREACH", "an active ledger keeps its service and backup outside the "
                                                 "source checkout and temporary roots")
    binary = _binary(dolt_binary)
    config = _known_service(service_root) if (service_root / "service.json").exists() else _create_service(
        service_root, binary)
    start_service(service_root)
    profile = LedgerProfile(name=name, database=database, service_root=service_root, kind=kind,
                            backup_root=Path(backup_root).expanduser().absolute() if backup_root else None,
                            holds=holds)
    _provision(service_root, config, database,
               lambda cursor, accounts: _ledger_tables(cursor, database, accounts, holds),
               profile_directory.home() / f"{name}.json", profile.as_json())
    return {"profile": profile, "branch_grant": BRANCH, "schema_version": SCHEMAS[holds][1]}


def _secure(cursor, config: dict) -> None:
    if not config.get("secured"):
        # Once per service, with a database selected: branch writes need an explicit grant; root keeps
        # admin everywhere (deleting the wildcard row alone would also remove root's write).
        # IGNORE: a failed init that was rolled back may already have secured the service.
        cursor.execute("INSERT IGNORE INTO dolt_branch_control VALUES ('%', '%', 'root', 'localhost', 'admin')")
        cursor.execute("DELETE FROM dolt_branch_control WHERE `database` = '%' AND branch = '%' "
                       "AND user = '%' AND host = '%'")
    # The ledger keeps no commit verification tests; a service secured by an earlier product version runs
    # its persisted group on every commit, and a database without tests in it cannot commit.
    cursor.execute("SET PERSIST dolt_commit_verification_groups = ''")


def _account_name(database: str, role: str) -> str:
    return "lg-" + hashlib.sha256(f"{database}:{role}".encode()).hexdigest()[:29]


def _provision(service_root: Path, config: dict, database: str, build: Callable[[object, dict], None],
               profile_path: Path, profile: dict) -> None:
    """Create `database` on the running service with `build(cursor, accounts)` (its tables, its two
    accounts and their grants), record the accounts in service.json and
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
            build(cursor, accounts)
        config["secured"] = True
        config["databases"][database] = accounts
        recorded = True
        profile_directory.private_write(service_root / "service.json", config)
        profile_directory.private_write(profile_path, profile)
    except BaseException as failure:
        if created:
            try:
                _remove(service_root, config, database, accounts, recorded)
            except Exception as cleanup:  # the original failure stays the one raised
                failure.add_note(f"database {database} and its accounts could not be removed: {cleanup}")
        raise
    finally:
        conn.close()


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
        profile_directory.private_write(service_root / "service.json", config)


def ledger_schema(cursor, holds: str = "research") -> None:
    """The tables of a new database holding `holds`, on the selected database, committed."""
    schema, version = SCHEMAS[holds]
    for statement in _statements(schema.read_text(encoding="utf-8")):
        cursor.execute(statement)
    cursor.execute("INSERT INTO ledger_schema VALUES (1, %s)", (version,))
    cursor.execute("INSERT INTO ledger_head VALUES (1, 0, 'schema')")
    cursor.execute("CALL DOLT_COMMIT('-A', '-m', %s)", (f"schema:{version}",))


def _ledger_tables(cursor, database: str, accounts: dict, holds: str = "research") -> None:
    ledger_schema(cursor, holds)
    ledger_accounts(cursor, database, accounts, holds)


def ledger_accounts(cursor, database: str, accounts: dict, holds: str = "research") -> None:
    """The writer and reader accounts of a database, their grants and the writer's branch. A Paper
    database's writer may also DELETE (`paper delete` removes a sealed run's records)."""
    writer, reader = accounts["writer"]["user"], accounts["reader"]["user"]
    cursor.execute(f"CREATE USER '{writer}'@'%%' IDENTIFIED BY %s", (accounts["writer"]["password"],))
    cursor.execute(f"CREATE USER '{reader}'@'%%' IDENTIFIED BY %s", (accounts["reader"]["password"],))
    # Least privilege: no DELETE outside a Paper database; UPDATE only of the concurrency row and of the one
    # replaceable reading per run (Dolt 2.7.2 grants per table, not per column); no database-wide EXECUTE (it
    # would allow reset, tagging and branching), only DOLT_COMMIT by name. Known limit (measured on Dolt 2.7.2):
    # DOLT_COMMIT itself still accepts --amend and --date from the writer; `ledger review` finds it.
    cursor.execute(f"GRANT SELECT, INSERT{', DELETE' if holds == 'paper' else ''} ON `{database}`.* TO '{writer}'@'%'")
    cursor.execute(f"GRANT UPDATE ON `{database}`.ledger_head TO '{writer}'@'%'")
    if holds == "research":
        cursor.execute(f"GRANT UPDATE ON `{database}`.run_reading TO '{writer}'@'%'")
    cursor.execute(f"GRANT EXECUTE ON PROCEDURE `{database}`.dolt_commit TO '{writer}'@'%'")
    # dolt_branch_control matches database, branch and user as LIKE patterns, so `_` in them is a
    # wildcard (measured). Dolt does not honour
    # backslash escapes there: an escaped row stops matching the literal name, so names stay as given.
    # A lookalike branch can only come from the administrator; SQL grants are per literal database.
    cursor.execute("INSERT INTO dolt_branch_control VALUES (%s, %s, %s, '%%', 'write')", (database, BRANCH, writer))
    cursor.execute(f"GRANT SELECT ON `{database}`.* TO '{reader}'@'%'")


# Connections

def _days(names: list[str], row: tuple) -> tuple:
    """A market day reads back as its `YYYY-MM-DD` reference, the form every caller compares and stores."""
    return tuple(value.isoformat() if name == "market_day" and isinstance(value, date) else value
                 for name, value in zip(names, row, strict=True))


class LedgerConnection:
    """One command's connection to one database/branch, with its account role."""

    def __init__(self, raw, profile: LedgerProfile, role: str):
        self.raw, self._profile, self._role = raw, profile, role
        self.in_write = False

    profile = property(lambda self: self._profile)
    role = property(lambda self: self._role)
    database = property(lambda self: self._profile.database)

    def rows(self, statement: str, params=None) -> list[tuple]:
        try:
            with self.raw.cursor() as cursor:
                cursor.execute(statement, params)
                names = [column[0] for column in cursor.description or ()]
                result = [_days(names, row) for row in cursor.fetchall()]
                while cursor.nextset():
                    cursor.fetchall()
                return result
        except pymysql.MySQLError as exc:
            raise sql_error(exc) from exc

    def dicts(self, statement: str, params=None) -> list[dict]:
        try:
            with self.raw.cursor() as cursor:
                cursor.execute(statement, params)
                names = [column[0] for column in cursor.description or ()]
                return [dict(zip(names, _days(names, row), strict=True)) for row in cursor.fetchall()]
        except pymysql.MySQLError as exc:
            raise sql_error(exc) from exc

    def one(self, statement: str, params=None) -> dict | None:
        found = self.dicts(statement, params)
        return found[0] if found else None

    def many(self, statement: str, rows: list[tuple]) -> None:
        try:
            with self.raw.cursor() as cursor:
                cursor.executemany(statement, rows)
        except pymysql.MySQLError as exc:
            raise sql_error(exc) from exc

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

    def __init__(self, raw, profile, resolved_commit: str):
        super().__init__(raw, profile, "reader")
        self.resolved_commit = resolved_commit


_PINNED: ContextVar[dict | None] = ContextVar("pinned_reads", default=None)


@contextmanager
def reusing_pinned_reads() -> Iterator[None]:
    """Inside, a `pinned_read` on a ReadConnection answers a repeated read from its first answer: a commit never
    changes, so one graph reads each run once instead of once per comparison that names it. Nothing outlives the
    block, and a refusal is not kept."""
    token = _PINNED.set({})
    try:
        yield
    finally:
        _PINNED.reset(token)


def pinned_read[**P, R](read: Callable[Concatenate[LedgerConnection, P], R]) -> Callable[Concatenate[LedgerConnection, P], R]:
    """`read(conn, *args)` kept by its commit and arguments inside `reusing_pinned_reads`; each caller gets its own
    copy, so one may change what it got."""
    @functools.wraps(read)
    def reused(conn: LedgerConnection, *args: P.args, **kwargs: P.kwargs) -> R:
        kept = _PINNED.get()
        if kept is None or kwargs or not isinstance(conn, ReadConnection):
            return read(conn, *args, **kwargs)
        key = (read.__module__, read.__qualname__, conn.database, conn.resolved_commit, args)
        if key not in kept:
            kept[key] = read(conn, *args, **kwargs)
        return copy.deepcopy(kept[key])
    return reused


def _connection_error(exc: pymysql.MySQLError) -> Refusal:
    code = exc.args[0] if exc.args else None
    if code in (1044, 1045, 1227):
        return refuse("LEDGER_PERMISSION", "the ledger service refused this account")
    if code == 1049:
        return refuse("UNKNOWN_REF", "the ledger has no such branch")
    if isinstance(exc, NoAnswer):
        return refuse("LEDGER_UNAVAILABLE", exc.args[1])
    return refuse("LEDGER_UNAVAILABLE", "the ledger service is not running or does not accept connections")


def connect(profile: LedgerProfile, role: Literal["writer", "reader"]) -> LedgerConnection:
    """Open a writer or reader connection on `BRANCH`."""
    if role not in ROLES:
        raise refuse("INVALID_ROLE", f"role must be writer or reader, got {role!r}", expected="writer | reader")
    config = service_config(profile.service_root) or {}
    accounts = config.get("databases", {}).get(profile.database)
    if accounts is None or role not in accounts:
        raise refuse("LEDGER_UNKNOWN", f"the service of {profile.name} has no accounts for {profile.database}")
    try:
        raw = service_connection(config, user=accounts[role]["user"],
                                 password=accounts[role]["password"], database=f"{profile.database}/{BRANCH}",
                                 charset="utf8mb4", autocommit=True, connect_timeout=5, read_timeout=600,
                                 write_timeout=600, max_allowed_packet=1 << 30)
    except pymysql.MySQLError as exc:
        raise _connection_error(exc) from exc
    conn = LedgerConnection(raw, profile, role)
    try:
        version, expected = _schema_version(conn), SCHEMAS[profile.holds][1]
        if version != expected:
            raise refuse("SCHEMA_MISMATCH", f"{profile.holds} schema version {version}, this code expects {expected}",
                         expected=str(expected))
    except BaseException:
        conn.close()
        raise
    return conn


def _schema_version(conn: LedgerConnection) -> int | None:
    found = conn.rows("SELECT version FROM ledger_schema WHERE singleton = 1")
    return found[0][0] if found else None


def check_ref(ref) -> str:
    if not isinstance(ref, str) or not REF.fullmatch(ref) or ".." in ref:
        raise refuse("INVALID_REF", f"invalid ledger reference {ref!r}",
                     expected="a commit hash or branch name ([A-Za-z0-9_./-])")
    return ref


def resolve_commit(conn: LedgerConnection, ref: str) -> str:
    """The commit hash a branch or commit hash names on this database."""
    check_ref(ref)
    found = conn.rows("SELECT hash FROM dolt_branches WHERE name = %s", (ref,))
    if found:
        return found[0][0]
    if COMMIT_HASH.fullmatch(ref) and conn.rows("SELECT 1 FROM dolt_commits WHERE commit_hash = %s", (ref,)):
        return ref
    raise refuse("UNKNOWN_REF", f"{ref!r} is no commit or branch of this ledger", missing=(ref,))


def read_as_of(profile: LedgerProfile, at: str | None = None) -> ReadConnection:
    """A reader connection on `database/<commit>` for the exact commit `at` names (default: research head)."""
    ref = BRANCH if at is None else check_ref(at)
    base = connect(profile, "reader")
    try:
        commit = resolve_commit(base, ref)
        base.rows(f"USE `{profile.database}/{commit}`")
        version = _schema_version(base)
        expected_version = SCHEMAS[profile.holds][1]
        if version != expected_version:
            raise refuse("SCHEMA_MISMATCH", f"{profile.holds} schema version {version} at {commit} is not readable here",
                         expected=str(expected_version))
    except BaseException:
        base.close()
        raise
    return ReadConnection(base.raw, profile, commit)


def head_commit(conn: LedgerConnection) -> str:
    """The commit a connection reads: its pinned commit, else its branch head."""
    if isinstance(conn, ReadConnection):
        return conn.resolved_commit
    return conn.rows("SELECT DOLT_HASHOF('HEAD')")[0][0]


# Writes

def canonical_json(payload) -> str:
    """The product's canonical JSON: sorted keys, no spaces, UTF-8 text, no NaN or infinity (as the image's
    engine.config.config_sha256 and engine.compare write it)."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def derive_op_id(kind: str, payload: Mapping) -> str:
    """`kind:sha256(kind ‖ canonical_json(payload))`; the same payload gives the same ID."""
    digest = hashlib.sha256(kind.encode() + b"\x00" + canonical_json(payload).encode()).hexdigest()
    return f"{kind}:{digest}"


ERROR_TEXT_LIMIT = 300  # characters of the server's error text a refusal carries; its cause may be at either end


def _error_text(exc: pymysql.MySQLError) -> str:
    return str(exc.args[1]) if len(exc.args) > 1 else str(exc)


def sql_error(exc: pymysql.MySQLError, operation_id: str | None = None, statement: bool = False) -> Refusal:
    """The refusal of a server error; `statement`: the error of a caller's own read statement (`ledger sql`)."""
    code = exc.args[0] if exc.args else None
    text = _error_text(exc)
    half = ERROR_TEXT_LIMIT // 2
    shown = text if len(text) <= ERROR_TEXT_LIMIT else f"{text[:half]}...{text[-half:]}"
    if code == 1213:
        return refuse("CONCURRENT_WRITE", "another write landed first; this transaction was rolled back")
    if code in (1142, 1143, 1370) or (code == 1105 and "permission" in text.lower()):
        return refuse("LEDGER_PERMISSION", "the ledger account may not run this statement")
    if code in (2006, 2013) and operation_id:
        return refuse("DOLT_SQL_ERROR", "the connection was lost while committing; rerun with the same operation",
                      write_status="unknown", operation_id=operation_id)
    if statement:
        return refuse("SQL_STATEMENT_FAILED", f"the ledger refused the statement (MySQL error {code}): {shown}")
    return refuse("DOLT_SQL_ERROR", f"the ledger refused the statement (MySQL error {code}): {shown}")


def _commit_of(conn: LedgerConnection, table: str, op_id: str, key: str = "op_id") -> str | None:
    found = conn.rows(f"SELECT to_commit FROM `dolt_diff_{table}` WHERE `to_{key}` = %s AND diff_type = 'added' "
                      "LIMIT 1", (op_id,))
    return found[0][0] if found else None


def write(conn: LedgerConnection, kind: str, payload: Mapping, table: str,
          insert: Callable[[LedgerConnection, str], Mapping],
          replay: Callable[[LedgerConnection, Mapping], Mapping] | None = None, *, op_id: str | None = None,
          attempts: int = 1, key: str = "op_id") -> dict:
    """Run `insert(conn, op_id)` as one idempotent transaction and one Dolt commit.

    `table` holds the record's `op_id` (or, with `key`, the column, such as a primary key, whose value is the
    operation ID); a prior row with that ID is returned through
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
            return _write_once(conn, kind, payload, table, insert, replay, op_id, key)
        except Refusal as exc:
            if exc.code != "CONCURRENT_WRITE" or nested or attempt >= attempts:
                raise
        time.sleep(RETRY_PAUSE * attempt)
        attempt += 1


def _write_once(conn: LedgerConnection, kind: str, payload: Mapping, table: str,
                insert: Callable[[LedgerConnection, str], Mapping],
                replay: Callable[[LedgerConnection, Mapping], Mapping] | None, op_id: str | None,
                key: str = "op_id") -> dict:
    if conn.role != "writer":
        raise refuse("READ_ONLY_CONNECTION", "writes need the writer connection on the research branch")
    if not IDENTIFIER.fullmatch(table) or not IDENTIFIER.fullmatch(key):
        raise ValueError(f"invalid table or key name {table!r}, {key!r}")
    op = op_id or derive_op_id(kind, payload)
    if len(op) > OP_ID_LIMIT:
        raise ValueError(f"operation ID longer than {OP_ID_LIMIT} characters")
    if conn.in_write:
        prior = conn.one(f"SELECT * FROM `{table}` WHERE `{key}` = %s", (op,))
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
            prior = conn.one(f"SELECT * FROM `{table}` WHERE `{key}` = %s", (op,))
            if prior is not None:
                raw.rollback()
                conn.in_write = False
                record = replay(conn, prior) if replay else prior
                return {"record": record, "op_id": op, "commit": _commit_of(conn, table, op, key), "replayed": True,
                        "write_status": "replayed"}
            if conn.rows("SELECT table_name FROM dolt_status"):
                raise refuse("DIRTY_WORKING_SET", "the research branch has uncommitted SQL changes; nothing was "
                                                  "written")
            record = insert(conn, op)
            conn.rows("UPDATE ledger_head SET seq = seq + 1, op_id = %s WHERE singleton = 1", (op,))
            try:
                with raw.cursor() as cursor:
                    cursor.execute("CALL DOLT_COMMIT('-a', '-m', %s)", (f"{kind}:{op}",))
                    (commit,), = cursor.fetchall()
                raw.commit()
            except pymysql.MySQLError as exc:
                raise sql_error(exc, operation_id=op) from exc
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
        raise sql_error(exc, operation_id=op) from exc
    return {"record": record, "op_id": op, "commit": commit, "replayed": False, "write_status": "written"}

