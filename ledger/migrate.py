"""Schema migration (`ledger.migrate`): a generation-1 research ledger becomes generation 2.

Generation 2 (docs/plans/ledger-schema-v2.zh.md) stores every evidence content once
(`evidence_content`, a bundle file names its hash), reads the trial's image digest out of
`image_ref` and a cycle's price PnL out of its realized PnL instead of storing them, makes the
always-present hashes NOT NULL, gives the bundle references the bundle's length, renames the replay
contract of earlier candidates to `replay-contract@v6` (the user's authority, 2026-10-21) and adds
the research-history views.

The service administrator runs it alone (no other session of the database's accounts may be
connected): the full history is first synced to the profile's dolt_backup (or `backup`), then every
change lands in the working set and is checked against the records read before it (row counts,
every evidence file's hash and bytes, every unchanged column of every table, the derived digests and
price PnL); only then one Dolt commit `schema:2` (the commit tests run) makes it visible. Any
failure before that commit resets the working set. A generation-2 ledger is left as it is.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
import re

import pymysql

from ledger import admin, db, evidence
from ledger.refusals import refuse


FROM, TO = 1, 2
OP_ID = "migrate:schema-2"
CONTRACTS = {"r1-native-v6": "replay-contract@v6"}  # the replay contract's earlier name (#1627)
# Columns generation 2 no longer stores; every other column of every generation-1 table is kept.
DROPPED = {"evidence": ("content", "byte_length"), "trial": ("image_digest",), "run_cycle": ("price_pnl",)}
# Bundle references narrowed to evidence_bundle.bundle; each is a foreign key to it.
NARROWED = (("judgment", "line_bundle", "VARCHAR(160) NOT NULL"),
            ("judgment_subject", "registration_bundle", "VARCHAR(160) NULL"))
UNCHECKED = ("ledger_schema", "ledger_head")  # changed by the migration itself
PRICE_PNL = "IF(ts_closed_ns IS NULL, NULL, realized_pnl + commissions - funding)"


def _connect(profile: db.LedgerProfile):
    config = db._service(profile.service_root)
    if config is None:
        raise refuse("LEDGER_UNKNOWN", f"{profile.service_root} is not a ledger service directory")
    try:
        conn = db.service_connection(config["socket"], user="root", password=config["root_password"],
                                     database=f"{profile.database}/{profile.research_branch}", charset="utf8mb4",
                                     autocommit=True, connect_timeout=5, read_timeout=3600, write_timeout=3600,
                                     max_allowed_packet=1 << 30)
    except pymysql.MySQLError as exc:
        raise refuse("LEDGER_UNAVAILABLE", "the service administrator could not connect for the migration") from exc
    return config, conn


def _rows(cursor, statement: str, params=None) -> list[tuple]:
    cursor.execute(statement, params)
    return list(cursor.fetchall())


def _schema_statements() -> list[str]:
    return db._statements(db.SCHEMA.read_text(encoding="utf-8"))


def _created(name: str) -> str:
    """The generation-2 CREATE statement of one table or view."""
    for statement in _schema_statements():
        if re.match(rf"CREATE (TABLE|VIEW) {name} ", statement):
            return statement
    raise KeyError(name)


def _require_alone(cursor, config: dict, database: str) -> None:
    accounts = {account["user"] for account in config.get("databases", {}).get(database, {}).values()}
    (own,), = _rows(cursor, "SELECT CONNECTION_ID()")
    others = [row for row in _rows(cursor, "SHOW PROCESSLIST") if row[0] != own and row[1] in accounts]
    if others:
        raise refuse("MIGRATION_BUSY", f"{len(others)} other session(s) of {database}'s accounts are connected",
                     missing=tuple(sorted({str(row[1]) for row in others})))


def _tables(cursor) -> list[str]:
    return sorted(name for (name, kind) in _rows(cursor, "SHOW FULL TABLES") if kind == "BASE TABLE"
                  and not name.startswith("dolt_"))


def _columns(cursor, table: str) -> list[str]:
    return [row[0] for row in _rows(cursor, f"SHOW COLUMNS FROM `{table}`")]


def _primary_key(cursor, table: str) -> list[str]:
    return [row[4] for row in _rows(cursor, f"SHOW KEYS FROM `{table}`") if row[2] == "PRIMARY"]


def _value(item):
    return hashlib.sha256(bytes(item)).hexdigest() if isinstance(item, (bytes, bytearray)) else item


def _records(cursor, tables: list[str], columns: dict[str, list[str]]) -> dict[str, list[tuple]]:
    """Every kept column of every table in primary-key order; blobs by their hash (computed here,
    never with SHA2 in Dolt, which panics on stored blobs)."""
    found = {}
    for table in tables:
        order = ", ".join(f"`{key}`" for key in _primary_key(cursor, table))
        selected = ", ".join(f"`{column}`" for column in columns[table])
        found[table] = [tuple(_value(item) for item in row)
                        for row in _rows(cursor, f"SELECT {selected} FROM `{table}` ORDER BY {order}")]
    return found


def _before(cursor) -> dict:
    """The generation-1 records the migration must keep, each stored hash checked."""
    tables = [name for name in _tables(cursor) if name not in UNCHECKED]
    columns = {table: [column for column in _columns(cursor, table) if column not in DROPPED.get(table, ())]
               for table in tables}
    records = _records(cursor, tables, columns)
    contents: dict[str, bytes] = {}
    files = []
    file_bytes = 0
    for bundle, path, content, stored in _rows(cursor, "SELECT bundle, path, content, sha256 FROM evidence "
                                                       "ORDER BY bundle, path"):
        content = bytes(content)
        digest = hashlib.sha256(content).hexdigest()
        if digest != stored:
            raise refuse("LEDGER_CORRUPT", f"stored file {bundle}/{path} differs from its content hash",
                         missing=(f"{bundle}/{path}",))
        contents[digest] = content
        files.append((bundle, path, digest))
        file_bytes += len(content)
    for ref, source, stored in _rows(cursor, "SELECT CONCAT(strategy_id, '@', revision), source, source_sha256 "
                                             "FROM candidate"):
        if hashlib.sha256(bytes(source)).hexdigest() != stored:
            raise refuse("LEDGER_CORRUPT", f"the source of {ref} differs from its stored hash", missing=(ref,))
    index = columns["candidate"].index("runtime_contract")
    records["candidate"] = [row[:index] + (CONTRACTS.get(row[index], row[index]),) + row[index + 1:]
                            for row in records["candidate"]]
    return {"tables": tables, "columns": columns, "records": records, "contents": contents, "files": files,
            "digests": _rows(cursor, "SELECT trial_id, image_digest FROM trial ORDER BY trial_id"),
            "prices": _rows(cursor, "SELECT run_id, seq, price_pnl FROM run_cycle ORDER BY run_id, seq"),
            "renamed": _rows(cursor, "SELECT COUNT(*) FROM candidate WHERE runtime_contract IN ("
                                     + ", ".join(["%s"] * len(CONTRACTS)) + ")", tuple(CONTRACTS))[0][0],
            "file_bytes": file_bytes}


def _differs(what: str) -> None:
    raise refuse("MIGRATION_CHECK_FAILED", f"{what} differs after the migration", missing=(what,))


def _check(cursor, before: dict) -> dict:
    """Every record of `before` read again from generation 2; MIGRATION_CHECK_FAILED on any difference."""
    for table in before["tables"]:
        if _columns(cursor, table) != before["columns"][table]:
            _differs(f"the columns of {table}")
    after = _records(cursor, before["tables"], before["columns"])
    for table in before["tables"]:
        if after[table] != before["records"][table]:
            _differs(f"table {table}")
    stored = {}
    for digest, content in _rows(cursor, "SELECT sha256, content FROM evidence_content"):
        content = bytes(content)
        if hashlib.sha256(content).hexdigest() != digest:
            _differs(f"evidence content {digest}")
        stored[digest] = content
    if stored != before["contents"]:
        _differs("the evidence contents")
    files = _rows(cursor, f"SELECT e.bundle, e.path, e.sha256 FROM {evidence.files_from()} ORDER BY e.bundle, e.path")
    if [tuple(row) for row in files] != before["files"]:
        _differs("the evidence files")
    if _rows(cursor, f"SELECT trial_id, {db.IMAGE_DIGEST} FROM trial ORDER BY trial_id") != before["digests"]:
        _differs("the trial image digests")
    if _rows(cursor, f"SELECT run_id, seq, {PRICE_PNL} FROM run_cycle ORDER BY run_id, seq") != before["prices"]:
        _differs("the cycle price PnL")
    return {table: len(after[table]) for table in before["tables"]}


def _foreign_key(cursor, table: str, column: str) -> tuple[str, str]:
    (_, created), = _rows(cursor, f"SHOW CREATE TABLE `{table}`")
    found = re.search(rf"CONSTRAINT `([^`]+)` FOREIGN KEY \(`{column}`\) REFERENCES `([^`]+)` \(`([^`]+)`\)", created)
    if found is None:
        raise RuntimeError(f"{table}.{column} has no foreign key")
    return found.group(1), f"`{found.group(2)}` (`{found.group(3)}`)"


def _references(cursor, target: str) -> list[tuple[str, str, str]]:
    """(table, constraint, definition) of every other table's foreign key to `target`."""
    found = []
    for table in _tables(cursor):
        if table == target:
            continue
        (_, created), = _rows(cursor, f"SHOW CREATE TABLE `{table}`")
        for name, definition in re.findall(rf"CONSTRAINT `([^`]+)` (FOREIGN KEY \([^)]*\) REFERENCES `{target}` "
                                           r"\([^)]*\))", created):
            found.append((table, name, definition))
    return found


