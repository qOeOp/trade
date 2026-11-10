"""The runner's warm-up at T, one flow for replay, Paper and Live (docs/plans/r1-runtime-contract-20261110.zh.md, 5).

A runner class puts Warming before the source's class, and engine.strategy.deferred_start has moved the source's
on_start and on_historical_bars aside. At T the runner:

1. (Paper and Live) waits SETTLE_NS, while Binance can still revise the kline that closed at T (2026-11-11 probe:
   close, volume and trade count changed until 5 to 10 s after T, never later), then reads every bar its requests
   cover from Binance's public klines (engine.klines) into the run's temporary Catalog, off the node's thread;
2. has WarmupActor warm each declared aggregation with the one-minute bars of the bucket T falls in,
   [floor(T, P), T), so that the first aggregated bar the source sees is complete; these responses go to the actor;
3. requests each declared history for the source (engine.warmup.history_range);
4. checks every response: the requested bars, ascending and adjacent, and (Paper and Live) exactly the bars written;
5. hands each history to the source's on_historical_bars once, then runs its on_start (`_warming_begin`).

Until then the source's orders are refused (engine.order_rules.WARMING). A failure goes to `_warming_failed`: replay
and Paper record it and refuse the run, Live stops. Paper and Live refuse a start whose warm-up has not completed by
T + DEADLINE_NS (WARMUP_TIMEOUT), whose declared history Binance does not hold (WARMUP_INSUFFICIENT), or whose first
live minute is not the one that follows T (WARMUP_NOT_ADJACENT).
"""
from __future__ import annotations

import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from nautilus_trader.common import DataActor
from nautilus_trader.persistence import ParquetDataCatalog
from nautilus_trader.trading import Strategy

from engine import klines, order_rules, warmup
from engine.config import MINUTE_NS, Refusal

SECOND_NS = 1_000_000_000
SETTLE_NS = 15 * SECOND_NS
# Paper and Live close a time bar on a timer at its bucket's end, but Binance's last minute of the bucket can arrive
# later (174 ms in the 2026-11-11 Paper trial, which dropped it): the aggregation waits this long (microseconds),
# and rc7 stamps the bar that much after the bucket's end.
BUILD_DELAY_US = 5_000_000
DEADLINE_NS = 45 * SECOND_NS  # the first live minute closes 60 s after T; its subscription must be in place by then
START_MARGIN_NS = 30 * SECOND_NS  # a Paper or Live T leaves the node this long to start
RETRY_NS = 2 * SECOND_NS
WAIT = timedelta(milliseconds=200)

# Per strategy ID: an instance's warm-up, out of the source's reach.
STATES: dict[str, dict] = {}
ACTORS: list[WarmupActor] = []


def clear() -> None:
    STATES.clear()
    ACTORS.clear()


