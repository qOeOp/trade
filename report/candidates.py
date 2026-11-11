"""The candidate list (`report.candidates`): every candidate's source identity, parent and change, and
each research trial of a registration grid point with its run status and current economic evidence availability, at an
exact ledger version. No score, eligibility mark or ranking; candidates in (strategy_id, revision)
order only for a stable output. A run whose stored records do not verify (LEDGER_CORRUPT,
EXECUTION_IDENTITY) is listed unavailable with that reason; it does not stop the list.
"""

from __future__ import annotations

from collections.abc import Mapping

from ledger import db, metrics
from shared.errors import Refusal
from registration import availability, precheck


UNVERIFIED_RECORDS = ("LEDGER_CORRUPT", "EXECUTION_IDENTITY")  # a run's own records fail to verify


def assess_listed(conn: db.LedgerConnection, trial_id: int, checker: Mapping, records: list,
                  loaded: Mapping | Refusal | None = None) -> dict:
    """availability.assess of one listed run with the call's checker, review records and, when given, its
    metrics.load_runs entry; a run whose stored records do not verify is unavailable (diagnostic only) with the
    refusal as its reason."""
    try:
        if isinstance(loaded, Refusal):
            raise loaded
        return availability.assess(conn, {"trial_id": trial_id}, checker=checker, records=records, loaded=loaded)
    except Refusal as exc:
        if exc.code not in UNVERIFIED_RECORDS:
            raise
        return {"economic_evidence_available": False, "reasons": [f"{exc.code}: {exc.message}"],
                "checker": dict(checker), "limitations": [], "unverified_records": True}


CANDIDATE_COLUMNS = ("c.strategy_id, c.revision, c.source_sha256, c.entry_class, c.runtime_contract, c.description, "
                     "c.parent_source_sha256, CONCAT(p.strategy_id, '@', p.revision) AS parent, c.difference, c.created_at")
CANDIDATES = "candidate c LEFT JOIN candidate p ON p.source_sha256 = c.parent_source_sha256"


def attempts_of(conn: db.LedgerConnection, checker: dict) -> list[dict]:
    """Every research trial of a registration grid point with its run and the run's availability now."""
    records = precheck.review_records(conn)
    found = []
    rows = conn.dicts(f"SELECT t.research_registration_id, t.source_sha256, t.trial_id, {db.TRIAL_IMAGE_DIGEST}, "
                      "r.status FROM trial t LEFT JOIN run r ON r.trial_id = t.trial_id "
                      "WHERE t.research_registration_id IS NOT NULL ORDER BY t.trial_id")
    loaded = metrics.load_runs(conn, [row["trial_id"] for row in rows if row["status"] is not None], series=False, listing=True)
    for row in rows:
        if row["status"] is None:
            value = {"economic_evidence_available": False, "reasons": ["unfinished"], "checker": checker}
        else:
            assessed = assess_listed(conn, row["trial_id"], checker, records, loaded[row["trial_id"]])
            value = {"economic_evidence_available": assessed["economic_evidence_available"],
                     "reasons": assessed["reasons"], "checker": assessed["checker"]}
        found.append({"registration_id": row["research_registration_id"], "source_sha256": row["source_sha256"],
                      "trial_id": row["trial_id"],
                      "run_status": row["status"] or "unfinished", "availability": value})
    return found


def candidates(profile, at: str | None = None) -> dict:
    """{ledger_commit, checker, candidates}: the candidate forest at `at` with every attempt."""
    with db.read_as_of(db.profile(profile), at) as conn:
        checker = availability.check_identity()
        rows = conn.dicts(f"SELECT {CANDIDATE_COLUMNS} FROM {CANDIDATES} ORDER BY c.strategy_id, c.revision")
        attempts = attempts_of(conn, checker)
        commit = db.head_commit(conn)
    by_source: dict[str, list[dict]] = {}
    for item in attempts:
        by_source.setdefault(item.pop("source_sha256"), []).append(item)
    listed = []
    for row in rows:
        mine = by_source.get(row["source_sha256"], [])
        listed.append({**row, "attempts": mine,
                       "valid_evidence": any(item["availability"]["economic_evidence_available"] for item in mine)})
    return {"ledger_commit": commit, "checker": checker, "candidates": listed}