def _rebuild_candidates(cursor) -> None:
    """The candidate table rebuilt from its rows, with the replay contract renamed and the source hash
    NOT NULL. Dolt 2.4.2 panics recomputing SHA2 over a stored blob (an UPDATE of a candidate row or a
    MODIFY of its generated column, measured), while an INSERT of the bytes computes it; so each row is
    inserted again, parents first, and the other tables' foreign keys are moved to the new table."""
    references = _references(cursor, "candidate")
    for table, name, _ in references:
        cursor.execute(f"ALTER TABLE `{table}` DROP FOREIGN KEY `{name}`")
    cursor.execute(_created("candidate").replace("CREATE TABLE candidate ", "CREATE TABLE candidate_next ", 1)
                   .replace("REFERENCES candidate ", "REFERENCES candidate_next "))
    columns = [column for column in _columns(cursor, "candidate") if column != "source_sha256"]
    rows = {(row[0], row[1]): row for row in _rows(cursor, "SELECT " + ", ".join(f"`{c}`" for c in columns)
                                                    + " FROM candidate")}
    contract, parent = columns.index("runtime_contract"), columns.index("parent_strategy_id")
    inserted: set[tuple] = set()

    def insert(key):
        row = rows[key]
        above = (row[parent], row[parent + 1])
        if above[0] is not None and above not in inserted:
            insert(above)
        if key not in inserted:
            values = list(row)
            values[contract] = CONTRACTS.get(values[contract], values[contract])
            cursor.execute(f"INSERT INTO candidate_next ({', '.join(columns)}) VALUES ("
                           + ", ".join(["%s"] * len(columns)) + ")", values)
            inserted.add(key)

    for key in sorted(rows):
        insert(key)
    cursor.execute("DROP TABLE candidate")
    cursor.execute("RENAME TABLE candidate_next TO candidate")
    for table, name, definition in references:
        cursor.execute(f"ALTER TABLE `{table}` ADD CONSTRAINT `{name}` {definition}")
    for statement in _schema_statements():
        if statement.startswith("CREATE TRIGGER candidate_created "):
            cursor.execute(statement)


