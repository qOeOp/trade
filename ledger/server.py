"""The Dolt service of a ledger: its directory, process, configuration and administrator connection.

A service is one `dolt sql-server` with its own directory and accounts; it may hold several databases.
`service.json` in its directory records the binary, the Unix socket (none for a service compose runs, which
is reached over TCP), the port, the administrator's password and each database's accounts. A service this
host runs is started and stopped here (`start_service`, `stop_service`); one compose runs (`ledger service
run`) is only waited for. The databases, their accounts and connections are ledger.db's.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time

import pymysql
import pymysql.constants.CR

from shared.errors import Refusal
from shared import profiles as profile_directory
from shared.refusals import refuse


DOLT_VERSION = "2.7.2"
SOCKET_LIMIT = 100  # macOS sun_path holds 104 bytes
# The host every service is reached at over TCP, on its own port, instead of its Unix socket: set in a
# container that cannot reach the socket (the paper daemon's, docs/plans/paper-compose-deployment.zh.md).
DOLT_HOST = "TRADE_DOLT_HOST"
# Seconds a new connection waits for the server's greeting and login replies. A serving Dolt answers
# in milliseconds; the statements' own read timeout (600 s for ledger commands) applies only after.
HANDSHAKE_TIMEOUT = 30
SERVER_LAUNCH = '"$@" </dev/null >>server.log 2>&1 & echo $!'
REMOTE = "origin"  # the one Dolt remote a ledger publishes to (ledger.publish) or a replica syncs from
IDENTITY = {"user.name": "Research Ledger", "user.email": "research-ledger@example.invalid"}
# Dolt otherwise queries GitHub for a newer release and records the answer in its home at a start, and writes
# usage events there from a detached process after a command exits.
QUIET = {"versioncheck.disabled": "true", "metrics.disabled": "true"}
# secure_file_priv: a directory that can never exist, so no account reads or writes a server file
# (SELECT INTO OUTFILE/DUMPFILE, LOAD_FILE): Dolt allows both to a SELECT-only account without it (2.4.2, and
# 2.7.2 measured 2026-11-11).
NO_FILE_IO = "system_variables:\n  secure_file_priv: /dev/null/no-file-io\n"


# The service directory

def service_config(root: Path) -> dict | None:
    try:
        return json.loads((Path(root) / "service.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def known_service(root: Path) -> dict:
    """The service configuration of `root`; a directory without a readable one is no ledger service."""
    config = service_config(root)
    if config is None:
        raise refuse("LEDGER_UNKNOWN", f"{root} is not a ledger service directory")
    return config


def dolt_home(home: Path, settings: Mapping[str, str]) -> None:
    """Give a new Dolt home (its DOLT_ROOT_PATH) its global configuration in one atomic write, the file
    `dolt config --global --add` keeps, without starting Dolt once per setting."""
    profile_directory.private_write(Path(home) / ".dolt" / "config_global.json", dict(settings))


def binary(given: Path | str | None = None) -> str:
    """The Dolt DOLT_VERSION executable `given`, else RESEARCH_DOLT_BINARY's, else the one on PATH."""
    expected = f"dolt version {DOLT_VERSION}"
    candidate = given or os.environ.get("RESEARCH_DOLT_BINARY") or shutil.which("dolt")
    if not candidate:
        raise refuse("DOLT_BINARY", "no Dolt executable given, in RESEARCH_DOLT_BINARY or on PATH", expected=expected)
    found = Path(candidate).expanduser().resolve()
    # Its own home and working directory: the caller's HOME and directory are shared with other processes.
    work = Path(tempfile.mkdtemp(prefix="dolt-version-"))
    try:
        dolt_home(work, QUIET)
        checked = subprocess.run([str(found), "version"], cwd=work, capture_output=True, text=True, check=False,
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
        raise refuse("DOLT_BINARY", f"{found} is not a Dolt {DOLT_VERSION} executable ({problem})", expected=expected)
    return str(found)


def write_config(root: Path, data_dir: Path, host: str, port: int, socket_path: Path | None = None,
                 auto_gc: bool = False) -> None:
    """The service's config.yaml: listening on `host`:`port` (and `socket_path`), its data in `data_dir`, its
    privileges and branch grants under `root`/cfg, no server file reads or writes (NO_FILE_IO); `auto_gc` keeps
    Dolt's automatic garbage collection on."""
    (root / "config.yaml").write_text(
        "log_level: warning\n"
        "behavior:\n  autocommit: true\n" + ("  auto_gc_behavior:\n    enable: true\n" if auto_gc else "")
        + f"listener:\n  host: {host}\n  port: {port}\n" + (f"  socket: {socket_path}\n" if socket_path else "")
        + f"data_dir: {data_dir}\ncfg_dir: {root / 'cfg'}\n"
        f"privilege_file: {root / 'cfg' / 'privileges.db'}\n"
        f"branch_control_file: {root / 'cfg' / 'branch_control.db'}\n" + NO_FILE_IO, encoding="utf-8")


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


# Reaching the service

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
    host on the service's own port (a container beside the service), unless the service's server is a
    process of this host (one this container started, as `ledger temp` does: the variable names where
    the other services run, not this one); else over its Unix socket; a service compose runs (no
    socket) over TCP on this host's loopback, where compose publishes it.
    pymysql 1.1.2 leaks its socket when the Unix connect itself fails (a stopped service), so the
    socket is reached first by one that is closed either way, and an unreachable one raises the same
    OperationalError pymysql would.

    pymysql reads the handshake under `read_timeout`, so a service that accepts but never answers
    would hold the caller for its whole statement budget (or forever without one). The handshake is
    read under HANDSHAKE_TIMEOUT instead and raises NoAnswer when it runs out; the caller's
    `read_timeout` then applies to its statements."""
    read_timeout = options.pop("read_timeout", None)
    options["read_timeout"] = HANDSHAKE_TIMEOUT
    # A socket service's root holds its socket (create_service).
    if os.environ.get(DOLT_HOST) and (managed(config) or _server_here(Path(config["socket"]).parent) is None):
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


def connection_error(exc: pymysql.MySQLError) -> Refusal:
    """The refusal of a connection the service did not accept."""
    code = exc.args[0] if exc.args else None
    if code in (1044, 1045, 1227):
        return refuse("LEDGER_PERMISSION", "the ledger service refused this account")
    if code == 1049:
        return refuse("UNKNOWN_REF", "the ledger has no such branch")
    if isinstance(exc, NoAnswer):
        return refuse("LEDGER_UNAVAILABLE", exc.args[1])
    return refuse("LEDGER_UNAVAILABLE", "the ledger service is not running or does not accept connections")


def connect_root(config: dict, password: str | None = None, database: str | None = None) -> pymysql.Connection:
    """The service administrator's connection (`password` given only before root has its own); its errors are
    pymysql's."""
    if password is None:
        if "root_password" not in config:  # a reader-only service file
            raise refuse("LEDGER_UNKNOWN", "this service file holds only reader accounts, not the service "
                                           "administrator")
        password = config["root_password"]
    return service_connection(config, user="root", password=password, database=database, autocommit=True,
                              connect_timeout=5, max_allowed_packet=1 << 30)


def admin(profile) -> pymysql.Connection:
    """The service administrator's connection to a profile's database (its service_root and database); a service
    that does not accept it is connection_error's refusal."""
    config = known_service(profile.service_root)
    try:
        return connect_root(config, database=profile.database)
    except pymysql.MySQLError as exc:
        raise connection_error(exc) from exc


def cursor_rows(cursor, statement: str, arguments=()) -> list[tuple]:
    """The rows of one statement on a raw (administrator) cursor."""
    cursor.execute(statement, arguments)
    return list(cursor.fetchall())


def origin(cursor) -> str | None:
    """The URL of the selected database's REMOTE, None without one."""
    found = cursor_rows(cursor, "SELECT url FROM dolt_remotes WHERE name = %s", (REMOTE,))
    return found[0][0] if found else None


# The server process

def _server_here(root: Path) -> int | None:
    """The process server.pid names when it runs here, as the sql-server of `root`'s config; the file stays."""
    try:
        pid = int((root / "server.pid").read_text())
    except (OSError, ValueError):
        return None
    owner = subprocess.run(["ps", "-ww", "-p", str(pid), "-o", "args="], capture_output=True, text=True, check=False)
    if owner.returncode or "sql-server" not in owner.stdout or str(root / "config.yaml") not in owner.stdout:
        return None
    return pid


def server_pid(root: Path) -> int | None:
    """The running server of `root`, removing a server.pid that names none (a root without one, such as a
    read-only reader mount, is left untouched)."""
    pid = _server_here(root)
    if pid is None and (root / "server.pid").exists():
        (root / "server.pid").unlink()
    return pid


def wait_ready(config: dict, running: Callable[[], bool] | None = None, password: str | None = None,
               seconds: float = 15) -> None:
    """Wait until the service administrator connects. `running` says whether the server this process started
    still runs; without it the service is compose's, which is only waited for. A service that accepts but does
    not answer (NoAnswer), whose server exits, or that does not accept in `seconds` is LEDGER_START."""
    deadline = time.monotonic() + seconds
    while True:
        try:
            connect_root(config, password).close()
            return
        except NoAnswer as exc:
            raise refuse("LEDGER_START", exc.args[1], expected=None if running else (
                "an answer on a rerun after a minute or two; only then `docker compose restart ledger`, which rolls "
                "back an import in progress")) from exc
        except pymysql.MySQLError:
            if (running is not None and not running()) or time.monotonic() >= deadline:
                break
            time.sleep(0.1)
    if running is None:
        raise refuse("LEDGER_START", f"the Dolt service compose runs does not accept connections at {address(config)}",
                     expected="the user starting the ledger service (`docker compose start ledger`); then rerun "
                     "the same command")
    raise refuse("LEDGER_START", f"the Dolt service at {address(config)} did not accept connections in time or exited")


def start_service(root: Path) -> dict:
    """Start the service of `root` unless it runs; wait until it accepts connections. A service compose
    runs is only waited for."""
    root = Path(root)
    config = known_service(root)
    if managed(config):
        wait_ready(config)
        return {"running": True, "pid": None, "service": str(root)}
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
    try:
        wait_ready(config, lambda: server_pid(root) is not None)
    except Refusal:
        print(f"ledger service log: {root / 'server.log'}", file=sys.stderr)
        raise
    return {"running": True, "pid": pid, "service": str(root)}


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


def stop(server: subprocess.Popen) -> None:
    """Stop a server this process runs as its child: terminated, killed after 30 s."""
    if server.poll() is None:
        server.terminate()
        try:
            server.wait(timeout=30)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait()


def create_service(root: Path, dolt: str) -> dict:
    """A new service of this host in the empty `root` with the Dolt executable `dolt`: its directories,
    config.yaml on a free port and a socket in `root`, its Dolt home, and root's own password; started."""
    socket_path = root / "mysql.sock"
    if len(str(socket_path)) > SOCKET_LIMIT:
        raise refuse("LEDGER_START", f"the service socket path would exceed {SOCKET_LIMIT} bytes",
                     expected="a shorter service directory")
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    for name in ("data", "cfg", "home"):
        (root / name).mkdir(mode=0o700)
    port = free_port()
    write_config(root, root / "data", "127.0.0.1", port, socket_path)
    dolt_home(root / "home", {**QUIET, **IDENTITY})
    config = {"binary": dolt, "socket": str(socket_path), "port": port,
              "root_password": secrets.token_urlsafe(24), "databases": {}, "secured": False}
    profile_directory.private_write(root / "service.json", {**config, "root_password": ""})
    start_service(root)
    conn = connect_root(config, password="")
    try:
        with conn.cursor() as cursor:
            cursor.execute("ALTER USER 'root'@'localhost' IDENTIFIED BY %s", (config["root_password"],))
    finally:
        conn.close()
    profile_directory.private_write(root / "service.json", config)
    return config
