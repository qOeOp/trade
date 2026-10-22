"""`replay reproduce` (`cli.replay_reproduce`): replay a sealed run by its recorded identity into a
new temporary directory and hand it over only when its semantic fingerprint equals the recorded one."""

from __future__ import annotations

from pathlib import Path

from ledger import db


def replay_reproduce(profile: db.LedgerProfile, market: dict, trial_id: int, output: str) -> dict:
    """replay.reproduce, passed through."""
    from replay import reproduce
    return reproduce.reproduce(trial_id, Path(output), ledger=profile, market=market)
