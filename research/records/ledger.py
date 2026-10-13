"""Named ledgers on local Dolt services: profiles, lifecycle, backup, export and reads.

A service is one `dolt sql-server` with its own directory, unix socket and accounts; it can hold
several databases (the research ledger and market data). A profile names one database on one
service and its kind (`research` or `market`): `--ledger NAME` selects it. Profiles live in
`~/.local/share/trade/ledgers/` (`TRADE_LEDGER_HOME` overrides the directory for tests and
demonstrations). At most one profile of each kind may be `active`; `isolated` and `temporary`
ones must use a database name no active profile uses.
"""

from __future__ import annotations

import json
import hashlib
import os
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import tempfile
import time

from research.records.common import ROOT, RecordError, _is_temporary_path
from research.records import db


DEFAULT_HOME = Path.home() / ".local/share/trade/ledgers"
ROLES = ("active", "isolated", "temporary")
KINDS = ("research", "market")
SOCKET_LIMIT = 100  # macOS sun_path holds 104 bytes
COMMIT_TESTS = "commit"
SCHEMA = Path(__file__).with_name("schema.sql")
MARKET_SCHEMA = Path(__file__).parents[1] / "market" / "schema.sql"


def _refuse(message, code="LEDGER_REFUSED", **extra):
    return RecordError(message, code=code, write_status="not_written", **extra)


def home() -> Path:
    return Path(os.environ.get("TRADE_LEDGER_HOME", DEFAULT_HOME)).expanduser()


