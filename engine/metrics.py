"""Paper and Live: open interest and long/short ratios read from Binance's public REST, as the engine.strategy.Metrics
row a replay streams from its export (market.export, the rule binance-metrics-visible-v2) at the same stamps
(docs/plans/binance-metrics-rest-parity.zh.md). Outside the replay image: a replay never imports it.

A row describes ts_event, REST's timestamp (the archive's create_time + 5 min), and reaches the strategy at ts_init,
5 minutes later. The export gives the values REST shows, so REST's row of a timestamp is the replay's: open interest
equal, the ratios equal but where the archive's 6 or 8 decimals sit at a tie of REST's 4 (probe 2026-11-15, four
contracts over 27 days: 141 of 31,104 position ratios off by 0.0001, 2 of each account ratio).

No credential: ``futures/data/*`` is public. REST publishes a row 23 to 183 s after its timestamp (probes 2026-10-31
and 2026-11-14), within the 5 minutes the rule allows; Paper and Live read it from READ_AHEAD_NS before ts_init and
again every RETRY_NS for what is still missing, keep what they read, and hand the row over on the first tick at or
after ts_init, never before. A row still incomplete at ts_init is handed over once a read completes it, or when the
next row is due; a row whose open interest is still missing then is skipped, and a ratio still missing is None, as
the archive leaves an empty one.
"""
from __future__ import annotations

import threading
import urllib.parse
from datetime import timedelta
from decimal import Decimal
from typing import Any

from nautilus_trader.model import CustomData, InstrumentId
from nautilus_trader.trading import Strategy

from engine import klines
from engine.config import MINUTE_NS
from engine.strategy import Metrics, metrics_data_type

PERIOD_NS = 5 * MINUTE_NS  # one row per five minutes
VISIBLE_NS = 5 * MINUTE_NS  # ts_init less ts_event (market.export: create_time + 10 min less create_time + 5 min)
RETRY_NS = 30 * 1_000_000_000  # REST allows 1000 requests per 5 minutes per IP; a row costs 4 when published on time
# A row's first read, 240 s after its timestamp: REST has published it by then (above), and a row it has not yet is
# read again RETRY_NS later and at ts_init. Reading at ts_init instead handed it over a read and a tick late (1 to 2 s,
# 2026-11-15 Paper trial).
READ_AHEAD_NS = 2 * RETRY_NS
TICK = timedelta(seconds=1)
TIMER = "runner-metrics"  # the Feed's own timer on the source's clock, not a source timer (engine.paper_session)
EXACT = Decimal("1e-16")  # the export's decimal128(38, 16): a value reads back with 16 places in either mode
# The Metrics field each public endpoint gives, and the endpoint's field holding it.
ENDPOINTS = {"sum_open_interest": ("openInterestHist", "sumOpenInterest"),
             "count_toptrader_long_short_ratio": ("topLongShortAccountRatio", "longShortRatio"),
             "sum_toptrader_long_short_ratio": ("topLongShortPositionRatio", "longShortRatio"),
             "count_long_short_ratio": ("globalLongShortAccountRatio", "longShortRatio")}


def read(instrument_id, ts_event: int, wanted, proxy_url: str | None, get=klines.get_json) -> dict:
    """The fields of `wanted` (ENDPOINTS keys) that REST holds for its row stamped ts_event, as exact decimals."""
    symbol = str(instrument_id).split("-PERP.")[0]
    stamp = ts_event // klines.NS_PER_MS
    found = {}
    for name in wanted:
        endpoint, field = ENDPOINTS[name]
        query = {"symbol": symbol, "period": "5m", "startTime": stamp, "endTime": stamp, "limit": 1}
        rows = get(f"{klines.REST_BASE}/futures/data/{endpoint}?{urllib.parse.urlencode(query)}", proxy_url)
        row = next((row for row in rows if int(row["timestamp"]) == stamp), None)
        if row is not None and row.get(field) not in (None, ""):
            found[name] = Decimal(str(row[field])).quantize(EXACT)
    return found


