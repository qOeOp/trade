"""Paper's checkpoint owner. Nautilus remains the sole owner of all economic state.

Protocol 1 is deliberately limited to credential-free perpetuals, explicit strategy save/load
hooks, minute bars and the aggregations WARMUP declares, and no strategy timers. An unrepresentable cut stays dirty.

A checkpoint holds the working orders the Sandbox restores from the native cache as they were (its start loads the
cache's open orders into its matching engines; docs/plans/paper-recovery-open-orders-20261117.zh.md): accepted, not
in flight, not emulated, not contingent or linked, a LIMIT, STOP_MARKET, STOP_LIMIT, LIMIT_IF_TOUCHED or
MARKET_IF_TOUCHED triggered by the last or the mark price, or a trailing stop not yet activated that has an activation
price (`unrestorable`; user decision 2026-11-18). Any other unfinished order defers the cut: an activated trailing stop
among them, since rc7 keeps its activation outside the order's events and restores every trailing stop inactive.

A recovery warms each source again at its own T (engine.history): the declared history and the aggregations'
current buckets are read from Binance's klines, the history goes to on_historical_bars, then the source's on_load
gets its saved state and its on_start runs. A recovery that crossed a funding settlement is held instead (`hold`, user
decision 2026-11-17): the source would never see that settlement as it happened. One whose interruption may have
changed a restored working order is refused (`touched`): for each contract holding one, the warm-up's reader also
reads the one-minute klines from the journal's last bar up to T, and before any source starts every restored order
must be proven untouched by them (a GTD that expired in the interruption, by those up to its expiry and the last: it
then expires on the first live bar, as the uninterrupted run expired it unfilled). Nothing is matched or invented for
the interruption.

A recovery that crossed a bucket boundary of a declared aggregation back-fills it (`backfill`;
docs/plans/paper-recovery-open-orders-20261117.zh.md): the native aggregator is warmed from the start of the bucket
the checkpoint was cut in (`since`), the aggregation's declared history ends just before that bucket, and the
aggregated bars the request completed, which rc7 puts only into the cache, go to the source's on_bar in time order
after its on_start and before any live data; a source subscribed to another contract's declared aggregation (one of
the run's) gets that contract's back-filled bars too. An order the source submits on one must be proven untouched by
the minutes of its contract from that bar's bucket end up to T and not marketable at its contract's close of that
minute (`submitted`), or the recovery is refused as a touched one is. A cut waits while a declared aggregation's bucket has ended and its bar has not reached the source
(`due`), so the checkpoint's cut time separates the bars a source has had from those a recovery back-fills. T moves on
by a minute while it would close a crossed bucket: the native aggregator builds a request's bucket only once a later
minute arrives.

A source's metrics subscription (engine.metrics.Feed) made in its on_start is a fixed one, as its bars are: a recovery's
on_start follows the contract again from the checkpoint's cut, and the back-fill reads the rows due after the cut and
by T from REST on the node thread and hands them over with the aggregated bars, by time (a row due at a bucket's end
before that bucket's bar, as the live Feed hands it within a tick and the bar comes BUILD_DELAY_US later). An order the
source submits on one is checked as on a back-filled bar from the row's due time, against the source's warm-up
minutes; a source declaring no aggregation reads none, so its order refuses the recovery. A cut waits while a followed
row is due and not handed over (`due`), and the Feed's own timer is not a source timer.

A source without the protocol (`Session.supported` false), or one whose recovery crossed a funding settlement, is
held after an interruption, as Live holds
(docs/plans/paper-recovery-open-orders-20261117.zh.md, 保持模式): while a position is open its checkpoint holds the
native cache and the recorder's state alone (`sources` empty), and its recovery (`held`) starts no source. The
runner's holder (engine.paper.Holder) takes the source's strategy ID, reads the interruption's klines itself and,
once every restored order is proven untouched, withdraws the inherited entries; the stops and targets keep working on
live bars until the account is flat (HELD_FLAT). No funding settlement is refused there: no source would miss it, and
the seal settles it for the journal's positions.
"""

from __future__ import annotations

import base64
from contextlib import contextmanager
from dataclasses import asdict
import functools
import json
from typing import Any, cast
import time

from nautilus_trader.model import Price, Venue
from nautilus_trader.trading import Strategy

from engine import history, klines, metrics, paper_checkpoint as checkpoint, paper_terms, strategy as strategy_runtime, warmup
from engine.cadence import Cadence
from engine.config import ACCOUNT_CONTRACT, MINUTE_NS

# An order the venue has not yet answered: a checkpoint could restore neither its command nor its answer.
IN_FLIGHT = {"INITIALIZED", "SUBMITTED", "PENDING_UPDATE", "PENDING_CANCEL"}
# The triggers LAST klines show: a MARK trigger fires on the bars' LAST prices in the Sandbox, which takes no mark price
# and matches bars with bid = ask = last (docs/plans/paper-recovery-open-orders-20261117.zh.md).
TRIGGERS = ("DEFAULT", "LAST_PRICE", "MARK_PRICE")
TRAILING = ("TRAILING_STOP_MARKET", "TRAILING_STOP_LIMIT")


