"""The one place every native replay reports itself, and where a sealed run is stored.

`artifacts run` calls `report_trial` once per replay, exploration or sealed, before the replay
starts: a trial row in the open round counts toward selection pressure. `hand_off_run` stores a
sealed run whole once its reports and audit exist; an exploration is never stored.
"""

from __future__ import annotations

import re

from research.records import records


MODES = ("explore", "sealed")
_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_IMAGE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[0-9a-f]{64}\Z")


def report_trial(ledger: dict, *, mode: str, strategy_source_sha256: str, coins: list[str], start: str,
                 trade_start: str, end: str, image_ref: str, conn=None, registration=None, execution_start=None) -> int:
    """Write one trial row; returns its ID. Refused when no round is open."""
    if mode not in MODES:
        raise ValueError(f"trial mode must be one of {MODES}")
    if not isinstance(strategy_source_sha256, str) or not _SHA256.fullmatch(strategy_source_sha256):
        raise ValueError("trial needs the strategy source SHA-256")
    if not isinstance(image_ref, str) or not _IMAGE.fullmatch(image_ref):
        raise ValueError("trial needs the runtime image reference pinned by digest")
    if not coins or any(not isinstance(coin, str) or not coin for coin in coins):
        raise ValueError("trial needs its coins")
    import secrets
    extra = {"registration": registration} if registration is not None else {}
    if execution_start is not None:
        extra["execution_start"] = execution_start
    written = records.report_trial(ledger, mode=mode, source_sha256=strategy_source_sha256, image_ref=image_ref,
                                   coins=coins, start=start, trade_start=trade_start, end=end,
                                   op=f"trial:{secrets.token_hex(16)}", conn=conn, **extra)
    return written["trial_id"]


def hand_off_run(ledger: dict, *, trial_id: int, reports, problems: list[str], inspection: dict,
                 image_revision: str | None, effective_config: dict, input_identity: dict, conn=None) -> dict:
    """Store an audited sealed run in one write: its rows and readings, or only its summary and reasons."""
    return records.ingest_run(ledger, trial_id=trial_id, reports=reports, problems=problems, inspection=inspection,
                              image_revision=image_revision, effective_config=effective_config,
                              input_identity=input_identity, conn=conn)
