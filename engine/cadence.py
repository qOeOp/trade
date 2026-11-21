"""The live feed brought to the replay's cadence (one MARK a minute, one funding update per settlement), for Paper
and Live alike."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from nautilus_trader.model import FundingRateUpdate

from engine.config import MINUTE_NS


@dataclass
class Cadence:
    """Per instrument and consumer: which live MARK and funding updates count."""
    mark_minute: int | None = None
    next_funding_ns: int | None = None

    def mark(self, update) -> bool:
        """The first MARK of each minute passes."""
        minute = update.ts_event // MINUTE_NS
        if self.mark_minute is not None and minute <= self.mark_minute:
            return False
        self.mark_minute = minute
        return True

    def funding(self, update) -> FundingRateUpdate | None:
        """The settlement the live estimates passed, if this update is the first after it: the update the replay
        gives, with the rate settled, stamped at the settlement's hour and naming it as its next funding. The replay's
        update is stamped at Binance's settlement time, which can be some milliseconds after the hour. Binance's
        first estimate after a settlement carried the settled rate in the native probes (2026-11-15: the rate its
        funding-rate history then published); the sealing step accounts with the rate Binance publishes. A settlement
        of the source's start hour is not here: a declared history holds one stamped T, and the warm-up gives one
        stamped after T (engine.history, step 6). An estimate before the named time that names a later one is no
        settlement: Binance moved it when it changed the funding interval."""
        settled, self.next_funding_ns = self.next_funding_ns, update.next_funding_ns
        if (settled is None or update.next_funding_ns is None or update.next_funding_ns <= settled
                or update.ts_event < settled):
            return None
        return FundingRateUpdate(update.instrument_id, update.rate, settled, update.ts_init, None, settled)

    @staticmethod
    def wrap(name: str, attribute: str, deliver: Callable[[Any, Any, Any], Any],
             skipped: Callable[[Any], Any] = lambda update: None) -> Callable[[Any, Any], Any]:
        """The runner's `name` callback (on_mark_price or on_funding_rate): the instance's Cadence (its `attribute`)
        decides which live update counts, `deliver(instance, passed, update)` takes the update the replay gives for it
        and `skipped(update)` every other."""
        def callback(self, update):
            cadence = getattr(self, attribute)
            passed = (update if cadence.mark(update) else None) if name == "on_mark_price" else cadence.funding(update)
            return skipped(update) if passed is None else deliver(self, passed, update)
        return callback