def _apply(cursor, before: dict) -> None:
    for (view,) in _rows(cursor, "SELECT table_name FROM information_schema.views WHERE table_schema = DATABASE()"):
        cursor.execute(f"DROP VIEW `{view}`")
    # Evidence: each content once, the bundle files rebuilt as references.
    cursor.execute(_created("evidence_content"))
    cursor.executemany("INSERT INTO evidence_content (content) VALUES (%s)",
                       [(content,) for _, content in sorted(before["contents"].items())])
    cursor.execute(_created("evidence").replace("CREATE TABLE evidence ", "CREATE TABLE evidence_next ", 1))
    cursor.executemany("INSERT INTO evidence_next (bundle, path, sha256) VALUES (%s, %s, %s)", before["files"])
    cursor.execute("DROP TABLE evidence")
    cursor.execute("RENAME TABLE evidence_next TO evidence")
    _rebuild_candidates(cursor)
    cursor.execute("ALTER TABLE trial DROP COLUMN image_digest")
    cursor.execute("ALTER TABLE run_cycle DROP COLUMN price_pnl")
    for table, column, definition in NARROWED:
        name, target = _foreign_key(cursor, table, column)
        cursor.execute(f"ALTER TABLE `{table}` DROP FOREIGN KEY `{name}`")
        cursor.execute(f"ALTER TABLE `{table}` MODIFY `{column}` {definition}")
        cursor.execute(f"ALTER TABLE `{table}` ADD CONSTRAINT `{name}` FOREIGN KEY (`{column}`) REFERENCES {target}")
    for statement in _schema_statements():
        if statement.startswith("CREATE VIEW "):
            cursor.execute(statement)
    cursor.execute("UPDATE ledger_schema SET version = %s WHERE singleton = 1", (TO,))
    cursor.execute("UPDATE ledger_head SET seq = seq + 1, op_id = %s WHERE singleton = 1", (OP_ID,))


