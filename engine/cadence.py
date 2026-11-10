"""The live feed brought to the replay's cadence (one MARK a minute, one funding update per settlement), for Paper
and Live alike."""
from __future__ import annotations

from dataclasses import dataclass

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
        gives (rate settled, stamped at the settlement and naming it as its next funding). Binance's first
        estimate after a settlement carried the settled rate in the native probe; the sealing step accounts with
        the rate Binance publishes."""
        settled, self.next_funding_ns = self.next_funding_ns, update.next_funding_ns
        if settled is None or update.next_funding_ns is None or update.next_funding_ns <= settled:
            return None
        return FundingRateUpdate(update.instrument_id, update.rate, settled, update.ts_init, None, settled)
