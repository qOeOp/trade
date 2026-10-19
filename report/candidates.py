"""The candidate list (`report.candidates`): every candidate's source identity, parent and change, and
each registration attempt with its run status and current economic evidence availability, at an
exact ledger version. No score, eligibility mark or ranking; candidates in (strategy_id, revision)
order only for a stable output. A run whose stored records do not verify (LEDGER_CORRUPT,
EXECUTION_IDENTITY) is listed unavailable with that reason; it does not stop the list.
"""

from __future__ import annotations

from collections.abc import Mapping

from ledger import db
from ledger.errors import Refusal
from ledger.refusals import refuse
from qualification import availability
from report import runs


UNVERIFIED_RECORDS = ("LEDGER_CORRUPT", "EXECUTION_IDENTITY")  # a run's own records fail to verify


def assess_listed(conn: db.LedgerConnection, run_id: int, checker: Mapping, records: list) -> dict:
    """availability.assess of one listed run with the call's checker and review records; a run whose
    stored records do not verify is unavailable (diagnostic only) with the refusal as its reason."""
    try:
        return availability.assess(conn, {"run_id": run_id}, checker=checker, records=records)
    except Refusal as exc:
        if exc.code not in UNVERIFIED_RECORDS:
            raise
        return {"economic_evidence_available": False, "reasons": [f"{exc.code}: {exc.message}"],
                "checker": dict(checker), "limitations": [], "unverified_records": True}


CANDIDATE_COLUMNS = ("strategy_id", "revision", "source_sha256", "entry_class", "runtime_contract", "description",
                     "parent_strategy_id", "parent_revision", "difference", "created_at")


def attempts_of(conn: db.LedgerConnection, checker: dict, records: list | None = None) -> list[dict]:
    """Every registration attempt with its run and the run's availability now; LEDGER_CORRUPT on a
    dangling reference."""
    records = availability.review_records(conn) if records is None else records
    dangling = conn.rows("SELECT r.run_id FROM run r LEFT JOIN trial t ON t.trial_id = r.trial_id WHERE t.trial_id IS "
                         "NULL ORDER BY r.run_id LIMIT 1")
    if dangling:
        raise refuse("LEDGER_CORRUPT", f"run {dangling[0][0]} names a trial that does not exist",
                     missing=(f"run {dangling[0][0]}",))
    found = []
    for row in conn.dicts("SELECT a.registration_bundle, a.source_sha256, a.trial_id, t.image_digest, t.purpose, "
                          "r.run_id, r.status FROM registration_attempt a LEFT JOIN trial t ON t.trial_id = a.trial_id "
                          "LEFT JOIN run r ON r.trial_id = a.trial_id ORDER BY a.trial_id"):
        if row["purpose"] is None:
            raise refuse("LEDGER_CORRUPT", f"registration attempt of {row['registration_bundle']} names the missing "
                                           f"trial {row['trial_id']}", missing=(f"trial {row['trial_id']}",))
        if row["run_id"] is None:
            value = {"economic_evidence_available": False, "reasons": ["unfinished"], "checker": checker}
        else:
            assessed = assess_listed(conn, row["run_id"], checker, records)
            value = {"economic_evidence_available": assessed["economic_evidence_available"],
                     "reasons": assessed["reasons"], "checker": assessed["checker"]}
        found.append({"bundle": row["registration_bundle"], "source_sha256": row["source_sha256"],
                      "trial_id": row["trial_id"], "run_id": row["run_id"],
                      "run_status": row["status"] or "unfinished", "availability": value})
    return found


def candidates(profile, at: str | None = None) -> dict:
    """{ledger_commit, checker, candidates}: the candidate forest at `at` with every attempt."""
    with db.read_as_of(runs.profile_of(profile), at) as conn:
        checker = availability.check_identity()
        rows = conn.dicts(f"SELECT {', '.join(CANDIDATE_COLUMNS)} FROM candidate ORDER BY strategy_id, revision")
        known = {row["source_sha256"] for row in rows}
        attempts = attempts_of(conn, checker)
        commit = db.head_commit(conn)
    stray = next((item for item in attempts if item["source_sha256"] not in known), None)
    if stray is not None:
        raise refuse("LEDGER_CORRUPT", f"registration attempt of {stray['bundle']} names source {stray['source_sha256']}, "
                                       "which no candidate holds", missing=(stray["bundle"],))
    by_source: dict[str, list[dict]] = {}
    for item in attempts:
        by_source.setdefault(item.pop("source_sha256"), []).append(item)
    listed = []
    for row in rows:
        mine = by_source.get(row["source_sha256"], [])
        listed.append({**row, "attempts": mine,
                       "valid_evidence": any(item["availability"]["economic_evidence_available"] for item in mine)})
    return {"ledger_commit": commit, "checker": checker, "candidates": listed}