def _reset(cursor) -> None:
    cursor.execute("CALL DOLT_RESET('--hard')")
    cursor.fetchall()
    cursor.execute("CALL DOLT_CLEAN()")
    cursor.fetchall()


def migrate(profile, backup: Path | None = None) -> dict:
    """Migrate the profile's ledger to generation 2 (see the module); idempotent."""
    profile = db.load_profile(profile) if isinstance(profile, str) else profile
    if profile.holds != "research":
        raise refuse("LEDGER_KIND", f"profile {profile.name} holds {profile.holds} data, not a research ledger")
    config, conn = _connect(profile)
    try:
        with conn.cursor() as cursor:
            found = _rows(cursor, "SELECT version FROM ledger_schema WHERE singleton = 1")
            version = found[0][0] if found else None
            if version == TO:
                return {"ledger": profile.name, "schema_version": TO, "migrated": False,
                        "ledger_commit": _rows(cursor, "SELECT DOLT_HASHOF('HEAD')")[0][0]}
            if version != FROM:
                raise refuse("SCHEMA_MISMATCH", f"ledger schema version {version}; this migration reads {FROM}",
                             expected=str(FROM))
            _require_alone(cursor, config, profile.database)
            if _rows(cursor, "SELECT table_name FROM dolt_status"):
                raise refuse("DIRTY_WORKING_SET", "the research branch has uncommitted SQL changes; nothing was "
                                                  "migrated")
            (head,), = _rows(cursor, "SELECT hash FROM dolt_branches WHERE name = %s", (profile.research_branch,))
            target = admin.backup_path(profile, backup)
            if target is None:
                raise refuse("BACKUP_TARGET_UNSET", f"ledger profile {profile.name} declares no backup directory; "
                                                    "give one", missing=("backup",))
            previous = admin._sync_backup(profile, Path(target).expanduser().absolute(), head)
            before = _before(cursor)
            (seq,), = _rows(cursor, "SELECT seq FROM ledger_head WHERE singleton = 1")
            try:
                _apply(cursor, before)
                counts = _check(cursor, before)
                (now,), = _rows(cursor, "SELECT seq FROM ledger_head WHERE singleton = 1")
                if now != seq + 1:
                    raise refuse("MIGRATION_BUSY", "another write landed during the migration")
                cursor.execute("CALL DOLT_COMMIT('-A', '-m', %s)", (f"schema:{TO}",))
                (commit,), = cursor.fetchall()
            except BaseException:
                try:
                    _reset(cursor)
                except pymysql.MySQLError as cleanup:
                    raise refuse("MIGRATION_CHECK_FAILED", "the migration failed and its working set could not be "
                                                           f"reset ({cleanup}); inspect dolt_status") from cleanup
                raise
    except pymysql.MySQLError as exc:
        raise db._sql_error(exc) from exc
    finally:
        conn.close()
    stored = sum(len(content) for content in before["contents"].values())
    return {"ledger": profile.name, "schema_version": TO, "migrated": True, "ledger_commit": commit,
            "previous_commit": head, "backup_path": str(target), "backup_previous_head": previous,
            "rows": counts, "evidence_files": len(before["files"]), "evidence_contents": len(before["contents"]),
            "evidence_bytes": {"files": before["file_bytes"], "stored_once": stored},
            "renamed_runtime_contracts": before["renamed"]}
