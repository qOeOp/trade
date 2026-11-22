"""Live admission's research checks that preparation (live.runs.prepare_locked) makes, and the replay code a replay
or Paper run must share with the execution image to back a run."""

from __future__ import annotations

from pathlib import Path

from ledger import db
from live import state
from runtime import image
from shared.errors import Refusal

# What --describe reports of the replay closure: equal values mean the same replay code (R2, user 2026-11-12).
REPLAY_CODE = ("source_files_sha256", "audit_source_sha256", "dependency_lock_sha256")


def replay_code(image_ref: str, runner_args: list[str]) -> dict | None:
    """The replay code (REPLAY_CODE) an image's --describe probe reports, or None for an image that cannot be read
    now (it backs nothing)."""
    try:
        found = image.inspect_runtime(image.resolve(image_ref), runner_args)
    except Refusal:
        return None
    return {name: found[name] for name in REPLAY_CODE}


def unfalsified(research: db.LedgerProfile, research_at: str, source_sha256: str, market_root: Path) -> None:
    """Live runs only a candidate its line's closing history test decided meets the targets, read at research_at
    with the test planned on the market directory `market_root` (report.history.require_unfalsified, the check
    validation registration makes; 20261120-06, user 2026-11-21): LIVE_CANDIDATE_FALSIFIED for one it judged not
    meeting them, LIVE_HISTORY_UNDECIDED for one it has not decided."""
    from report import history
    market = {"name": "live", "holds": "market", "root": str(market_root)}
    with db.read_as_of(research, research_at) as reader:
        try:
            history.require_unfalsified(reader, source_sha256, market)
        except Refusal as exc:
            if exc.code in ("CANDIDATE_FALSIFIED", "HISTORY_UNDECIDED"):
                raise state.fail(f"LIVE_{exc.code}", exc.message) from None
            raise