def _name(value) -> str | None:
    return None if value is None else getattr(value, "name", str(value))


def in_flight(order) -> bool:
    return not order.is_closed and _name(order.status) in IN_FLIGHT


def unrestorable(order) -> str | None:
    """Why an unfinished order cannot be in a checkpoint, or None. The Sandbox restores an accepted order (a triggered
    STOP_LIMIT too) into its matching engine as it was, but neither a command in flight nor the state a matching
    engine keeps outside the order's events (an emulated order, a contingent or linked one, a trailing stop's
    activation: rc7 restores every trailing stop inactive, trailing.rs "Activation is not an order event"), nor what a
    recovery cannot prove untouched (`touched`: another order type, a trigger other than the last or mark price, a
    trailing stop without an activation price, which activates at once); a partial fill was not proven by a probe.
    The cut reads `is_activated` from the native cache, where rc7's matching engine stores an activation as it
    happens."""
    if order.is_closed:
        return None
    status, kind = _name(order.status), _name(order.order_type)
    if status in IN_FLIGHT:
        return f"{order.client_order_id} is in flight ({status})"
    if getattr(order, "is_emulated", False) or _name(getattr(order, "emulation_trigger", None)) not in (None,
                                                                                                         "NO_TRIGGER"):
        return f"{order.client_order_id} is emulated"
    if (_name(getattr(order, "contingency_type", None)) not in (None, "NO_CONTINGENCY")
            or getattr(order, "parent_order_id", None) or getattr(order, "linked_order_ids", None)):
        return f"{order.client_order_id} is contingent or linked"
    if kind in TRAILING and status == "ACCEPTED" and getattr(order, "is_activated", True):
        return (f"{order.client_order_id} is an activated trailing stop, which a recovery would restore inactive "
                f"(rc7 keeps no activation in the order's events)")
    if not (status == "ACCEPTED" or status == "TRIGGERED" and kind == "STOP_LIMIT"):
        return f"{order.client_order_id} is {status}"
    # What a recovery could not prove untouched (`touched`) would only be refused there.
    if kind not in ("LIMIT", "STOP_MARKET", "STOP_LIMIT", "LIMIT_IF_TOUCHED", "MARKET_IF_TOUCHED", *TRAILING):
        return f"{order.client_order_id} is a {kind}, which a recovery cannot check"
    if kind in TRAILING and getattr(order, "activation_price", None) is None:
        return f"{order.client_order_id} is a trailing stop without an activation price, which a recovery cannot check"
    if (status == "ACCEPTED" and kind != "LIMIT"
            and _name(getattr(order, "trigger_type", None)) not in TRIGGERS):
        return f"{order.client_order_id} triggers on {_name(order.trigger_type)}, which a recovery cannot check"
    return None


def _level(order, status: str):
    """(the price that touches the order, the side whose order a high touches), or why the order cannot be checked."""
    kind = _name(order.order_type)
    if kind in ("STOP_MARKET", "LIMIT_IF_TOUCHED", "STOP_LIMIT", "MARKET_IF_TOUCHED", *TRAILING) and status == "ACCEPTED":
        trigger = _name(getattr(order, "trigger_type", None))
        if trigger not in TRIGGERS:
            return f"{order.client_order_id}: its {trigger} trigger cannot be checked on LAST klines"
        if kind in TRAILING:
            # Until it activates, nothing but its activation price changes it: a sell activates on a bid, here the
            # last price, at or above it, a buy on an ask at or below it (rc7 maybe_activate_trailing_stop). A
            # restored one is always inactive, so the cut deferred any activated one (`unrestorable`); one placed
            # without an activation price activates at once.
            activation = getattr(order, "activation_price", None)
            if getattr(order, "is_activated", True) or activation is None:
                return f"{order.client_order_id}: an activated trailing stop or one without an activation price"
            return activation.as_decimal(), "SELL"
        # The side whose order a high touches: a buy stop above the market, a sell LIMIT_IF_TOUCHED or
        # MARKET_IF_TOUCHED.
        return order.trigger_price.as_decimal(), "BUY" if kind in ("STOP_MARKET", "STOP_LIMIT") else "SELL"
    if kind == "LIMIT" and status == "ACCEPTED" or kind == "STOP_LIMIT" and status == "TRIGGERED":
        return order.price.as_decimal(), "SELL"
    return f"{order.client_order_id}: a {status} {kind} order cannot be checked for the interruption"


