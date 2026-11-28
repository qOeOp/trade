"""The runner's warm-up at T, one flow for replay, Paper and Live (docs/plans/r1-runtime-contract-20261110.zh.md, 5).

A runner class puts Warming before the source's class, and engine.strategy.deferred_start has moved the source's
on_start and on_historical_bars aside. At T the runner:

1. (Paper and Live) waits SETTLE_NS, while Binance can still revise the kline that closed at T (2026-11-11 probe:
   close, volume and trade count changed until 5 to 10 s after T, never later), then reads every bar its requests
   cover from Binance's public klines (engine.klines) into the run's temporary Catalog, and the declared funding
   settlements from Binance's public funding-rate history (engine.klines.settlements), off the node's thread, until
   the settlement the contract's funding interval makes due at or before T is published (FundingPending; 2026-11-15
   probe: first answered 2 to 4 s after the settlement, while other answers still lacked it until 21 s after). A source
   that reads funding (on_funding_rate) starting on a whole hour has that history read too, declared or not, for the
   settlement of T's hour (step 6);
2. has WarmupActor warm each declared aggregation with the one-minute bars of the bucket T falls in,
   [floor(T, P), T), so that the first aggregated bar the source sees is complete; these responses go to the actor.
   A Paper recovery that crossed a bucket boundary of P (`since`, engine.paper_session.Session) warms from the start of
   the bucket its checkpoint was cut in instead: the native aggregator builds the buckets completed since, which rc7
   puts only into the cache (engine.paper_session.Session.backfill hands them to the source);
3. requests each declared history for the source (engine.warmup.history_range), for such a P at that bucket's start;
4. checks every response: the requested bars, ascending and adjacent, and (Paper and Live) exactly the bars written;
5. hands each history to the source's on_historical_bars once and the funding settlements (a replay's from its export,
   engine.warmup.funding_history) to its on_historical_funding_rates once, then runs its on_start (`_warming_begin`);
6. (Paper and Live) gives the settlement of T's hour that a replay streams after on_start to the source's
   on_funding_rate (`_warming_settled`), when the source subscribed to its contract's funding by the end of on_start;
   the live stream (engine.cadence) passed it before the source subscribed. A replay streams one stamped after T and
   never one stamped T itself, which a declared funding history holds.

Step 1 starts on a clock alert at T (T + SETTLE_NS when it reads Binance), also when the clock is at T already: the
native engine fires an alert after the data that arrives at its time, so a replay instance gets no data arriving at
T, whether T is the window's start or later (rc7 probe 2026-11-15: an alert set in on_start for the engine's start
time fires after that time's data, one set for a later time after that time's data too).

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
from nautilus_trader.model import BarType
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
HOUR_NS = 3600 * SECOND_NS
DAY_NS = 24 * HOUR_NS
# An aggregated bar received this long after its bucket's end is late: rc7 closes a time bar on a monotonic-clock
# timer, which a host sleep or VM pause leaves behind for good (doctor 20261114-30); on time it comes BUILD_DELAY_US
# after the end.
AGGREGATE_LATE_NS = 60 * SECOND_NS
WAIT = timedelta(milliseconds=200)

# Per strategy ID: an instance's warm-up, out of the source's reach.
STATES: dict[str, dict] = {}
ACTORS: list[WarmupActor] = []


def _aligned_step(bar_type: str) -> int | None:
    """The step of an internally aggregated time bar type the hour (steps under an hour) or the day divides; None
    for any other bar type: only those buckets align."""
    kind = BarType.from_str(bar_type)
    if kind.is_externally_aggregated() or not kind.spec.is_time_aggregated():
        return None
    step = kind.spec.get_interval_ns()
    return step if step < HOUR_NS and HOUR_NS % step == 0 or step >= HOUR_NS and DAY_NS % step == 0 else None


def bucket_end(bar_type: str, stamped: int) -> int | None:
    """The end of the bucket an aggregated time bar of `bar_type` stamped `stamped` closes: the one its stamp, less
    the build delay, falls in, so a timer that slipped is judged by the bucket it should have closed (None: no aligned
    bucket, _aligned_step)."""
    step = _aligned_step(bar_type)
    return None if step is None else (stamped - BUILD_DELAY_US * 1000) // step * step


def late_aggregate(bar, now: int) -> bool:
    """Whether `bar`, received at `now`, is an aggregated time bar received more than AGGREGATE_LATE_NS after its
    bucket's end (bucket_end)."""
    if _aligned_step(str(bar.bar_type)) is None:
        return False
    end = bucket_end(str(bar.bar_type), bar.ts_event)
    return end is not None and now - end > AGGREGATE_LATE_NS


