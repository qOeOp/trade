"""The Live evidence pack: the market data a run received (engine.realtime.MarketRows, the rows Paper journals) and the
native record of what it did, as a replay seals it, for comparing the run with a replay of its source
(docs/plans/live-evidence-pack-20261110.zh.md). It stays in the run's private directory, never the ledger.

Recording never changes the run: a failed write is journaled once per part and the run goes on.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import threading
import time
from typing import Callable

from engine.realtime import MarketRows

EVIDENCE = "evidence"
MARKET = "market.jsonl"


class Evidence:
    """Appends market rows to ``evidence/market.jsonl``; writes the native reports when the node stops."""

    def __init__(self, output: Path, report_failure: Callable[[str, str], object]):
        self.root = output / EVIDENCE
        self._report_failure = report_failure
        self.failed: set[str] = set()
        self._lock = threading.Lock()
        self._rows = MarketRows(self._append)

    def _fail(self, part: str, exc: BaseException) -> None:
        if part not in self.failed:
            self.failed.add(part)
            self._report_failure(part, type(exc).__name__)

    def _append(self, kind: str, **fields) -> None:
        try:
            line = json.dumps({"wall_ns": time.time_ns(), "kind": kind, **fields}, sort_keys=True, default=str)
            with self._lock:
                self.root.mkdir(mode=0o700, exist_ok=True)
                with (self.root / MARKET).open("a", encoding="utf-8") as stream:
                    stream.write(line + "\n")
        except (OSError, ValueError, TypeError) as exc:
            self._fail("market", exc)

    def market(self, name: str, *args) -> None:
        """One call of engine.realtime.MarketRows (`name`: bar, warmup, metrics, metrics_unsubscribed, kline_events):
        its rows, in the format Paper journals them, go to ``market.jsonl``."""
        try:
            getattr(self._rows, name)(*args)
        except Exception as exc:
            self._fail("market", exc)

    def reports(self, cache, venue) -> None:
        """Every order, fill, position and account state in the native cache as a replay writes them, into
        ``reports-<observed_ns>/``. A reconciliation resumes the run's cache, so its reports hold the whole run; the
        account states only the last day once the node ran an hour (the native purge, engine.live_node)."""
        try:
            from engine.report import write_cache_reports
            name = f"reports-{time.time_ns()}"
            partial = self.root / f".{name}.partial"
            partial.mkdir(mode=0o700, parents=True)
            write_cache_reports(partial, cache, venue)
            os.replace(partial, self.root / name)
        except Exception as exc:
            self._fail("reports", exc)