def _private_write(path: Path, value: dict) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(4)}")
    with open(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write("\n")
    os.replace(temporary, path)


def _read(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise _refuse(f"cannot read {path}: {exc}", "LEDGER_CONFIG") from exc


def profiles() -> dict[str, dict]:
    directory = home()
    if not directory.is_dir():
        return {}
    return {path.stem: _read(path) for path in sorted(directory.glob("*.json"))}


def kind(value: dict) -> str:
    return value.get("kind", "research")


def profile(name: str | None, of: str | None = "research") -> dict:
    """The named profile, or the active one of kind `of` when no name is given (`of=None`: any kind
    by name, the research ledger by default)."""
    found = profiles()
    if name is None:
        of = of or "research"
        active = [value for value in found.values() if value["role"] == "active" and kind(value) == of]
        if len(active) != 1:
            raise _refuse(f"no name given and no single active {of} profile", "LEDGER_UNSELECTED",
                          next_actions=["Pass the profile name (see `ledger status`)."])
        return active[0]
    if name not in found:
        raise _refuse(f"unknown ledger {name!r} in {home()}", "LEDGER_UNKNOWN",
                      next_actions=["List them with `ledger status`; create one with `ledger init`."])
    if of is not None and kind(found[name]) != of:
        raise _refuse(f"profile {name} holds {kind(found[name])} data, not {of}", "LEDGER_KIND")
    return found[name]


def service(value: dict) -> dict:
    return _read(Path(value["service"]) / "service.json")


def credentials(value: dict, role: str) -> tuple[str, str, str]:
    config = service(value)
    if role == "admin":
        return "root", config["root_password"], config["socket"]
    accounts = config["databases"].get(value["database"])
    if accounts is None:
        raise _refuse(f"service {value['service']} has no accounts for {value['database']}", "LEDGER_CONFIG")
    return accounts[role]["user"], accounts[role]["password"], config["socket"]


def require_writable(value: dict) -> None:
    """An isolated or temporary profile may never use an active profile's database name."""
    if value["role"] == "active":
        return
    for other in profiles().values():
        if other["role"] == "active" and other["database"] == value["database"]:
            raise _refuse(f"ledger {value['name']} uses the active database name {value['database']}",
                          "ISOLATION_BREACH")


# Service lifecycle

def _binary(path) -> str:
    binary = Path(path).expanduser().resolve()
    checked = subprocess.run([str(binary), "version"], capture_output=True, text=True, check=False)
    if checked.returncode or not checked.stdout.startswith(f"dolt version {db.DOLT_VERSION}"):
        raise _refuse(f"expected a Dolt {db.DOLT_VERSION} binary: {binary}", "DOLT_BINARY")
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


def _admin(config: dict, password: str | None = None, database: str | None = None):
    import pymysql
    return pymysql.connect(unix_socket=config["socket"], user="root",
                           password=config["root_password"] if password is None else password,
                           database=database, autocommit=True, connect_timeout=5, max_allowed_packet=1 << 30)


def start_service(root: Path) -> dict:
    root = Path(root)
    config = _read(root / "service.json")
    pid = _pid(root)
    if pid is None:
        environment = {**os.environ, "DOLT_ROOT_PATH": str(root / "home")}
        with (root / "server.log").open("ab") as log:
            process = subprocess.Popen([config["binary"], "sql-server", "--config", str(root / "config.yaml")],
                                       cwd=root, stdout=log, stderr=log, start_new_session=True, env=environment)
        (root / "server.pid").write_text(str(process.pid))
        pid = process.pid
    for _ in range(100):
        try:
            _admin(config).close()
            return {"running": True, "pid": pid, "service": str(root)}
        except Exception:
            if _pid(root) is None:
                raise _refuse(f"Dolt server exited; inspect {root / 'server.log'}", "LEDGER_START")
            time.sleep(0.1)
    raise _refuse(f"Dolt server did not accept connections; inspect {root / 'server.log'}", "LEDGER_START")


def stop_service(root: Path) -> dict:
    root = Path(root)
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
        raise _refuse(f"Dolt server {pid} did not stop", "LEDGER_STOP")
    (root / "server.pid").unlink(missing_ok=True)
    return {"running": False, "pid": pid, "service": str(root)}


def _create_service(root: Path, binary: str, port: int) -> dict:
    socket_path = root / "mysql.sock"
    if len(str(socket_path)) > SOCKET_LIMIT:
        raise _refuse(f"socket path {socket_path} is longer than {SOCKET_LIMIT} bytes; use a shorter service root",
                      "SOCKET_PATH")
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    for name in ("data", "cfg", "home"):
        (root / name).mkdir(mode=0o700)
    (root / "config.yaml").write_text(
        "log_level: warning\n"
        "behavior:\n  autocommit: true\n"
        f"listener:\n  host: 127.0.0.1\n  port: {port}\n  socket: {socket_path}\n"
        f"data_dir: {root / 'data'}\ncfg_dir: {root / 'cfg'}\n"
        f"privilege_file: {root / 'cfg' / 'privileges.db'}\n"
        f"branch_control_file: {root / 'cfg' / 'branch_control.db'}\n", encoding="utf-8")
    environment = {**os.environ, "DOLT_ROOT_PATH": str(root / "home")}
    for key, value in (("user.name", "Research Ledger"), ("user.email", "research-ledger@example.invalid")):
        subprocess.run([binary, "config", "--global", "--add", key, value], env=environment, check=True,
                       capture_output=True)
    config = {"binary": binary, "socket": str(socket_path), "port": port,
              "root_password": secrets.token_urlsafe(24), "databases": {}}
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


def _secure_service(cursor) -> None:
    """Once per service, with a database selected: explicit branch grants and commit tests."""
    # Branch writes need an explicit grant; root keeps admin everywhere.
    cursor.execute("INSERT IGNORE INTO dolt_branch_control VALUES ('%', '%', 'root', 'localhost', 'admin')")
    cursor.execute("DELETE FROM dolt_branch_control WHERE `database` = '%' AND branch = '%' "
                   "AND user = '%' AND host = '%'")
    # Service-wide: every database on this service needs at least one test in this group.
    cursor.execute(f"SET PERSIST dolt_commit_verification_groups = '{COMMIT_TESTS}'")


def _statements(text: str) -> list[str]:
    lines = [line for line in text.splitlines() if not line.lstrip().startswith("--")]
    return [part.strip() for part in "\n".join(lines).split(";\n") if part.strip().rstrip(";")]


def init(*, name: str, database: str, service_root: Path, binary: str, port: int, role: str,
         backup_root: Path | None, of: str = "research") -> dict:
    """Create the profile, its service if new, the database on main with the schema, and its accounts."""
    if role not in ROLES:
        raise _refuse(f"role must be one of {ROLES}")
    if of not in KINDS:
        raise _refuse(f"kind must be one of {KINDS}")
    if not name.replace("-", "").replace("_", "").isalnum() or not database.replace("_", "").isalnum():
        raise _refuse("ledger and database names use letters, digits, hyphens and underscores")
    found = profiles()
    if name in found:
        raise _refuse(f"ledger {name} already exists; no implicit replacement", "LEDGER_EXISTS")
    actives = [value for value in found.values() if value["role"] == "active"]
    same = [value for value in actives if kind(value) == of]
    if role == "active" and same:
        raise _refuse(f"ledger {same[0]['name']} is already active", "LEDGER_EXISTS")
    if role != "active" and any(value["database"] == database for value in actives):
        raise _refuse(f"database {database} is the active ledger's; use another name", "ISOLATION_BREACH")
    service_root = Path(service_root).expanduser().absolute()
    if role == "active":
        for path in (service_root, backup_root):
            if path is not None and (Path(path).resolve().is_relative_to(ROOT.resolve()) or _is_temporary_path(path)):
                raise _refuse(f"an active ledger keeps {path} outside Git and temporary directories")
    binary = _binary(binary)
    config = (_read(service_root / "service.json") if (service_root / "service.json").exists()
              else _create_service(service_root, binary, port))
    start_service(service_root)
    if database in config["databases"]:
        raise _refuse(f"service {service_root} already holds {database}", "LEDGER_EXISTS")
    accounts = {role_name: {"user": (f"{database}_{role_name}" if len(database) <= 25 else
                                  f"{database[:16]}_{hashlib.sha256(database.encode()).hexdigest()[:7]}_{role_name}"),
                            "password": secrets.token_urlsafe(24)}
                for role_name in ("writer", "reader")}
    conn = _admin(config)
    try:
        with conn.cursor() as cursor:
            cursor.execute(f"CREATE DATABASE `{database}`")
            cursor.execute(f"USE `{database}`")
            if not config.get("secured"):
                _secure_service(cursor)
                config["secured"] = True
                _private_write(service_root / "service.json", config)
            schema = SCHEMA if of == "research" else MARKET_SCHEMA
            for statement in _statements(schema.read_text(encoding="utf-8")):
                cursor.execute(statement)
            if of == "research":
                cursor.execute("INSERT INTO ledger_schema VALUES (1, %s)", (db.SCHEMA_VERSION,))
                cursor.execute("INSERT INTO ledger_head VALUES (1, 0, 'schema')")
            else:
                from research.market.store import PRICE_SCALE, VOLUME_SCALE
                from research.market.universe import POOL_RULE
                cursor.execute("INSERT INTO market_schema VALUES (1, %s, %s, %s, %s)",
                               (db.MARKET_SCHEMA_VERSION, PRICE_SCALE, VOLUME_SCALE, POOL_RULE))
            version = db.SCHEMA_VERSION if of == "research" else db.MARKET_SCHEMA_VERSION
            cursor.execute("CALL DOLT_COMMIT('-A', '-m', %s)", (f"schema:{version}",))
            writer, reader = accounts["writer"], accounts["reader"]
            cursor.execute(f"CREATE USER '{writer['user']}'@'%%' IDENTIFIED BY %s", (writer["password"],))
            cursor.execute(f"CREATE USER '{reader['user']}'@'%%' IDENTIFIED BY %s", (reader["password"],))
            # Least privilege: no UPDATE or DELETE except the concurrency row, no database-wide EXECUTE
            # (it would allow reset, tag deletion and amend), only DOLT_COMMIT by name.
            cursor.execute(f"GRANT SELECT, INSERT ON `{database}`.* TO '{writer['user']}'@'%'")
            if of == "research":
                cursor.execute(f"GRANT UPDATE ON `{database}`.ledger_head TO '{writer['user']}'@'%'")
            else:
                # Market data appends on main only.
                cursor.execute("INSERT INTO dolt_branch_control VALUES (%s, 'main', %s, '%%', 'write')",
                               (database, writer["user"]))
            cursor.execute(f"GRANT EXECUTE ON PROCEDURE `{database}`.dolt_commit TO '{writer['user']}'@'%'")
            cursor.execute(f"GRANT SELECT ON `{database}`.* TO '{reader['user']}'@'%'")
    finally:
        conn.close()
    config["databases"][database] = accounts
    _private_write(service_root / "service.json", config)
    value = {"name": name, "kind": of, "role": role, "service": str(service_root), "database": database,
             "backup": str(Path(backup_root).expanduser().absolute()) if backup_root else None}
    _private_write(home() / f"{name}.json", value)
    return {"ledger": value, "status": status_of(value)}


def remove_profile(name: str) -> None:
    (home() / f"{name}.json").unlink(missing_ok=True)


# Rounds

def open_round(value: dict, goal: dict) -> dict:
    """Branch round/<goal_id> from main, grant the writer that branch only, then record the goal."""
    from research.records.records import validate_goal, insert_goal
    goal = validate_goal(goal)
    require_writable(value)
    config = service(value)
    branch = db.ROUND_PREFIX + goal["goal_id"]
    conn = db.connect(value, "admin")
    try:
        found = db.rounds(conn)
        if found["open"]:
            raise _refuse(f"round {found['open'][0]} is still open; close it first", "ROUND_OPEN")
        if goal["goal_id"] in found["branches"]:
            raise _refuse(f"goal {goal['goal_id']} already had a round; a changed goal is a new goal_id",
                          "ROUND_EXISTS")
        db.rows(conn, "CALL DOLT_BRANCH(%s, 'main')", (branch,))
        db.rows(conn, "INSERT INTO dolt_branch_control VALUES (%s, %s, %s, '%%', 'write')",
                (value["database"], branch, config["databases"][value["database"]]["writer"]["user"]))
        db.rows(conn, f"USE `{value['database']}/{branch}`")
        conn.goal = goal["goal_id"]
        return insert_goal(value, goal, conn=conn)
    finally:
        conn.close()


def close_round(value: dict) -> dict:
    """Tag the round's head read-only as closed/<goal_id> and withdraw the writer's branch grant."""
    config = service(value)
    conn = db.connect(value, "admin")
    try:
        goal = db.active_goal(conn)
        branch = db.ROUND_PREFIX + goal
        db.rows(conn, "DELETE FROM dolt_branch_control WHERE `database` = %s AND branch = %s AND user = %s",
                (value["database"], branch, config["databases"][value["database"]]["writer"]["user"]))
        db.rows(conn, "CALL DOLT_TAG(%s, %s, '-m', %s)", (db.CLOSED_PREFIX + goal, branch, f"round {goal} closed"))
        commit = db.rows(conn, "SELECT tag_hash FROM dolt_tags WHERE tag_name = %s", (db.CLOSED_PREFIX + goal,))[0][0]
    finally:
        conn.close()
    return {"goal_id": goal, "tag": db.CLOSED_PREFIX + goal, "commit": commit}


# Status, backup, export, SQL

def status_of(value: dict) -> dict:
    result = {"name": value["name"], "kind": kind(value), "role": value["role"], "database": value["database"],
              "service": value["service"], "running": _pid(Path(value["service"])) is not None}
    if not result["running"]:
        return result
    if kind(value) == "market":
        from research.market.store import freshness
        return {**result, **freshness(value)}
    conn = db.connect(value, "reader")
    try:
        found = db.rounds(conn)
        result.update(open_round=found["open"][0] if found["open"] else None, closed_rounds=found["closed"],
                      main=db.rows(conn, "SELECT DOLT_HASHOF('main')")[0][0])
        if result["open_round"]:
            branch = f"{value['database']}/{db.ROUND_PREFIX}{result['open_round']}"
            (seq, head), = db.rows(conn, f"SELECT (SELECT seq FROM `{branch}`.ledger_head), "
                                         f"DOLT_HASHOF('{db.ROUND_PREFIX}{result['open_round']}')")
            result.update(seq=seq, head=head)
    finally:
        conn.close()
    return result


def status() -> dict:
    return {"home": str(home()), "ledgers": [status_of(value) for value in profiles().values()]}


def backup(value: dict) -> dict:
    """Sync the whole database history (every branch and tag) to its backup directory with dolt_backup."""
    if not value.get("backup"):
        raise _refuse(f"ledger {value['name']} has no backup directory", "NO_BACKUP")
    target = Path(value["backup"]) / value["database"]
    if target.resolve().is_relative_to(Path(value["service"]).resolve()):
        raise _refuse("the backup directory must lie outside the service directory")
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    conn = db.connect(value, "admin")
    try:
        db.rows(conn, "CALL DOLT_BACKUP('sync-url', %s)", (target.as_uri(),))
        heads = db.rows(conn, "SELECT name, hash FROM dolt_branches")
    finally:
        conn.close()
    return {"backup": str(target), "method": "dolt_backup sync-url", "branches": dict(heads),
            "restore": f"dolt backup restore {target.as_uri()} {value['database']}"}


def _arrow_types(cursor) -> list:
    """Parquet types from the result's MySQL field metadata (binary vs text by charset 63)."""
    import pyarrow as pa
    from pymysql.constants import FIELD_TYPE as T
    types = []
    for field in cursor._result.fields:
        code = field.type_code
        if code in (T.TINY, T.SHORT, T.LONG, T.LONGLONG, T.INT24, T.YEAR):
            types.append(pa.int64())
        elif code in (T.FLOAT, T.DOUBLE):
            types.append(pa.float64())
        elif code in (T.DECIMAL, T.NEWDECIMAL):
            types.append(pa.decimal128(38, min(field.scale, 18)))
        elif code in (T.DATETIME, T.TIMESTAMP):
            types.append(pa.timestamp("us", tz="UTC"))
        elif code == T.DATE:
            types.append(pa.date32())
        elif code in (T.BLOB, T.TINY_BLOB, T.MEDIUM_BLOB, T.LONG_BLOB, T.VAR_STRING, T.STRING) and field.charsetnr == 63:
            types.append(pa.binary())
        else:
            types.append(pa.string())
    return types


def _arrow_value(kind, value):
    import pyarrow as pa
    from datetime import UTC
    if value is None:
        return None
    if pa.types.is_string(kind):
        return value.decode() if isinstance(value, bytes) else str(value)
    if pa.types.is_timestamp(kind):
        return value.replace(tzinfo=UTC)
    return value


def export(value: dict, at: str, output: Path, *, batch: int = 20_000) -> dict:
    """Write every table at one branch, tag or commit as Parquet (read-only, streamed)."""
    import pyarrow as pa
    import pyarrow.parquet as pq
    import pymysql.cursors
    output = Path(output)
    if output.exists():
        raise _refuse(f"export destination exists: {output}")
    output.mkdir(parents=True)
    written = {}
    with db.reading(value, at) as conn:
        (commit,), = db.rows(conn, "SELECT DOLT_HASHOF('HEAD')")
        tables = [name for name, kind in db.rows(conn, "SHOW FULL TABLES")
                  if kind == "BASE TABLE" and not name.startswith("dolt_")]
        for table in tables:
            with conn.cursor(pymysql.cursors.SSCursor) as cursor:
                cursor.execute(f"SELECT * FROM `{table}`")
                types = _arrow_types(cursor)
                schema = pa.schema([(column[0], kind) for column, kind in zip(cursor.description, types)])
                count = 0
                with pq.ParquetWriter(output / f"{table}.parquet", schema) as writer:
                    while chunk := cursor.fetchmany(batch):
                        arrays = [pa.array([_arrow_value(kind, item) for item in column], type=kind)
                                  for kind, column in zip(types, zip(*chunk))]
                        writer.write_table(pa.Table.from_arrays(arrays, schema=schema))
                        count += len(chunk)
                written[table] = count
    return {"at": at, "commit": commit, "output": str(output), "rows": written}


def sql(value: dict, statement: str, at: str | None, limit: int) -> dict:
    """Run one read-only statement as the reader account; blobs print as their length."""
    with db.reading(value, at) as conn:
        found = db.dicts(conn, statement)
    shown = [{key: (f"<{len(item)} bytes>" if isinstance(item, bytes) and len(item) > 256 else
                    item.decode("utf-8", "replace") if isinstance(item, bytes) else item)
              for key, item in row.items()} for row in found[:limit]]
    return {"rows": shown, "count": len(found), "truncated": len(found) > limit}


# Temporary ledgers

def temporary(name: str, command: list[str], binary: str, port: int) -> int:
    """Start a throwaway service and ledger, run the command, then stop and delete both."""
    if not command:
        raise _refuse("ledger temp needs a command after --")
    root = Path(tempfile.mkdtemp(prefix="tl-", dir="/tmp"))
    service_root = root / "s"
    try:
        init(name=name, database=f"tmp_{name.replace('-', '_')}", service_root=service_root, binary=binary,
             port=port, role="temporary", backup_root=None)
        return subprocess.run(command, check=False).returncode
    finally:
        try:
            stop_service(service_root)
        finally:
            remove_profile(name)
            shutil.rmtree(root, ignore_errors=True)

