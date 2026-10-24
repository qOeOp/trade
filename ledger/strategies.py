"""Candidates (`ledger.check_source`, `ledger.publish_candidate`, `ledger.read_candidate`).

A candidate is the exact bytes of one single-file strategy; its identity is the ledger-derived
content hash, `strategy_id@revision` is only its reference name, and a parent with a difference
is its lineage edge. Publishing parses the source without executing it and never reads any
run's results: a losing or insignificant candidate may be a parent like any other.
"""

from __future__ import annotations

import ast
import hashlib
import re

from ledger import db
from ledger.refusals import refuse


ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\Z")
MAX_SOURCE_BYTES = 8 * 1024 * 1024  # uncalibrated example value
NOTE_LIMIT = 2000
# The runtime contract in force at publication: the one the runtime images declare
# (engine.config.RUNTIME_CONTRACT; the ledger does not import the engine).
RUNTIME_CONTRACT = "replay-contract@v7"


def check_source(source: bytes, entry_class: str) -> None:
    """Parse without executing: nonempty UTF-8 Python with exactly one top-level `entry_class`."""
    if not isinstance(source, bytes) or not source or len(source) > MAX_SOURCE_BYTES:
        raise refuse("SOURCE_SIZE", f"the source must be 1 to {MAX_SOURCE_BYTES} bytes",
                     expected=f"bytes, 1..{MAX_SOURCE_BYTES}")
    if not isinstance(entry_class, str) or not entry_class.isidentifier():
        raise refuse("ENTRY_CLASS_INVALID", f"{entry_class!r} is not a Python identifier")
    try:
        tree = ast.parse(source.decode("utf-8"), filename="<strategy>")
        compile(tree, "<strategy>", "exec")
    except (UnicodeDecodeError, SyntaxError, ValueError) as exc:
        raise refuse("SOURCE_SYNTAX", f"the source is not valid UTF-8 Python ({type(exc).__name__})") from exc
    found = sum(isinstance(node, ast.ClassDef) and node.name == entry_class for node in tree.body)
    if found != 1:
        raise refuse("ENTRY_CLASS_NOT_UNIQUE", f"{found} top-level classes are named {entry_class}",
                     expected="exactly one")


def parse_ref(ref) -> tuple[str, int]:
    strategy_id, _, revision = ref.partition("@") if isinstance(ref, str) else ("", "", "")
    if not ID.fullmatch(strategy_id) or not revision.isdigit() or int(revision) < 1 or revision != str(int(revision)):
        raise refuse("BAD_REF", f"a candidate reference is strategy_id@N with N >= 1, got {ref!r}",
                     expected="strategy_id@revision")
    return strategy_id, int(revision)


def read_candidate(conn: db.LedgerConnection, ref: str) -> dict:
    """The candidate row of `ref` on the connection's version, its source hash recomputed."""
    strategy_id, revision = parse_ref(ref)
    row = conn.one("SELECT * FROM candidate WHERE strategy_id = %s AND revision = %s", (strategy_id, revision))
    if row is None:
        raise refuse("UNKNOWN_CANDIDATE", f"no candidate {ref} on this ledger version", missing=(ref,))
    row["source"] = bytes(row["source"])
    if hashlib.sha256(row["source"]).hexdigest() != row["source_sha256"]:
        raise refuse("LEDGER_CORRUPT", f"the stored source of {ref} differs from its content hash", missing=(ref,))
    return row


def _note(value, name: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > NOTE_LIMIT:
        raise refuse("NOTE_INVALID", f"{name} must be nonempty text of at most {NOTE_LIMIT} characters",
                     missing=(name,))
    return value


def publish_candidate(profile: db.LedgerProfile, source: bytes, strategy_id: str, entry_class: str,
                      description: str, parent: str | None = None, difference: str | None = None,
                      op_id: str | None = None) -> dict:
    """Publish one source as a candidate in one commit; the same payload again is a replay."""
    if not isinstance(strategy_id, str) or not ID.fullmatch(strategy_id):
        raise refuse("INVALID_ID", f"invalid strategy ID {strategy_id!r}", expected="[A-Za-z0-9][A-Za-z0-9_.-]{0,99}")
    check_source(source, entry_class)
    _note(description, "description")
    if difference is not None:
        _note(difference, "difference")
    if (parent is None) != (difference is None):
        raise refuse("LINEAGE_INCOMPLETE", "a parent and its difference go together",
                     missing=("difference",) if difference is None else ("parent",))
    parent_ref = parse_ref(parent) if parent is not None else None
    sha = hashlib.sha256(source).hexdigest()
    payload = {"strategy_id": strategy_id, "source_sha256": sha, "entry_class": entry_class, "parent": parent}

    def insert(conn, op):
        if parent is not None:
            read_candidate(conn, parent)
        existing = conn.one("SELECT strategy_id, revision FROM candidate WHERE source_sha256 = %s", (sha,))
        if existing:
            ref = f"{existing['strategy_id']}@{existing['revision']}"
            raise refuse("SOURCE_EXISTS", f"these exact bytes are already candidate {ref}", expected=ref)
        # Dolt 2.4.2 returns no row (not a NULL row) for MAX over no rows.
        found = conn.rows("SELECT MAX(revision) FROM candidate WHERE strategy_id = %s", (strategy_id,))
        revision = (found[0][0] if found and found[0][0] is not None else 0) + 1
        conn.rows("INSERT INTO candidate (strategy_id, revision, source, entry_class, runtime_contract, description, "
                  "parent_strategy_id, parent_revision, difference, op_id, created_at) "
                  "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, UTC_TIMESTAMP(6))",
                  (strategy_id, revision, source, entry_class, RUNTIME_CONTRACT, description,
                   parent_ref[0] if parent_ref else None, parent_ref[1] if parent_ref else None, difference, op))
        return {"candidate": f"{strategy_id}@{revision}", "source_sha256": sha, "runtime_contract": RUNTIME_CONTRACT}

    def replay(conn, row):
        stored_parent = (f"{row['parent_strategy_id']}@{row['parent_revision']}"
                         if row["parent_strategy_id"] is not None else None)
        if (row["strategy_id"], row["source_sha256"], row["entry_class"], stored_parent) != (
                strategy_id, sha, entry_class, parent):
            raise refuse("OP_ID_CONFLICT", f"operation {row['op_id']} already names another candidate",
                         missing=(row["op_id"],))
        return {"candidate": f"{row['strategy_id']}@{row['revision']}", "source_sha256": row["source_sha256"],
                "runtime_contract": row["runtime_contract"]}

    with db.connect(profile, "writer") as conn:
        written = db.write(conn, "publish_candidate", payload, "candidate", insert, replay, op_id=op_id)
    return {**written["record"], "replayed": written["replayed"], "ledger_commit": written["commit"]}