def expiring(bars: list, expiry: int) -> list:
    """The minutes that prove a GTD order expiring at `expiry`, in the interruption, would have expired unfilled and
    will: the uninterrupted run matched each minute that opened before the expiry (a minute's `ts_event` is its close
    less a millisecond; that covers the minute closing at or after it, which arrives after it and is matched before the
    order expires, and one more when an arrival lags), and the recovery matches it once more, on the first live bar's
    open, before the Sandbox expires it, so the last minute, closing at T, must not reach it either. Refuses more,
    never less."""
    return [bar for index, bar in enumerate(bars)
            if bar.ts_event + warmup.MILLISECOND_NS - MINUTE_NS < expiry or index == len(bars) - 1]


def touched(orders, downtime: dict[str, list], last_bar: dict[str, int], at: int,
            status: str | None = None) -> str | None:
    """Why the interruption may have changed one of the restored working `orders`, or None when every one is proven
    untouched. `downtime` holds each contract's one-minute bars from the minute after its journal's last bar (closing
    at `last_bar`) up to the one closing at T (`at`). A stop (STOP_MARKET, an untriggered STOP_LIMIT) is touched by a
    high at or above its buy trigger or a low at or below its sell trigger, a limit (LIMIT, a triggered STOP_LIMIT) by
    a low at or below its buy price or a high at or above its sell price, a LIMIT_IF_TOUCHED or MARKET_IF_TOUCHED by a
    low at or below its buy trigger or a high at or above its sell trigger, a trailing stop not yet activated by a low
    at or below its buy activation price or a high at or above its sell one. A MARK trigger is checked on the same
    LAST klines: the Sandbox fires it on the bars' last prices. Touching, not the fill model's crossing, so it refuses
    more, never less. Any other order type, state or trigger type (LAST klines cannot show a BID_ASK trigger) and any
    minute missing fail: only an order proven untouched passes. `status` checks every order as one in that status (an
    order a back-filled bar is submitting, `Session.submitted`); such an order's GTD expiring by T fails.

    A restored GTD order that expired in the interruption needs only the minutes up to its expiry and the last one
    (`expiring`): rc7's matching engine matches a bar before it expires the orders it holds (`iterate_with_mode`, then
    `post_match_order_action`), so the uninterrupted run expired it unfilled and the Sandbox expires it at the first
    live bar (docs/plans/paper-recovery-open-orders-20261117.zh.md)."""
    for order in orders:
        if order.is_closed and status is None:
            continue
        name, iid, side = order.client_order_id, str(order.instrument_id), _name(order.side)
        expiry = getattr(order, "expire_time", None)
        expired = _name(order.time_in_force) == "GTD" and (expiry is None or expiry <= at)
        if expired and (expiry is None or status is not None):
            return f"{name}: its GTD expiry {history.utc(expiry or 0)} is at or before {history.utc(at)}"
        found = _level(order, status or str(_name(order.status)))
        if isinstance(found, str):
            return found
        level, by_high = found
        kind = _name(order.order_type)
        bars, last = downtime.get(iid), last_bar.get(iid)
        if bars is None or last is None or [bar.ts_event for bar in bars] != list(
                range(last + MINUTE_NS, at, MINUTE_NS)):
            return f"{name}: the {iid} minutes of the interruption up to {history.utc(at)} could not all be read"
        for bar in (expiring(bars, expiry) if expired and expiry is not None else bars):
            if bar.high.as_decimal() >= level if side == by_high else bar.low.as_decimal() <= level:
                return (f"{name} ({side} {kind} at {level}) was touched in the interruption by the {iid} minute "
                        f"closing at {history.utc(bar.ts_event + warmup.MILLISECOND_NS)}")
    return None


def declares_recovery(strategy_class: type) -> bool:
    """Whether the loaded entry class declares Paper recovery: PAPER_RECOVERY == 1 as Python resolves it, and on_save
    and on_load defined by a class of its MRO above Strategy. The runner's own verdict (the source has to run to tell
    it); journalled on the run's `started` line as `recovery_declared` (engine.paper), which the page and paper
    compare read."""
    source_bases = strategy_class.__mro__[:strategy_class.__mro__.index(Strategy)]
    hooks = {name for base in source_bases for name, value in vars(base).items() if callable(value)}
    return getattr(strategy_class, "PAPER_RECOVERY", None) == 1 and {"on_save", "on_load"} <= hooks


