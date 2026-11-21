"""Live admission's research checks that preparation (live.runs.prepare_locked) makes before the replay evidence."""

from __future__ import annotations

from ledger import db
from live import state
from shared.errors import Refusal


def unfalsified(research: db.LedgerProfile, research_at: str, source_sha256: str) -> None:
    """Live runs only a candidate its line's closing history test decided meets the targets, read at research_at
    (report.history.require_unfalsified, the check validation registration makes; 20261120-06, user 2026-11-21):
    LIVE_CANDIDATE_FALSIFIED for one it judged not meeting them, LIVE_HISTORY_UNDECIDED for one it has not decided."""
    from report import history
    with db.read_as_of(research, research_at) as reader:
        try:
            history.require_unfalsified(reader, source_sha256)
        except Refusal as exc:
            if exc.code in ("CANDIDATE_FALSIFIED", "HISTORY_UNDECIDED"):
                raise state.fail(f"LIVE_{exc.code}", exc.message) from None
            raise