def start_at(now_ns: int) -> int:
    """The first whole minute at least START_MARGIN_NS after `now_ns`: a Paper or Live start's T."""
    return -(-(now_ns + START_MARGIN_NS) // MINUTE_NS) * MINUTE_NS


def utc(ns: int) -> datetime:
    return datetime.fromtimestamp(ns // SECOND_NS, UTC) + timedelta(microseconds=ns % SECOND_NS // 1000)


def requests(at: int, declared) -> list[tuple[str, str, int, int]]:
    """(role, period, first, last) of every request at `at`: "warm" for the one-minute bars of an aggregation's
    current bucket, "history" for a declared history; `first` and `last` bound the requested ts_event."""
    found = [("warm", period, warmup.bucket_start(at, period), at - warmup.MILLISECOND_NS)
             for period, _ in declared if period != "1-MINUTE" and warmup.bucket_start(at, period) < at]
    found.extend(("history", period, *warmup.history_range(at, period, count)) for period, count in declared if count)
    return found


def fetch(instrument_id, at: int, declared, precisions: tuple[int, int], catalog: Path, proxy_url: str | None,
          get=klines.get_json) -> list[list]:
    """Read the bars of every request at `at` from Binance's klines into `catalog`, each bar type once over the
    span its requests cover; returns each request's bars. WARMUP_INSUFFICIENT when Binance lacks a declared history
    or the minutes of a bucket."""
    planned = requests(at, declared)
    spans: dict[str, tuple[int, int]] = {}
    for role, period, first, last in planned:
        source = "1-MINUTE" if role == "warm" else period
        low, high = spans.get(source, (first, last))
        spans[source] = (min(low, first), max(high, last))
    written = {}
    for period, (first, last) in spans.items():
        found = klines.bars(instrument_id, period, warmup.bucket_start(first, period), last, precisions, proxy_url,
                            get)
        if not found:
            raise Refusal("WARMUP_INSUFFICIENT", f"{instrument_id}: Binance has no {period} kline in "
                                                 f"[{utc(first)}, {utc(last)}]")
        ParquetDataCatalog(str(catalog)).write_bars(found, start=first, end=last)
        written[period] = found
    answers = []
    for role, period, first, last in planned:
        found = [bar for bar in written["1-MINUTE" if role == "warm" else period] if first <= bar.ts_event <= last]
        count = dict(declared)[period]
        if role == "history" and not warmup.adjacent([bar.ts_event for bar in found], at, period, count):
            raise Refusal("WARMUP_INSUFFICIENT", f"{instrument_id}: Binance holds {len(found)} of the {count} adjacent "
                                                 f"{period} bars that end at {utc(last)}")
        answers.append(found)
    return answers


def _same(found, expected) -> bool:
    return [bar.to_dict() for bar in found] == [bar.to_dict() for bar in expected]


class Warming:
    """The runner's side of the warm-up, before the source's class. The runner's __init__ calls `_warming_setup`."""

    _source_on_start: Any
    _source_on_historical_bars: Any

    def _warming_setup(self, strategy_id, instrument_id, at: int, declared,
                       fetch: Callable[[Any, int, Any, tuple[int, int]], list[list]] | None = None) -> None:
        """`fetch(instrument_id, at, declared, precisions)` fills the run's Catalog (Paper and Live; see fetch)."""
        order_rules.WARMING.add(str(strategy_id))
        STATES[str(strategy_id)] = {
            "at": at, "instrument_id": instrument_id, "declared": declared, "fetch": fetch, "pending": set(),
            "received": {}, "expected": {}, "delivered": {}, "result": None, "thread": None, "fetched_ns": None,
            "requested": False, "done": False}

    def _warming_state(self) -> dict:
        return STATES[str(Strategy.strategy_id.__get__(self, type(self)))]

    def _warming_clock(self):
        return Strategy.clock.__get__(self, type(self))

    def on_start(self):
        state = self._warming_state()
        when = state["at"] + (SETTLE_NS if state["fetch"] and requests(state["at"], state["declared"]) else 0)
        clock = self._warming_clock()
        if clock.timestamp_ns() >= when:
            self._warming_go()
        else:
            clock.set_time_alert_ns("runner-warmup", when, self._warming_go)

    def _warming_go(self, _event=None) -> None:
        state = self._warming_state()
        planned = requests(state["at"], state["declared"])
        if state["fetch"] is None or not planned:
            return self._warming_request(planned, None)
        instrument = Strategy.cache.__get__(self, type(self)).instrument(state["instrument_id"])
        if instrument is None:
            return self._warming_stop("WARMUP_INSUFFICIENT", f"{state['instrument_id']}: the venue gave no instrument")
        precisions = (instrument.price_precision, instrument.size_precision)

        def work():
            while True:
                try:
                    state["result"] = state["fetch"](state["instrument_id"], state["at"], state["declared"],
                                                     precisions)
                except OSError as exc:  # the network: try again while the deadline allows
                    state["result"] = exc
                    if time.time_ns() + RETRY_NS < state["at"] + DEADLINE_NS:
                        time.sleep(RETRY_NS / SECOND_NS)
                        continue
                except BaseException as exc:  # handed to the node's thread by _warming_wait
                    state["result"] = exc
                state["fetched_ns"] = time.time_ns()
                return

        state["thread"] = threading.Thread(target=work, name=f"warmup-{state['instrument_id']}", daemon=True)
        state["thread"].start()
        self._warming_clock().set_timer("runner-warmup-wait", WAIT, callback=self._warming_wait)

    def _warming_wait(self, _event=None) -> None:
        state = self._warming_state()
        if state["done"]:
            return self._warming_clock().cancel_timer("runner-warmup-wait")
        if self._warming_clock().timestamp_ns() >= state["at"] + DEADLINE_NS:
            found = state["result"]
            return self._warming_stop("WARMUP_TIMEOUT", f"{state['instrument_id']}: the warm-up had not completed "
                                      f"{DEADLINE_NS // SECOND_NS} s after {utc(state['at'])}"
                                      + (f" ({type(found).__name__}: {found})" if isinstance(found, BaseException) else ""))
        if state["requested"] or state["thread"].is_alive():
            return None
        found = state["result"]
        if isinstance(found, Refusal):
            return self._warming_stop(found.code, str(found))
        if isinstance(found, BaseException):
            return self._warming_stop("WARMUP_TIMEOUT", f"{state['instrument_id']}: Binance klines could not be read "
                                                        f"({type(found).__name__}: {found})")
        return self._warming_request(requests(state["at"], state["declared"]), found)

    def _warming_request(self, planned, answers) -> None:
        state = self._warming_state()
        state["requested"] = True
        instrument_id = state["instrument_id"]
        for index, (role, period, _, _) in enumerate(planned):
            # A replay does not wait for its aggregation warm-ups: its responses arrive in stream order.
            if role == "history" or answers is not None:
                state["pending"].add((role, period))
            if answers is not None:
                state["expected"][(role, period)] = answers[index]
        if ACTORS:
            ACTORS[0].follow(self, instrument_id, state["at"])
        for role, period, first, last in planned:
            if role == "warm":
                ACTORS[0].warm(self, instrument_id, period, first, last, state["expected"].get((role, period)))
            else:
                Strategy.request_bars(self, warmup.bar_type(instrument_id, period),  # type: ignore[arg-type]
                                      start=utc(first), end=utc(last))
        if not state["pending"]:
            self._warming_complete()

    def on_historical_bars(self, bars):
        state = self._warming_state()
        if state["done"] or not bars:
            return None
        period = str(bars[0].bar_type).removeprefix(f"{state['instrument_id']}-").removesuffix("-LAST-EXTERNAL")
        key = ("history", period)
        if key not in state["pending"]:
            return None
        received = state["received"].setdefault(key, [])
        received.extend(bars)
        count = dict(state["declared"])[period]
        if len(received) < count:
            return None
        expected = state["expected"].get(key)
        if (len(received) != count or not warmup.adjacent([bar.ts_event for bar in received], state["at"], period, count)
                or expected is not None and not _same(received, expected)):
            return self._warming_stop("WARMUP_NOT_ADJACENT", f"{Strategy.strategy_id.__get__(self, type(self))}: "
                                      f"{bars[0].bar_type} answered {len(received)} bars, not the {count} adjacent "
                                      "ones requested" + (" as written" if expected is not None else ""))
        state["pending"].discard(key)
        state["delivered"][period] = list(received)
        self._source_on_historical_bars(list(received))
        if not state["pending"]:
            self._warming_complete()
        return None

    def _warming_warmed(self, period: str) -> None:
        state = self._warming_state()
        state["pending"].discard(("warm", period))
        if state["requested"] and not state["pending"] and not state["done"]:
            self._warming_complete()

    def _warming_complete(self) -> None:
        state = self._warming_state()
        state["done"] = True
        if state["thread"]:
            self._warming_clock().cancel_timer("runner-warmup-wait")
        self._warming_begin()

    def _warming_stop(self, code: str, text: str) -> None:
        state = self._warming_state()
        if state["done"]:
            return
        state["done"] = True
        if state["thread"]:
            self._warming_clock().cancel_timer("runner-warmup-wait")
        self._warming_failed(code, text)

    def _warming_failed(self, code: str, text: str) -> None:
        self._breach(code, text)  # type: ignore[attr-defined]  # engine.strategy.Subscriptions or the runner's

    def _warming_begin(self) -> None:
        """Lift the order gate and run the source's on_start; Paper first passes its recovery barrier."""
        order_rules.WARMING.discard(str(Strategy.strategy_id.__get__(self, type(self))))
        self._source_on_start()


@dataclass
class WarmupActorConfig:
    live: bool = False  # Paper and Live: also check the first live minute after T


class WarmupActor(DataActor):
    """Warms each declared aggregation at its instance's T with the one-minute bars of the bucket T falls in; the
    responses come here, never to the source. In Paper and Live it also checks that the first live minute after T
    is the one that closes at T + 1 minute."""

    def __init__(self, config: WarmupActorConfig | None = None):
        super().__init__()
        ACTORS.append(self)
        self.live = bool(config and config.live)
        self.pending: dict[str, list[tuple]] = {}  # one-minute bar type: (first, last, expected, source, period)
        self.following: dict[str, tuple[int | None, Any]] = {}  # instrument ID: (T until checked, source)

    def warm(self, source, instrument_id, period: str, first: int, last: int, expected) -> None:
        minute = warmup.bar_type(instrument_id, "1-MINUTE")
        self.pending.setdefault(str(minute), []).append((first, last, expected, source, period))
        self.request_bars(minute, start=utc(first), end=utc(last), params={
            "bar_types": [str(warmup.aggregated_type(instrument_id, period))], "update_subscriptions": True,
            "skip_first_non_full_bar": False})

    def on_historical_bars(self, bars) -> None:
        if not bars:
            return
        queue = self.pending.get(str(bars[0].bar_type), [])
        stamps = [bar.ts_event for bar in bars]
        for index, (first, last, expected, source, period) in enumerate(queue):
            if expected is not None and _same(bars, expected) or expected is None and (
                    stamps == sorted(set(stamps)) and first <= stamps[0] and stamps[-1] <= last):
                del queue[index]
                return source._warming_warmed(period)
        if queue:
            first, last, expected, source, period = queue.pop(0)
            source._warming_stop("WARMUP_NOT_ADJACENT", f"{bars[0].bar_type}: the {period} warm-up answered "
                                 f"{len(bars)} bars, not the minutes of [{utc(first)}, {utc(last)}]"
                                 + (" as written" if expected is not None else ""))

    def follow(self, source, instrument_id, at: int) -> None:
        if self.live and str(instrument_id) not in self.following:
            self.following[str(instrument_id)] = (at, source)
            self.subscribe_bars(warmup.bar_type(instrument_id, "1-MINUTE"))

    def on_bar(self, bar) -> None:
        iid = str(bar.bar_type.instrument_id)
        at, source = self.following.get(iid, (None, None))
        if at is None or bar.ts_event < at:
            return
        self.following[iid] = (None, source)
        if bar.ts_event != at + MINUTE_NS - warmup.MILLISECOND_NS:
            source._warming_failed("WARMUP_NOT_ADJACENT", f"{iid}: the first live minute after {utc(at)} closed at "
                                                         f"{utc(bar.ts_event + warmup.MILLISECOND_NS)}")



def bar_capacity(declared) -> int:
    """The native cache's bars per type: the longest history and a day of minutes (by default it keeps 10,000)."""
    return max(10_000, max((count for _, count in declared), default=0) + 1440)
