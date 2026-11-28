"""Paper run records in the Paper database (`ledger.open_paper_run`, `ledger.seal_paper_run`, `ledger.paper_runs`).

Paper runs are execution records, not research: they live in their own database (ledger/paper.sql, a
profile that holds "paper"), never in the research ledger, and add no trial count and no exposure.
A run's source is copied from the research ledger when it starts (`copy_source`). A paper run is
declared once, before its container starts (`paper_run`): the source, the runtime image, the
contracts, the market day its membership was read at and the effective configuration. It is sealed
once, after it ends (`paper_seal` with its `paper_file` rows): the runner's journal split by UTC day,
its summary, the egress and runner logs, and ``seal.json``, the readings computed once from them
(ledger.run_journal.capture; docs/plans/stored-fields.zh.md). Every declared run seals with its reasons, however it
ended (it crashed, ran out of memory or never started), so every declared run has an outcome; it is ``invalid`` only
when its evidence cannot be trusted (ledger.run_journal.verdict).

The user may delete a sealed run (`ledger.delete_paper_run`, user decision 2026-10-29): the Paper
database's writer removes its declaration, seal and files in one commit.
"""

from __future__ import annotations

from datetime import datetime, timedelta
import hashlib
import json

from ledger import db, strategies
from shared.refusals import refuse


def _row(row: dict) -> dict:
    return {**row, "symbols": json.loads(row["symbols"]) if isinstance(row["symbols"], str) else row["symbols"],
            "config": json.loads(row["config"]) if isinstance(row["config"], str) else row["config"]}


def copy_source(profile: db.LedgerProfile, research: db.LedgerConnection, candidate: str) -> dict:
    """The research candidate `candidate` (read on `research`), its source copied into the Paper database
    `profile` once; a later copy of the same source writes nothing."""
    found = strategies.read_runnable(research, candidate)

    def same(conn, prior):
        if prior["entry_class"] != found["entry_class"]:
            raise refuse("OP_ID_CONFLICT", f"the Paper database holds source {found['source_sha256']} with another "
                                           "entry class")
        return prior

    def insert(conn, op):
        prior = conn.one("SELECT * FROM paper_source WHERE source_sha256 = %s", (found["source_sha256"],))
        if prior is not None:
            return same(conn, prior)
        conn.rows("INSERT INTO paper_source (source, entry_class, op_id, created_at) "
                  "VALUES (%s, %s, %s, UTC_TIMESTAMP(6))", (found["source"], found["entry_class"], op))
        return conn.one("SELECT * FROM paper_source WHERE op_id = %s", (op,))

    with db.connect(profile, "writer") as conn:
        db.write(conn, "paper_source", {"source_sha256": found["source_sha256"]}, "paper_source", insert, same,
                 op_id=f"paper-source:{found['source_sha256']}", attempts=db.WRITE_ATTEMPTS)
    return found


def read_source(conn: db.LedgerConnection, source_sha256: str) -> dict:
    """A copied source: {source_sha256, source, entry_class}."""
    found = conn.one("SELECT source_sha256, source, entry_class FROM paper_source WHERE source_sha256 = %s",
                     (source_sha256,))
    if found is None:
        raise refuse("UNKNOWN_CANDIDATE", f"the Paper database holds no source {source_sha256}",
                     missing=(source_sha256,))
    return {**found, "source": bytes(found["source"])}


def open_paper_run(conn: db.LedgerConnection, source_sha256: str, image_ref: str, symbols: list[str],
                   market_day: str, config: dict, op_id: str) -> dict:
    """Declare one paper run of a copied source; `op_id` names this start (a retry with the same ID returns
    the same run)."""
    read_source(conn, source_sha256)
    payload = {"source_sha256": source_sha256, "image_ref": image_ref, "symbols": list(symbols),
               "market_day": market_day, "config": config}

    def insert(c, op):
        c.rows("INSERT INTO paper_run (source_sha256, image_ref, symbols, market_day, config, op_id, created_at) "
               "VALUES (%s, %s, %s, %s, %s, %s, UTC_TIMESTAMP(6))",
               (source_sha256, image_ref, json.dumps(list(symbols)), market_day,
                json.dumps(config, sort_keys=True), op))
        return c.one("SELECT * FROM paper_run WHERE op_id = %s", (op,))

    written = db.write(conn, "paper_start", payload, "paper_run", insert, op_id=op_id)
    return {**_row(written["record"]), "ledger_commit": written["commit"], "write_status": written["write_status"]}


def read_paper_run(conn: db.LedgerConnection, paper_id: int) -> dict:
    row = conn.one("SELECT * FROM paper_run WHERE paper_id = %s", (paper_id,))
    if row is None:
        raise refuse("PAPER_RUN_UNKNOWN", f"no paper run {paper_id}", missing=(str(paper_id),))
    return _row(row)


def paper_start_of(conn: db.LedgerConnection, op_id: str) -> dict | None:
    """The original declaration for a start operation, even if that run has since ended."""
    row = conn.one("SELECT * FROM paper_run WHERE op_id = %s", (op_id,))
    return _row(row) if row is not None else None