class Feed:
    """Paper and Live: a source's Metrics subscription (engine.strategy.Subscriptions) served from REST on the runner's
    clock, each row handed to the source's on_data as the replay hands it. `_metrics_setup(read)` comes first; `read`
    is `read` above with the run's proxy bound."""

    on_data: Any  # the strategy's
    log: Any

    def _metrics_setup(self, reader) -> None:
        self._metrics_read = reader
        self._metrics_followed: dict[str, dict] = {}

    def _metrics_clock(self):
        return Strategy.clock.__get__(self, type(self))  # the runner's, not the source's guarded clock

    def _metrics_follow(self, instrument_id: str, after_ns: int | None = None) -> None:
        """From the first row the replay would still deliver: stamped at or after the instance's input start
        (engine.strategy.guard_callback) and due after now, or after `after_ns` (a Paper recovery's checkpoint cut:
        the rows due since then are back-filled, engine.paper_session)."""
        if instrument_id in self._metrics_followed:
            return
        clock = self._metrics_clock()
        after = clock.timestamp_ns() if after_ns is None else after_ns
        start = max(getattr(self, "_replay_input_start_ns", 0), after - VISIBLE_NS + 1)
        first = -(-start // PERIOD_NS) * PERIOD_NS
        self._metrics_followed[instrument_id] = {"instrument_id": instrument_id, "ts_event": first, "found": {},
                                                 "thread": None, "retry_ns": 0}
        if TIMER not in clock.timer_names():
            clock.set_timer(TIMER, TICK, callback=self._metrics_tick)

    def _metrics_unfollow(self, instrument_id: str) -> None:
        self._metrics_followed.pop(instrument_id, None)
        if not self._metrics_followed and TIMER in self._metrics_clock().timer_names():
            self._metrics_clock().cancel_timer(TIMER)

    def _metrics_owed(self, now: int) -> list[dict]:
        """The followed contracts' states whose next row is due by `now` and not yet handed over."""
        return [state for state in self._metrics_followed.values() if state["ts_event"] + VISIBLE_NS <= now]

    def _metrics_read_now(self, state: dict) -> None:
        """Read the state's row on the calling thread, for a back-fill: REST has long published it. Raises what the
        read raises."""
        state["found"].update(self._metrics_read(state["instrument_id"], state["ts_event"], list(ENDPOINTS)))

    def _metrics_tick(self, _event=None) -> None:
        """Each followed contract's due rows; none once the source unfollowed it, even from a row's own on_data."""
        now = self._metrics_clock().timestamp_ns()
        for state in list(self._metrics_followed.values()):
            while self._metrics_followed.get(state["instrument_id"]) is state and self._metrics_step(state, now):
                pass

    def _metrics_step(self, state: dict, now: int) -> bool:
        """Advance one followed contract; True when it moved on to its next row. A row is read from READ_AHEAD_NS
        before it is due and handed over on the first tick at or after due."""
        due = state["ts_event"] + VISIBLE_NS
        thread = state["thread"]
        if now < due - READ_AHEAD_NS or thread is not None and thread.is_alive():
            return False
        complete = len(state["found"]) == len(ENDPOINTS)
        if now >= due and (complete or thread is not None and now >= due + PERIOD_NS - RETRY_NS):
            self._metrics_hand(state)
            return True
        if not complete and now >= state["retry_ns"]:
            wanted = [name for name in ENDPOINTS if name not in state["found"]]

            def work(state=state, ts_event=state["ts_event"]):
                try:
                    state["found"].update(self._metrics_read(state["instrument_id"], ts_event, wanted))
                except Exception as exc:  # the network or an answer REST changed: try again until the deadline
                    state["error"] = f" ({type(exc).__name__}: {exc})"
            state["thread"] = threading.Thread(target=work, name=f"metrics-{state['instrument_id']}", daemon=True)
            state["retry_ns"] = now + RETRY_NS
            state["thread"].start()
        return False

    def _metrics_hand(self, state: dict) -> None:
        """Hand the state's row over as read (one without open interest is skipped) and move on to the next row."""
        found, due = state["found"], state["ts_event"] + VISIBLE_NS
        if "sum_open_interest" in found:
            row = Metrics(InstrumentId.from_str(state["instrument_id"]), found["sum_open_interest"],
                          found.get("count_toptrader_long_short_ratio"),
                          found.get("sum_toptrader_long_short_ratio"), found.get("count_long_short_ratio"),
                          state["ts_event"], due)
            self.on_data(CustomData(metrics_data_type(state["instrument_id"]), row))
        else:
            self.log.warning(f"metrics of {state['instrument_id']} at {state['ts_event']} were not read by the "
                             f"next row's time{state.get('error', '')}; skipped")
        state.update(ts_event=state["ts_event"] + PERIOD_NS, found={}, thread=None, retry_ns=0, error="")
