"""The Live evidence pack: the market data a run received and the native record of what it did, in the forms
Paper journals and a replay seals, for comparing the run with a replay of its source
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

EVIDENCE = "evidence"
MARKET = "market.jsonl"
INSTRUMENTS = "instruments.json"


class Evidence:
    """Appends market rows to ``evidence/market.jsonl``; writes the native reports when the node stops."""

    def __init__(self, output: Path, report_failure: Callable[[str, str], object]):
        self.root = output / EVIDENCE
        self._report_failure = report_failure
        self.failed: set[str] = set()
        self._lock = threading.Lock()

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

    def bar(self, bar, kind: str = "bar") -> None:
        """A bar the source received: ``bar`` live, ``historical_bar`` from a history request (warm-up)."""
        try:
            fields = dict(bar_type=str(bar.bar_type), instrument_id=str(bar.bar_type.instrument_id),
                          ts_event=bar.ts_event, ts_init=bar.ts_init, open=str(bar.open), high=str(bar.high),
                          low=str(bar.low), close=str(bar.close), volume=str(bar.volume))
        except Exception as exc:
            self._fail("market", exc)
            return
        self._append(kind, **fields)

    def mark(self, update) -> None:
        """The first MARK of a minute, the one a replay values positions with."""
        try:
            fields = dict(instrument_id=str(update.instrument_id), ts_event=update.ts_event, ts_init=update.ts_init,
                          value=str(update.value))
        except Exception as exc:
            self._fail("market", exc)
            return
        self._append("mark", **fields)

    def funding(self, settled, mark: tuple[int, object] | None, positions) -> None:
        """A funding settlement (engine.cadence.Cadence.funding) with the open positions it applies to, as Paper
        journals it."""
        try:
            fields = dict(instrument_id=str(settled.instrument_id), settlement_ns=settled.ts_event,
                          stream_rate=str(settled.rate), mark=str(mark[1]) if mark else None,
                          mark_ts=mark[0] if mark else None,
                          positions=[{"position_id": str(position.id), "signed_qty": str(position.signed_qty)}
                                     for position in positions])
        except Exception as exc:
            self._fail("market", exc)
            return
        self._append("funding_settlement", **fields)

    def reports(self, cache, venue) -> None:
        """Every order, fill, position and account state in the native cache as a replay writes them, and the
        native instruments the run traded, into ``reports-<observed_ns>/``. A reconciliation resumes the run's
        cache, so its reports hold the whole run; the account states only the last day once the node ran an hour
        (the native purge, engine.live_node)."""
        try:
            from engine.report import write_cache_reports
            name = f"reports-{time.time_ns()}"
            partial = self.root / f".{name}.partial"
            partial.mkdir(mode=0o700, parents=True)
            write_cache_reports(partial, cache, venue)
            instruments = {str(value.id): type(value).to_dict(value) for value in cache.instruments()}
            (partial / INSTRUMENTS).write_text(json.dumps(instruments, sort_keys=True, indent=1, default=str) + "\n")
            os.replace(partial, self.root / name)
        except Exception as exc:
            self._fail("reports", exc)
