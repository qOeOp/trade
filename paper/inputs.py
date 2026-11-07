"""Capture a published source and its required parent rows into the execution database.

Existing candidate fields carry the execution input. Exact references and runtime contracts are
preserved; created_at is the execution-side capture time, not the original research publication.
No research runs, judgments, Paper records or publisher credentials are copied.
"""
from __future__ import annotations

from ledger import db, strategies
from ledger.refusals import refuse


FIELDS = ("strategy_id", "revision", "source", "entry_class", "runtime_contract", "description",
          "parent_strategy_id", "parent_revision", "difference")


def capture(profile: db.LedgerProfile, source: db.LedgerConnection, candidate: str) -> dict:
    if profile.database == source.database and profile.service_root.resolve() == source.profile.service_root.resolve():
        raise refuse("USAGE_ERROR", "research and execution must be different databases")
    if profile.kind != "isolated":
        raise refuse("USAGE_ERROR", "remote Paper inputs require a non-publishing isolated execution profile")
    pending: set[str] = set()

    def keep(ref: str) -> dict:
        row = strategies.read_candidate(source, ref)
        if ref in pending:
            raise refuse("LEDGER_CORRUPT", "published source lineage contains a cycle")
        pending.add(ref)
        parent = row["parent_strategy_id"]
        if parent is not None:
            keep(f"{parent}@{row['parent_revision']}")
        pending.remove(ref)
        strategies.check_source(row["source"], row["entry_class"])

        def same(conn, prior):
            if any(prior[name] != row[name] for name in FIELDS):
                raise refuse("OP_ID_CONFLICT", f"execution input {ref} differs from the published source")
            return prior

        def insert(conn, op):
            prior = conn.one("SELECT * FROM candidate WHERE strategy_id = %s AND revision = %s",
                             (row["strategy_id"], row["revision"]))
            if prior is not None:
                return same(conn, prior)
            columns = ", ".join(FIELDS)
            conn.rows(f"INSERT INTO candidate ({columns}, op_id, created_at) "
                      f"VALUES ({', '.join(['%s'] * len(FIELDS))}, %s, UTC_TIMESTAMP(6))",
                      (*[row[name] for name in FIELDS], op))
            return conn.one("SELECT * FROM candidate WHERE op_id = %s", (op,))

        with db.connect(profile, "writer") as conn:
            db.write(conn, "paper_source", {"candidate": ref, "source_sha256": row["source_sha256"]},
                     "candidate", insert, same, op_id=f"paper-source:{row['source_sha256']}",
                     attempts=db.WRITE_ATTEMPTS)
        return row

    return keep(candidate)
