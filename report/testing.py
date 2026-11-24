"""A line's multiple-testing reading, read alone (`research multiple-testing`)."""

from __future__ import annotations

from ledger import db, lines
from registration import availability, precheck
from report import candidates as report_candidates, measures, status


def line_testing(ledger, line: str, at: str | None = None) -> dict:
    """{ledger_commit, multiple_testing, deflated_sharpe}: a line's multiple-testing reading alone and, by trial ID as
    text, the deflated Sharpe range (deflated_range) of each of the line's own passed research runs with economic
    evidence, as `research status` gives them, without its comparison table and the market read behind it. Both move
    with every overlapping trial of the ledger, so a run's sealed report cannot hold them."""
    checker = availability.check_identity()
    with db.read_as_of(db.profile(ledger), at) as conn:
        record = lines.read_line(conn, line)  # LINE_UNKNOWN for a bad name
        records = precheck.review_records(conn)

        def available(trial_ids: list[int]) -> set[int]:
            return {trial_id for trial_id, reading in report_candidates.assess_runs(conn, trial_ids, checker, records).items()
                    if reading["economic_evidence_available"]}
        testing = status.multiple_testing(conn, line, status.counted_trials(conn)["counted"], available)
        passed, _ = status.passed_research_runs(conn, checker, records, line_ids=[record["line_id"]])
        ranges = {str(trial_id): status.deflated_range(facts, testing)
                  for trial_id, facts in measures.runs_facts(conn, [row["trial_id"] for row in passed])}
        return {"ledger_commit": db.head_commit(conn), "multiple_testing": testing, "deflated_sharpe": ranges}