def clear() -> None:
    STATES.clear()
    ACTORS.clear()


def read_until(fn: Callable[[], Any], deadline_ns: int, retry_ns: int = RETRY_NS) -> Any:
    """fn()'s answer, on the caller's background thread (rc7 has no executor for it): an OSError (the network) reads
    again after retry_ns while that is still before deadline_ns (wall clock) and is raised after; any other exception
    is raised at once."""
    while True:
        try:
            return fn()
        except OSError:
            if time.time_ns() + retry_ns >= deadline_ns:
                raise
            time.sleep(retry_ns / SECOND_NS)


def start_at(now_ns: int) -> int:
    """The first whole minute at least START_MARGIN_NS after `now_ns`: a Paper or Live start's T."""
    return -(-(now_ns + START_MARGIN_NS) // MINUTE_NS) * MINUTE_NS


def utc(ns: int) -> datetime:
    return datetime.fromtimestamp(ns // SECOND_NS, UTC) + timedelta(microseconds=ns % SECOND_NS // 1000)


def requests(at: int, declared, since: dict[str, int] | None = None) -> list[tuple[str, str, int, int]]:
    """(role, period, first, last) of every request at `at`: "warm" for the one-minute bars of an aggregation's
    current bucket, "history" for a declared history; `first` and `last` bound the requested ts_event. `since` maps an
    aggregation a Paper recovery back-fills to the start of the bucket its checkpoint was cut in: its warm-up starts
    there and its history ends just before it."""
    since = since or {}
    found = [("warm", period, since.get(period, warmup.bucket_start(at, period)), at - warmup.MILLISECOND_NS)
             for period, _ in declared if period != "1-MINUTE" and (period in since
                                                                    or warmup.bucket_start(at, period) < at)]
    found.extend(("history", period, *warmup.history_range(since.get(period, at), period, count))
                 for period, count in declared if count)
    return found


class FundingPending(OSError):
    """A settlement due at or before T is not in Binance's funding-rate history yet: fetched again until the
    deadline, as a network failure is."""


def _slot(ns: int) -> int:
    """The settlement hour of a funding time (market.store.funding_slot): Binance stamps a settlement up to some
    milliseconds after its hour."""
    return (ns + HOUR_NS // 2) // HOUR_NS * HOUR_NS


def settlements(instrument_id, at: int, count: int, proxy_url: str | None, get=klines.get_json,
                base: str | None = None) -> tuple[list, list]:
    """The last `count` settlements at or before `at` (engine.klines.settlements), and those stamped after `at` up to a
    minute after it (the settlement of `at`'s hour when Binance stamped it some milliseconds after the hour).
    FundingPending while the latest settlement due at or before `at` by the contract's funding interval now
    (engine.klines.funding_interval) is after the latest known one but not yet published, so a start at a settlement's
    hour gets it as a replay does; WARMUP_INSUFFICIENT when Binance holds fewer. The interval, not the latest
    settlements' spacing: Binance changes it after a settlement (2026-11 probe: 8 to 1 hours, 1 to 4), and either
    interval makes that settlement due."""
    seen = klines.settlements(instrument_id, at + MINUTE_NS, max(count, 1) + 1, proxy_url, get, base)
    known = [update for update in seen if update.ts_event <= at]
    if known:
        interval = klines.funding_interval(instrument_id, proxy_url, get, base)
        due = at // interval * interval
        if due > _slot(known[-1].ts_event) and not any(_slot(update.ts_event) == due for update in seen):
            raise FundingPending(f"{instrument_id}: the settlement of {utc(due)} is not in Binance's funding-rate "
                                 "history yet")
    if len(known) < count:
        raise Refusal("WARMUP_INSUFFICIENT", f"{instrument_id}: Binance holds {len(known)} of the {count} funding "
                                             f"settlements at or before {utc(at)}")
    return known[len(known) - count:], [update for update in seen if update.ts_event > at]


def fetch(instrument_id, at: int, declared, precisions: tuple[int, int], catalog: Path, proxy_url: str | None,
          get=klines.get_json, funding: int = 0, follow: bool = False,
          since: dict[str, int] | None = None, base: str | None = None) -> tuple[list[list], list, list]:
    """Read the bars of every request at `at` from Binance's klines into `catalog`, each bar type once over the
    span its requests cover, and (`funding` declared or `follow`) the settlements: the last `funding` at or before `at`
    and the one of `at`'s hour (see settlements); returns each request's bars and both. WARMUP_INSUFFICIENT when
    Binance lacks a declared history or the minutes of a bucket. `since`: see requests. `base`: the REST origin
    (engine.klines.bars)."""
    settled, following = settlements(instrument_id, at, funding, proxy_url, get, base) if funding or follow else ([], [])
    since = since or {}
    planned = requests(at, declared, since)
    spans: dict[str, tuple[int, int]] = {}
    for role, period, first, last in planned:
        source = "1-MINUTE" if role == "warm" else period
        low, high = spans.get(source, (first, last))
        spans[source] = (min(low, first), max(high, last))
    written = {}
    for period, (first, last) in spans.items():
        found = klines.bars(instrument_id, period, warmup.bucket_start(first, period), last, precisions, proxy_url,
                            get, base)
        if not found:
            raise Refusal("WARMUP_INSUFFICIENT", f"{instrument_id}: Binance has no {period} kline in "
                                                 f"[{utc(first)}, {utc(last)}]")
        ParquetDataCatalog(str(catalog)).write_bars(found, start=first, end=last)
        written[period] = found
    answers = []
    for role, period, first, last in planned:
        found = [bar for bar in written["1-MINUTE" if role == "warm" else period] if first <= bar.ts_event <= last]
        count = dict(declared)[period]
        if role == "history" and not warmup.adjacent([bar.ts_event for bar in found], since.get(period, at), period,
                                                     count):
            raise Refusal("WARMUP_INSUFFICIENT", f"{instrument_id}: Binance holds {len(found)} of the {count} adjacent "
                                                 f"{period} bars that end at {utc(last)}")
        answers.append(found)
    return answers, settled, following


def _same(found, expected) -> bool:
    return [bar.to_dict() for bar in found] == [bar.to_dict() for bar in expected]


class Warming:
    """The runner's side of the warm-up, before the source's class. The runner's __init__ calls `_warming_setup`."""

    _source_on_start: Any
    _source_on_historical_bars: Any
    _source_on_historical_funding_rates: Any
    _warming_settled: Any  # (Paper and Live) gives the source the settlement of T's hour (step 6)

    def _warming_setup(self, strategy_id, instrument_id, at: int, declared, funding: int = 0,
                       fetch: Callable[..., tuple[list[list], list, list]] | None = None,
                       settlements: list | None = None, follows: bool = False, reads: bool = False,
                       since: dict[str, int] | None = None) -> None:
        """`fetch(instrument_id, at, declared, precisions, funding=funding, follow=..., since=...)` fills the run's
        Catalog and reads the settlements (Paper and Live; see fetch); a replay gives the `settlements` of its export
        instead. `follows`: the Paper or Live source reads funding (on_funding_rate). `reads`: `fetch` reads at T even
        without a request (a Paper recovery's interruption klines, engine.paper_session.Session.read_downtime).
        `since`: the aggregations a Paper recovery back-fills (see requests)."""
        order_rules.WARMING.add(str(strategy_id))
        order_rules.CONTRACTS[str(strategy_id)] = instrument_id
        STATES[str(strategy_id)] = {
            "at": at, "instrument_id": instrument_id, "declared": declared, "funding": funding, "fetch": fetch,
            "settlements": settlements if fetch is None else None, "pending": set(), "received": {}, "expected": {},
            "delivered": {}, "result": None, "thread": None, "requested": False, "done": False,
            "follow": fetch is not None and follows and at % HOUR_NS == 0, "subscribed": False, "following": [],
            "reads": fetch is not None and reads, "since": dict(since or {})}

    def _warming_state(self) -> dict:
        return STATES[str(Strategy.strategy_id.__get__(self, type(self)))]

    def _warming_clock(self):
        return Strategy.clock.__get__(self, type(self))

    def on_start(self):
        state = self._warming_state()
        fetching = state["fetch"] and (requests(state["at"], state["declared"], state["since"]) or state["funding"]
                                       or state["follow"]
                                       or state["reads"])
        when = state["at"] + (SETTLE_NS if fetching else 0)
        clock = self._warming_clock()
        if clock.timestamp_ns() > when:
            self._warming_go()
        else:
            clock.set_time_alert_ns("runner-warmup", when, self._warming_go)

    def _warming_go(self, _event=None) -> None:
        state = self._warming_state()
        planned = requests(state["at"], state["declared"], state["since"])
        if state["fetch"] is None or not (planned or state["funding"] or state["follow"] or state["reads"]):
            return self._warming_request(planned, None)
        instrument = Strategy.cache.__get__(self, type(self)).instrument(state["instrument_id"])
        if instrument is None:
            return self._warming_stop("WARMUP_INSUFFICIENT", f"{state['instrument_id']}: the venue gave no instrument")
        precisions = (instrument.price_precision, instrument.size_precision)

        def fetch():
            try:
                return state["fetch"](state["instrument_id"], state["at"], state["declared"], precisions,
                                      funding=state["funding"], follow=state["follow"], since=state["since"])
            except OSError as exc:  # a timeout while it is read again names it
                state["result"] = exc
                raise

        def work():
            try:
                state["result"] = read_until(fetch, state["at"] + DEADLINE_NS)
            except BaseException as exc:  # handed to the node's thread by _warming_wait
                state["result"] = exc

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
            return self._warming_stop("WARMUP_TIMEOUT", f"{state['instrument_id']}: Binance's history could not be read "
                                                        f"({type(found).__name__}: {found})")
        answers, state["settlements"], state["following"] = found
        return self._warming_request(requests(state["at"], state["declared"], state["since"]), answers)

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
        if (len(received) != count or not warmup.adjacent([bar.ts_event for bar in received],
                                                          state["since"].get(period, state["at"]), period, count)
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
        settled = list(state["settlements"] or [])
        stamps = [update.ts_event for update in settled]
        if state["funding"] and (len(settled) != state["funding"] or stamps != sorted(set(stamps))
                                 or stamps[-1] > state["at"]):
            return self._warming_stop("WARMUP_INSUFFICIENT", f"{Strategy.strategy_id.__get__(self, type(self))}: "
                                      f"{len(settled)} funding settlements at or before {utc(state['at'])}, not the "
                                      f"{state['funding']} declared")
        state["done"] = True
        if state["thread"]:
            self._warming_clock().cancel_timer("runner-warmup-wait")
        if state["funding"]:
            state["delivered"][warmup.FUNDING] = settled
            self._source_on_historical_funding_rates(list(settled))
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
        self._runner_breach(code, text)  # type: ignore[attr-defined]  # engine.strategy.Subscriptions or the runner's

    def subscribe_funding_rates(self, instrument_id, *args, **kwargs):
        state = self._warming_state()
        if str(instrument_id) == str(state["instrument_id"]):
            state["subscribed"] = True
        return super().subscribe_funding_rates(instrument_id, *args, **kwargs)  # type: ignore[misc]

    def _warming_begin(self) -> None:
        """Lift the order gate and run the source's on_start; Paper first passes its recovery barrier. The
        settlement of T's hour then goes to a source subscribed to its contract's funding (step 6)."""
        order_rules.WARMING.discard(str(Strategy.strategy_id.__get__(self, type(self))))
        self._source_on_start()
        state = self._warming_state()
        if state["follow"] and state["subscribed"] and state["following"]:
            self._warming_settled(state["following"][0])


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