class Session:
    def __init__(self, backend, journal, loaded, saved: dict | None, started_ns: int, input_start_ns: int,
                 warm_at: int, release=None):
        self.backend, self.journal, self.loaded, self.saved = backend, journal, loaded, saved
        self.started_ns, self.input_start_ns = started_ns, input_start_ns
        self.release = release  # engine.paper.release_before: runs the held data callbacks (backfill)
        self.depth = 0
        # Whether the source declares the protocol, and whether this process restores it with it: a recovery that
        # crossed a funding settlement holds the run instead (`hold`).
        self.declared = declares_recovery(loaded.strategy_class)
        self.supported = self.declared
        self.fallen: str | None = None  # why a recovery of a source with the protocol is held (`hold`)
        # Whether the pause of a source without the protocol keeps its orders: a position was open when the stop was
        # requested (engine.paper.pausing; latched there, since the pause itself may close it).
        self.holding = False
        self.ready = False
        self.recorder: Any = None
        self.cache: Any = None
        self.starts: list = []
        self.expected_starts = 0
        self.error: str | None = None
        self.pause_error: str | None = None
        self.refused: str | None = None  # why the recovery was refused before it was ready (touched, backfill)
        self.downtime: dict[str, list] = {}  # contract: the one-minute klines of the interruption (read_downtime)
        self.working: set[str] = set()  # the contracts of the restored unfinished orders (engine.paper.build_node)
        self.stopped_ns: int | None = None  # when a pause stopped the node (before_stop)
        # (what is handed, the instant the order would have worked from, the receiver's minutes up to T, its contract)
        self.handing: tuple | None = None
        if self.missed_settlement():
            # The source would never see that settlement as it happened: the run is held instead of ended.
            self.hold("the recovery crossed an unobserved funding settlement")
        # A recovery's T, and the start of the bucket the checkpoint was cut in of each aggregation it back-fills.
        self.warm_at, self.since = self.crossed(warm_at)
        # The sources start once warmed: T, its settling and its deadline (engine.history), and some slack.
        self.restore_deadline = (time.monotonic() + max(0, self.warm_at - time.time_ns()) / history.SECOND_NS
                                 + (history.DEADLINE_NS + history.SETTLE_NS) / history.SECOND_NS)
        self.last_bar: dict[str, int] = {}
        if saved:
            with (backend.output / "events.jsonl").open("rb") as stream:
                for raw in stream:
                    value = json.loads(raw)
                    if value["kind"] == "bar":
                        self.last_bar[value["instrument_id"]] = value["ts_event"]

    @property
    def held(self) -> bool:
        """A recovery that restores no source, only the runner's holders: of a source without the protocol, or of one
        with it that fell back (`hold`)."""
        return bool(self.saved) and not self.supported

    def hold(self, reason: str) -> None:
        """Hold this recovery of a source with the protocol, as one without it is held: a recovery that crossed a
        funding settlement (user decision 2026-11-17), and every later recovery of the run, whose held checkpoint has
        the account and no source state (engine.paper.build_node). From here the run is a held one: `supported` is
        false for the cut, the pause and the end."""
        self.supported, self.fallen = False, reason

    @property
    def aggregated(self) -> list[str]:
        """The aggregations the source's WARMUP declares (engine.warmup)."""
        return [period for period, _ in self.loaded.warmup if period != "1-MINUTE"]

    def crossed(self, at: int) -> tuple[int, dict[str, int]]:
        """T and, for each declared aggregation whose bucket holding the checkpoint's cut has ended by T, that bucket's
        start (engine.history.requests). A waiting checkpoint has started no aggregator. T moves on by a minute while it
        is the end of a crossed bucket: a request builds a bucket only once a minute after it arrives (rc7's time-bar
        aggregator closes a request's bucket on its own clock, which only the request's later bars move), and after the
        request the live aggregator would put that bucket's minutes into the next bucket's bar."""
        if not self.saved or not self.saved.get("sources") or self.held:
            return at, {}
        while True:
            since = {period: warmup.bucket_start(self.saved["cut_ns"], period) for period in self.aggregated}
            since = {period: start for period, start in since.items() if start + warmup.period_ns(period) <= at}
            if not any(at % warmup.period_ns(period) == 0 for period in since):
                return at, since
            at += MINUTE_NS

    def missed_settlement(self) -> bool:
        """Whether a funding settlement the checkpoint's source or recorder was following is due by now. A waiting
        checkpoint has started no settlement cadence, and a held recovery has no source to miss it (the seal settles
        it for the journal's positions)."""
        if self.held or not self.saved or not self.saved.get("sources"):
            return False
        following = list((self.saved.get("recorder") or {}).get("funding", {}).values())
        following.extend(cadence["next_funding_ns"] for value in self.saved["sources"].values()
                         for cadence in value["cadence"].values())
        return any(value is not None and time.time_ns() >= value for value in following)

    @contextmanager
    def callback(self):
        try:
            checkpoint.dirty(self.backend.output)
        except OSError as exc:
            # A refused marker must not skip the callback: the source still gets the event, and the run stops
            # (engine.paper.Journal.fail, finding 20261114-43).
            self.journal.fail(exc)
        self.depth += 1
        try:
            yield
        finally:
            self.depth -= 1

    def start(self, callback) -> None:
        self.starts.append(callback)
        self.maybe_begin()

    def read_downtime(self, instrument_id, at: int, precisions: tuple[int, int], proxy_url: str | None,
                      get=klines.get_json) -> None:
        """On the warm-up's reader thread at T: the contract's one-minute klines from the minute after the journal's
        last bar up to the one closing at T, for `touched`. A contract without a journalled bar reads none, so an order
        of it fails the check."""
        last = self.last_bar.get(str(instrument_id))
        if last is not None:
            self.downtime[str(instrument_id)] = klines.bars(instrument_id, "1-MINUTE", last + warmup.MILLISECOND_NS,
                                                            at - warmup.MILLISECOND_NS, precisions, proxy_url, get)

    def maybe_begin(self) -> None:
        if not self.ready and not self.refused and len(self.starts) == self.expected_starts:
            if self.missed_settlement():  # one due since the process started: the node already runs the source
                raise checkpoint.fail("recovery crossed an unobserved funding settlement; the original point is "
                                      "retained")
            account = self.cache.account_for_venue(Venue(ACCOUNT_CONTRACT["venue"]))
            if account is None or account.to_dict().get("calculate_account_state") is not True:
                raise checkpoint.fail("native account initialization did not restore Sandbox calculation mode")
            if self.saved:
                # No source starts; the runner's stop timer journals the refusal and stops the run without cancelling
                # the restored orders (engine.paper.pausing).
                self.refused = touched(self.cache.orders(), self.downtime, self.last_bar, self.warm_at)
                if self.refused:
                    return
            for callback in self.starts:
                callback()
            # Until the back-filled bars are handed over and their orders checked, the recovery is not ready: a refusal
            # stops it as a pause, without cancelling (engine.paper.pausing), and publishes no checkpoint.
            self.refused = self.refused or self.backfill()
            if self.refused:
                return
            self.ready = True

    def metrics_after(self) -> int | None:
        """Where a metrics subscription made now starts (engine.metrics.Feed): in a recovery's on_start, after the
        checkpoint's cut, whose later rows the back-fill hands over; otherwise None, after now."""
        if self.saved and self.saved.get("sources") and not self.held and not self.ready and self.handing is None:
            return self.saved["cut_ns"]
        return None

    def backfill(self) -> str | None:
        """Hand each source the aggregated bars its recovery's warm-up completed (`since`) and the metrics rows due
        after the checkpoint's cut and by T of each contract it follows, in time order, through the held data
        callbacks live data takes (engine.paper._hold), each released at once: nothing it does reaches the Sandbox
        before the next, and no live data is dispatched before all have run. rc7 delivers a request's bars only through
        the cache, under the bar's standard type, which is the type a live aggregated bar has. The bars must be those of
        every bucket ending after the checkpoint's cut and by T, and every row must be read, or the recovery is
        refused before anything is handed over."""
        if not self.saved or not self.saved.get("sources") or self.held:
            return None
        assert self.release is not None
        contracts = list(strategy_runtime.STRATEGIES)
        handed: list[tuple] = []
        if self.since:
            built: dict[tuple[str, str], list] = {}
            for iid in contracts:  # each instance warmed its own contract's aggregations
                for period, first in self.since.items():
                    step = warmup.period_ns(period)
                    cached = self.cache.bars(warmup.aggregated_type(iid, period).standard()) or []
                    found = sorted((bar for bar in cached
                                    if self.saved["cut_ns"] < self.bucket_end(bar) <= self.warm_at),
                                   key=lambda bar: bar.ts_event)
                    ends = list(range(first + step, self.warm_at + 1, step))
                    if [self.bucket_end(bar) for bar in found] != ends:
                        return (f"the native aggregator built {len(found)} of the {len(ends)} {iid} {period} bars "
                                f"ending from {history.utc(ends[0])} to {history.utc(ends[-1])}")
                    built[(iid, period)] = found
            # By time, then each contract's bar in the run's order of contracts, each to its subscribers in that
            # order. A fixed order: the live node has none for bars ending at the same instant (rc7 fires each
            # aggregator's timer as its own task and breaks subscriber ties by a random handler id; 2026-11-18 native
            # probe).
            for index, (iid, strategy) in enumerate(strategy_runtime.STRATEGIES.items()):
                minutes = cast(Any, strategy)._warming_state()["expected"]
                subscribed = cast(Any, strategy)._paper_subscriptions
                for order, other in enumerate(contracts):
                    for period in self.since:
                        if other == iid or self.subscription(other, period) in subscribed:
                            handed += [(bar.ts_event, order, index, functools.partial(strategy.on_bar, bar), (
                                f"back-filled {period} bar of the bucket ending at "
                                f"{history.utc(self.bucket_end(bar))}", self.bucket_end(bar),
                                minutes.get(("warm", period)) or [], iid)) for bar in built[(other, period)]]
        # A row is due at a bucket's end, before that bucket's bar (stamped BUILD_DELAY_US after it). An order on it is
        # checked against the receiver's longest warm-up minutes, which all end at T.
        for index, (iid, strategy) in enumerate(strategy_runtime.STRATEGIES.items()):
            source = cast(Any, strategy)
            expected = source._warming_state()["expected"]
            minutes = max((expected.get(("warm", period)) or [] for period in self.aggregated), key=len, default=[])
            for state in source._metrics_owed(self.warm_at):
                other = state["instrument_id"]
                for ts_event in range(state["ts_event"], self.warm_at - metrics.VISIBLE_NS + 1, metrics.PERIOD_NS):
                    try:
                        row = source._metrics_read(other, ts_event, list(metrics.ENDPOINTS))
                    except Exception as exc:  # the network or an answer REST changed
                        return (f"the {other} metrics row stamped {history.utc(ts_event)} could not be read "
                                f"({type(exc).__name__}: {exc})")
                    due = ts_event + metrics.VISIBLE_NS
                    order = contracts.index(other) if other in contracts else len(contracts)
                    handed.append((due, order, index, functools.partial(self.hand_row, source, state, ts_event, row), (
                        f"back-filled {other} metrics row due at {history.utc(due)}", due, minutes, iid)))
        for *_, deliver, handing in sorted(handed, key=lambda item: item[:3]):
            self.handing = handing
            try:
                deliver()
                self.release(None)
            finally:
                self.handing = None
            if self.refused:
                return self.refused
        return None

    @staticmethod
    def hand_row(source, state: dict, ts_event: int, found: dict) -> None:
        """A back-filled metrics row, through the Feed's own hand-over (engine.metrics.Feed), unless the source
        unfollowed its contract on an earlier back-filled bar or row."""
        if source._metrics_followed.get(state["instrument_id"]) is state and state["ts_event"] == ts_event:
            state["found"] = dict(found)
            source._metrics_hand(state)

    @staticmethod
    def subscription(iid: str, period: str) -> str:
        """The bar type a source subscribes to for a declared aggregation of a contract."""
        return f"{iid}-{period}-LAST-INTERNAL@1-MINUTE-EXTERNAL"

    def subscriptions(self, iid: str) -> tuple[set[str], set[str]]:
        """(required, allowed) subscriptions of the instance of `iid` at a cut: its own minute bars and declared
        aggregations, and also the declared aggregations of the run's other contracts (user decision 2026-11-17):
        each other instance warms and back-fills its own, and the back-fill hands them to every subscriber."""
        own = {f"{iid}-1-MINUTE-LAST-EXTERNAL"} | {self.subscription(iid, period) for period in self.aggregated}
        return own, own | {self.subscription(other, period) for other in strategy_runtime.STRATEGIES
                           for period in self.aggregated}

    @staticmethod
    def bucket_end(bar) -> int:
        """The end of an aggregated bar's bucket: rc7 stamps it BUILD_DELAY_US after it (engine.history)."""
        return bar.ts_event - history.BUILD_DELAY_US * 1000

    def submitted(self, order) -> str | None:
        """Why an order the source submits on a back-filled bar refuses the recovery, or None. In the uninterrupted run
        it would have worked from that bar's close; here it works from T. Only one the minutes of its contract from
        the bar's bucket end up to T prove untouched (`touched`, as an accepted order) and the close of its contract's
        minute ending the bucket (the bar's own close when the bar is of its contract) does not make marketable (it
        would have matched at once on that L1; a MARKET always) passes: then its first match is the one the
        uninterrupted run made. A MARKET_IF_TOUCHED or a MARK trigger is checked as a LIMIT_IF_TOUCHED or a stop is
        (user decision 2026-11-18); a trailing stop not yet activated by its activation price: in the uninterrupted
        run a close at or above a sell's (at or below a buy's) would have activated it at once, as a minute after it
        would, and then it trails from there. An activated one, or one without an activation price, fails. Once the
        recovery is refused, nothing more is sent (`commanded`). A back-filled metrics row is checked as a bar whose
        bucket ended at the row's due time."""
        if self.refused or self.handing is None:
            return self.refused
        what, end, minutes, own = self.handing
        if order is None or _name(order.order_type) == "MARKET":
            found: str | None = "a position close is a MARKET order" if order is None else (
                f"{order.client_order_id} is a MARKET order")
        elif str(order.instrument_id) != own:
            found = f"{order.client_order_id} is on {order.instrument_id}, whose minutes the {own} source did not read"
        else:
            iid = str(order.instrument_id)
            found = touched([order], {iid: [minute for minute in minutes if minute.ts_event > end]},
                            {iid: end - warmup.MILLISECOND_NS}, self.warm_at, status="ACCEPTED")
        if found is None:
            level, by_high = cast(tuple, _level(order, "ACCEPTED"))
            ending = next((minute for minute in minutes if minute.ts_event == end - warmup.MILLISECOND_NS), None)
            close = None if ending is None else ending.close.as_decimal()
            if close is None:
                found = f"{order.client_order_id}: its contract's minute closing at {history.utc(end)} was not read"
            elif close >= level if _name(order.side) == by_high else close <= level:
                found = (f"{order.client_order_id} ({_name(order.side)} {_name(order.order_type)} at {level}) is "
                         f"marketable at the close {close}")
        if found:
            self.refused = self.refused or f"an order submitted on the {what} cannot wait for T: {found}"
        return found

    def commanded(self, close: bool = False) -> str | None:
        """Why a cancel, or a position close (`close`), the source sends is not sent, or None: nothing is once the
        recovery is refused, and a close on a back-filled bar is a MARKET order (`submitted`)."""
        if close:
            return self.submitted(None)
        return self.refused

    def exiting(self) -> str | None:
        """Why a market exit the source begins is not begun, or None: as a close (`commanded`), and one before the
        back-fill has ended refuses the recovery. rc7 closes again every 100 ms while a position is open, past the
        source's overrides, and Python cannot end a running exit: timer events already queued outlive a cancelled
        timer. So it would go on sending if the back-fill then refused the recovery."""
        if self.commanded(close=True) is None and self.saved and not self.ready and (self.since or any(
                cast(Any, source)._metrics_owed(self.warm_at) for source in strategy_runtime.STRATEGIES.values())):
            self.refused = "a market exit begun before the back-fill ended would go on closing after a refusal"
        return self.refused

    def due(self, cache, now: int) -> str | None:
        """Why a cut at `now` could not tell whether a declared aggregation's latest bar reached the source, or None:
        a bucket ended after T and its bar is not in the native cache yet (rc7 builds it BUILD_DELAY_US after the
        end, caches it and dispatches it in one step; a held callback then defers the cut until it ran). A source
        without the protocol is never back-filled (a held recovery starts none), so nothing is due for it. Likewise a
        followed metrics row due by `now` that the Feed has not handed over yet: a recovery follows from the cut."""
        if not self.supported:
            return None
        for iid, strategy in strategy_runtime.STRATEGIES.items():
            for state in cast(Any, strategy)._metrics_owed(now):
                return (f"the {state['instrument_id']} metrics row due at "
                        f"{history.utc(state['ts_event'] + metrics.VISIBLE_NS)} has not reached the {iid} source")
        for iid in strategy_runtime.STRATEGIES:
            for period in self.aggregated:
                end = warmup.bucket_start(now, period)
                if end <= self.warm_at:
                    continue
                latest = cache.bar(warmup.aggregated_type(iid, period).standard())
                if latest is None or latest.ts_event < end:
                    return f"the {iid} {period} bar of the bucket ending at {history.utc(end)} has not reached the source"
        return None

    def try_cut(self, cache) -> None:
        if not (self.backend.root / "dirty").exists() or not self.ready:
            return
        try:
            self.cut(cache)
        except Exception as exc:
            # Whatever the native cache raises (a dead child gives RuntimeError: broken pipe) is a deferred cut. An
            # exception out of the timer callback that calls this stops rc7's dispatch for good: the journal and the
            # checkpoint stopped, STOP was ignored and `paper stop` ended in SIGKILL (2026-11-15, finding 20261114-34).
            # Only its text leaves this block. The exception's traceback holds this frame and so `cache`, rc7's
            # thread-bound PyCache: kept in a local, it made a cycle that a garbage collection on the native cache's
            # I/O thread freed, where rc7 refuses the drop ("PyCache is unsendable, but is being dropped on another
            # thread", one per deferred cut; finding 20261115-03).
            found = str(exc if isinstance(exc, checkpoint.Refusal) else checkpoint.fail(
                f"the native checkpoint failed: {type(exc).__name__}: {exc}"))
        else:
            self.error = None
            return
        if found != self.error:
            print(f"Paper checkpoint deferred: {found}", flush=True)
            self.error = found

    def restore_source(self, strategy, iid: str) -> None:
        saved = (self.saved or {}).get("sources", {}).get(iid)
        if not saved:
            return
        strategy.load({key: base64.b64decode(value, validate=True) for key, value in saved["state"].items()})
        strategy._paper_cadence = {key: Cadence(**value) for key, value in saved["cadence"].items()}

    def restore_recorder(self, recorder) -> None:
        self.recorder = recorder
        saved = (self.saved or {}).get("recorder")
        if not saved:
            return
        recorder.minute = saved["minute"]
        recorder.marks = {iid: (value[0], Price.from_str(value[1])) for iid, value in saved["marks"].items()}
        found = saved.get("protection") or {}
        recorder.gaps.since, recorder.gaps.reported = dict(found.get("since", {})), set(found.get("reported", []))
        if self.held:
            # A held run's stops are all it has (the holder places none): a gap still open is journalled again after
            # its `resumed`, which the Paper page and the release's notice read as an unprotected position.
            recorder.gaps.reported = set()
        for iid, following in saved["funding"].items():
            recorder.cadence[iid] = Cadence(next_funding_ns=following)
        recorder.last_bar = dict(self.last_bar)

    def cut(self, cache=None) -> dict:
        if self.pause_error:
            raise checkpoint.fail(self.pause_error)
        if self.depth or strategy_runtime.FAILURES:
            raise checkpoint.fail("callbacks are active or failed; no consistent checkpoint is available")
        # A paused node dispatches nothing after its stop: the final cut is that instant's, so a bucket ending while
        # the node shuts down is not one whose bar the source should have had (`due`).
        cut_ns = self.stopped_ns or time.time_ns()
        sources: dict[str, dict] = {}
        if cache is not None and not self.supported:
            # A held checkpoint: the native cache and the recorder, no source state. Only an open position is held.
            if not self.ready:
                raise checkpoint.fail("the run has not started")
            if not cache.positions_open():
                raise checkpoint.fail("no position is open; a source without the recovery protocol is held only "
                                      "while one is")
            self._restorable(cache)
            if paper_terms.QUEUE or any(getattr(source, "_paper_held", None)
                                        for source in strategy_runtime.STRATEGIES.values()):
                raise checkpoint.fail("a strategy callback or an entry's terms read remains pending")
        elif cache is not None:
            if not self.ready:
                raise checkpoint.fail("the source has not completed its recovery protocol")
            if paper_terms.QUEUE:
                raise checkpoint.fail("an entry waits for its terms read")
            for iid in strategy_runtime.STRATEGIES:
                for period in self.aggregated:
                    latest = cache.bar(warmup.aggregated_type(iid, period).standard())
                    if latest is not None:  # a bar dispatched while the node shut down is one the source has had
                        cut_ns = max(cut_ns, self.bucket_end(latest))
            # At the cut itself: a recovery hands over what is due after it, so what is due by it must have come.
            found = self.due(cache, cut_ns)
            if found:
                raise checkpoint.fail(f"{found}; a recovery could not tell whether to hand it over")
            self._restorable(cache)
            for iid, native in strategy_runtime.STRATEGIES.items():
                strategy = cast(Any, native)
                required, allowed = self.subscriptions(iid)
                if strategy._paper_subscription_changes or not required <= strategy._paper_subscriptions <= allowed:
                    raise checkpoint.fail("recovery requires fixed subscriptions to the minute bars and every declared "
                                          "aggregation (also of the run's other contracts), without custom routing")
                if strategy._paper_user_timers:
                    raise checkpoint.fail("the source registered timers outside the recovery protocol")
                if strategy._paper_held or set(strategy.clock.timer_names()) - {metrics.TIMER}:
                    raise checkpoint.fail("a strategy callback or timer remains pending")
                source_state = strategy.save()
                if not all(isinstance(key, str) and isinstance(value, bytes) for key, value in source_state.items()):
                    raise checkpoint.fail("strategy save hooks must return string-to-bytes state")
                sources[iid] = {"state": {key: base64.b64encode(value).decode() for key, value in source_state.items()},
                                "cadence": {key: asdict(value) for key, value in strategy._paper_cadence.items()}}
            self._restorable(cache)
            if (self.depth or strategy_runtime.FAILURES
                    or any(cast(Any, source)._paper_held or set(source.clock.timer_names()) - {metrics.TIMER}
                           or cast(Any, source)._paper_user_timers
                           for source in strategy_runtime.STRATEGIES.values())):
                raise checkpoint.fail("saving hooks failed or left a callback or timer pending")
        recorder = self.recorder
        value = {"started_ns": self.started_ns, "input_start_ns": self.input_start_ns,
                 "cut_ns": cut_ns, "sources": sources,
                 "recorder": None if recorder is None else {
                     "minute": recorder.minute,
                     "marks": {iid: [ts, str(price)] for iid, (ts, price) in recorder.marks.items()},
                     "funding": {iid: item.next_funding_ns for iid, item in recorder.cadence.items()},
                     "protection": {"since": recorder.gaps.since, "reported": sorted(recorder.gaps.reported)},
                 }}
        self.journal.sync()
        return self.backend.snapshot(cache, value)

    @staticmethod
    def _restorable(cache) -> None:
        found = next(filter(None, map(unrestorable, cache.orders())), None)
        if found:
            raise checkpoint.fail(f"an order cannot be restored from the checkpoint: {found}")

    def before_stop(self, cache) -> None:
        self.stopped_ns = time.time_ns()
        # Native component stop cancels clocks. Checking only after node.run returned
        # would hide a user timer which existed when the pause was requested.
        found = next(filter(None, map(unrestorable, cache.orders())), None)
        if found:
            self.pause_error = f"the pause had an order that cannot be restored ({found}); its original state is retained"
        if paper_terms.QUEUE:  # the source sent it, the venue never had it: no checkpoint can hold it
            self.pause_error = "the pause had an entry waiting for its terms read; its original state is retained"
        # A held checkpoint restores no source, so a source's timers are not lost by it. The Feed's own hands no row
        # after this instant, the final cut's (engine.metrics.Feed): a recovery follows from it again.
        for source in strategy_runtime.STRATEGIES.values() if self.supported else ():
            if metrics.TIMER in source.clock.timer_names():
                source.clock.cancel_timer(metrics.TIMER)
        if self.supported and any(source.clock.timer_names() for source in strategy_runtime.STRATEGIES.values()):
            self.pause_error = "the pause had a source timer; no timer state was checkpointed"