def paper_files(conn: db.LedgerConnection, paper_id: int, *wanted: str) -> dict[str, bytes]:
    """A sealed run's files by path; none while it is unsealed. `wanted` names the paths to read, a name ending in
    "/" every path under it, so a reader takes only the bytes it uses (CF-24: never the whole capture with its
    recovery dump for one log); no name reads every file."""
    exact = [name for name in wanted if not name.endswith("/")]
    under = [name.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
             for name in wanted if name.endswith("/")]
    clauses = ([f"path IN ({db.marks(exact)})"] if exact else []) + ["path LIKE %s"] * len(under)
    where = f" AND ({' OR '.join(clauses)})" if clauses else ""
    return {row["path"]: bytes(row["content"]) for row in conn.dicts(
        f"SELECT path, content FROM paper_file WHERE paper_id = %s{where} ORDER BY path", (paper_id, *exact, *under))}


def seal_of(conn: db.LedgerConnection, paper_id: int) -> dict | None:
    """The stored seal.json of a run, or None while it is unsealed."""
    found = conn.one("SELECT content FROM paper_file WHERE paper_id = %s AND path = 'seal.json'", (paper_id,))
    return json.loads(bytes(found["content"])) if found else None


def paper_runs(conn: db.LedgerConnection) -> list[dict]:
    """Every declared run, oldest first, with its seal readings once sealed."""
    rows = conn.dicts("SELECT r.*, f.content AS seal FROM paper_run r LEFT JOIN paper_file f ON f.paper_id = r.paper_id "
                      "AND f.path = 'seal.json' ORDER BY r.paper_id")
    return [{**_row(row), "seal": None if row["seal"] is None else json.loads(bytes(row["seal"]))} for row in rows]


def last_research_symbols(conn: db.LedgerConnection, source_sha256: str, at: int | None = None) -> dict | None:
    """The contracts ({trial_id, symbols}) of the source's latest research replay that ran (by UTC nanoseconds `at`),
    read on the research ledger, or None: what a paper run of the version's last configuration trades."""
    found = conn.one("SELECT t.trial_id FROM trial t JOIN run r ON r.trial_id = t.trial_id WHERE t.source_sha256 = %s "
                     "AND t.purpose = 'research' AND r.created_at <= COALESCE(%s, r.created_at) "
                     "ORDER BY t.trial_id DESC LIMIT 1",
                     (source_sha256, None if at is None else datetime(1970, 1, 1) + timedelta(microseconds=at // 1000)))
    return None if found is None else {"trial_id": found["trial_id"], "symbols": [symbol for (symbol,) in conn.rows(
        "SELECT symbol FROM trial_instrument WHERE trial_id = %s ORDER BY symbol", (found["trial_id"],))]}


def seal_paper_run(conn: db.LedgerConnection, paper_id: int, files: dict[str, bytes]) -> dict:
    """Write a run's seal and files, seal.json among them; sealing the same capture again writes nothing."""
    if "seal.json" not in files:
        raise ValueError("a paper seal is written with its seal.json")
    read_paper_run(conn, paper_id)
    hashes = {path: hashlib.sha256(content).hexdigest() for path, content in sorted(files.items())}

    def insert(c, op):
        if c.one("SELECT 1 FROM paper_seal WHERE paper_id = %s", (paper_id,)) is not None:
            raise refuse("OP_ID_CONFLICT", f"paper run {paper_id} is sealed with another capture")
        c.rows("INSERT INTO paper_seal (paper_id, op_id, created_at) VALUES (%s, %s, UTC_TIMESTAMP(6))",
               (paper_id, op))
        for path, content in sorted(files.items()):
            c.rows("INSERT INTO paper_file (paper_id, path, content) VALUES (%s, %s, %s)", (paper_id, path, content))
        return c.one("SELECT * FROM paper_seal WHERE op_id = %s", (op,))

    written = db.write(conn, "paper_seal", {"paper_id": paper_id, "files": hashes}, "paper_seal", insert)
    return {"paper_id": paper_id, "files": hashes, "seal": json.loads(files["seal.json"]),
            "ledger_commit": written["commit"], "write_status": written["write_status"]}


def delete_paper_run(profile: db.LedgerProfile, paper_id: int) -> dict:
    """paper delete: remove a sealed run's declaration, seal and files in one commit ``paper_delete:<paper_id>``."""
    def insert(c, op):
        read_paper_run(c, paper_id)
        if c.one("SELECT 1 FROM paper_seal WHERE paper_id = %s", (paper_id,)) is None:
            raise refuse("PAPER_RUN_ACTIVE", f"paper run {paper_id} is not sealed; stop or seal it first",
                         missing=(str(paper_id),))
        (count,), = c.rows("SELECT COUNT(*) FROM paper_file WHERE paper_id = %s", (paper_id,))
        for table in ("paper_file", "paper_seal", "paper_run"):
            c.rows(f"DELETE FROM {table} WHERE paper_id = %s", (paper_id,))
        return {"files_deleted": count}

    with db.connect(profile, "writer") as conn:
        written = db.write(conn, "paper_delete", {"paper_id": paper_id}, "paper_run", insert,
                           op_id=f"paper_delete:{paper_id}")
    return {"paper_id": paper_id, **written["record"], "ledger_commit": written["commit"],
            "write_status": written["write_status"]}
