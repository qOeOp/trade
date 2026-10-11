"""The one place every native replay reports itself.

`artifacts run` calls `report_trial` once per replay, exploration or sealed, before the replay
starts, and `hand_off_run` once its reports and audit exist. Selection pressure is counted from
the trials; the hand-off gives the run's working directory and audit result to their owner.

WS2 replaces both bodies with Dolt writes (the `trial` table and the run's storage). Until then
this is a minimal, testable implementation and not a store: the records are returned to the
caller, which prints them, and an exploration's trial is also written into its temporary run
directory. Do not build a durable log on it.
"""

from __future__ import annotations

import json
import os
import re
from datetime import UTC, datetime
from pathlib import Path


MODES = ("explore", "sealed")
_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")


def report_trial(*, mode: str, strategy_source_sha256: str, coins: list[str], start: str, trade_start: str,
                 end: str, image_digest: str, run_id: str | None = None, run_dir: Path | None = None) -> dict:
    """Report one native replay. Replaced in WS2 by an insert into the Dolt `trial` table."""
    if mode not in MODES:
        raise ValueError(f"trial mode must be one of {MODES}")
    if not isinstance(strategy_source_sha256, str) or not _SHA256.fullmatch(strategy_source_sha256):
        raise ValueError("trial needs the strategy source SHA-256")
    if not isinstance(image_digest, str) or not _DIGEST.fullmatch(image_digest):
        raise ValueError("trial needs the runtime image manifest digest")
    if not coins or any(not isinstance(coin, str) or not coin for coin in coins):
        raise ValueError("trial needs its coins")
    if (mode == "sealed") != (run_id is not None):
        raise ValueError("a sealed trial names its run ID; an exploration has none")
    trial = {"mode": mode, "strategy_source_sha256": strategy_source_sha256, "coins": list(coins),
             "window": {"start": start, "trade_start": trade_start, "end": end},
             "image_digest": image_digest, "reported_at": datetime.now(UTC).isoformat(), "run_id": run_id}
    if run_dir is not None:
        with (run_dir / "trial.json").open("x", encoding="utf-8") as stream:
            json.dump(trial, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
    return trial


def hand_off_run(*, mode: str, run_dir: Path, audit: dict | None, run_id: str | None = None) -> dict:
    """Give a finished replay's working directory and audit result to their owner.

    Replaced in WS2 by storing the audited run in Dolt; today a sealed run stays in artifact custody
    and an exploration stays in its temporary directory.
    """
    if mode not in MODES:
        raise ValueError(f"run mode must be one of {MODES}")
    return {"mode": mode, "run_id": run_id, "run_dir": str(run_dir),
            "audit_passed": bool(audit and audit.get("passed") and not audit.get("findings")),
            "audit_findings": list(audit.get("findings") or []) if audit else ["native audit unavailable"]}
