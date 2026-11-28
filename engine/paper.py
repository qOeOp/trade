"""Paper trading: run one complete strategy on live Binance public market data with Nautilus's simulated fills.

The user authorized this on 2026-10-25 for public market data only, with no credential of any kind and only
the Sandbox execution client (docs/plans/paper-trading-design.zh.md). Nothing here can reach an account:

- the node gets one data client (Binance USD-M public data, no key) and one simulated execution client;
- the runner refuses to start while any exchange credential variable is in its environment
  (PAPER_CREDENTIALS_PRESENT), and refuses the run once the account it trades is not the Sandbox's
  (PAPER_EXEC_CLIENT_NOT_SANDBOX).

The strategy is the replay's: the same source file, entry class and hash, constructed with the same inputs
(``engine.strategy`` owns the common construction and callback boundaries). The account is ``ACCOUNT_CONTRACT``'s,
in the execution environment ``paper-bars``. The live feed differs from the replay's input in ways the runner
corrects where it can:

- MARK updates arrive every second; the strategy gets the first of each minute, as the replay gives one per
  minute.
- Funding estimates arrive every second; the strategy gets one update per settlement, stamped at the
  settlement's hour (the replay's is stamped at Binance's settlement time, up to some milliseconds later). The
  settlement of a T on a settlement hour is read from Binance's funding-rate history and given after on_start when
  Binance stamped it after T, as the replay streams it (engine.history).
- An instance starts at T, the first whole minute at least half a minute after the runner starts (engine.history):
  its declared WARMUP history and the minutes that warm its aggregations are read from Binance's public klines into
  a temporary Catalog and served as a replay serves them, so its first aggregated bars are complete.
- No trades are streamed (orders match bars, so a mid-bar trade signal would see the bar's end); a strategy
  subscribing to trades stops the run with ``TRADES_NOT_SERVED``. Metrics of the run's contracts are read from
  Binance's public REST at a replay's stamps and values (engine.metrics).
- The Sandbox matches a bar before the strategy sees it, as a replay's exchange does, but its fills reach the
  cache on the live runner's execution channel, after the bar's dispatch. The strategy's data callbacks
  therefore wait, in the order they came, until the next data event is dispatched: rc7's live runner dispatches
  data only once every queued time event, execution event and execution command is processed (its biased
  select), so the fills the held data caused, and the orders and fills those caused, are then applied. A stop or
  target filled on a bar is closed when the strategy's ``on_bar`` for it runs, as in the replay. A metrics row,
  which the Feed hands over on a timer (rc7 takes time events before execution events), joins the held callbacks
  and releases none. A fill stamped before a dispatch whose callbacks already ran is journaled as ``release_late``
  (PAPER_RELEASE_LATE).

The Sandbox matches with the replay's terms: its fill model, book type and bar ordering, and the maker and
taker rates the run is given (``--maker-fee``, ``--taker-fee``: the market's assumed rates, which a replay
reads from its export receipts).

Its own record is ``<output>/events.jsonl``: the market rows Live's evidence pack holds too (engine.realtime.MarketRows:
one-minute bars, late aggregated bars, the warm-up digests, Binance's time for each closed one-minute kline and its
side connection's state, the metrics rows), data gaps, socket state, orders, positions, funding
settlements, the account totals once a minute (at the next minute's first mark, its open positions valued at the
minute's last mark, as a replay values a minute at its MARK bar's close), and protection gaps. ``<output>/state.json`` holds the latest
totals with the open positions and orders, ``<output>/runtime_failures.jsonl`` is rewritten within a second of
each runtime failure, and ``<output>/summary.json`` and ``<output>/reports/`` (the native cache's reports and order
events as a replay writes them, which the sealing step audits) are written at the end. Sandbox
settles no funding (it takes no funding or MARK data), so the journal records each settlement the stream announced,
and the sealing step settles each one Binance published, at its rate and the MARK a replay settles at, for the
positions the journal held then (ledger.run_journal.settlements).

Explicit STOP/duration cancels working orders and stops the node. For a recovery-capable source, SIGTERM/
SIGINT instead pauses without calling the source terminal stop hook and without cancelling: it waits for the orders
in flight to be answered, then publishes a checkpoint holding the working orders. Only restorable orders
(engine.paper_session.unrestorable), no timer and completed callbacks can publish a native checkpoint. A dirty or
incomplete point refuses recovery and retains its original journal; no new account is substituted. A recovery refused
before it is ready (one whose interruption may have touched a restored order, engine.paper_session.touched, or whose
back-filled aggregated bars led the source to an order the interruption may have touched,
engine.paper_session.Session.submitted) journals a ``refusal`` and stops as a pause does, leaving the restored orders
as they were; it is then sealed. A recovery that crossed a bucket boundary of a declared aggregation hands the source
the aggregated bars it missed, built by the native aggregator from Binance's minutes, after its on_start and before
any live data (engine.paper_session.Session.backfill).

A source without the protocol is held, as Live holds (docs/plans/paper-recovery-open-orders-20261117.zh.md): SIGTERM/
SIGINT while a position is open pauses it the same way and publishes a checkpoint of the native cache alone (a flat
one cancels and ends as before), and its recovery starts no source but a ``Holder`` per contract under the source's
strategy ID. The holder checks the interruption as a recovery does, withdraws the entries it inherits and leaves the
stops and targets to the Sandbox on live bars; once no position is open it cancels the rest and the run stops with
``HELD_FLAT``. STOP and the duration end a held run as any; another SIGTERM pauses it again.
"""

from __future__ import annotations

if __name__ == "__main__":  # before third-party imports: native workers inherit the mask, allocations base pages
    from engine import pages, signals
    signals.block()
    pages.base_pages_only()

import argparse
from contextlib import nullcontext, suppress
import functools
import importlib.metadata
import itertools
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any, cast
from collections.abc import Callable

from nautilus_trader.adapters.sandbox import SandboxExecutionClientConfig, SandboxExecutionClientFactory
from nautilus_trader.common import CacheConfig, DataActor, Environment
from nautilus_trader.execution import MakerTakerFeeModel
from nautilus_trader.live import LiveRiskEngineConfig
from nautilus_trader.model import (
    AccountType, BarType, BookType, Currency, InstrumentId, Money, OmsType, Price, StrategyId, Venue,
)
from nautilus_trader.trading import Strategy

from engine import history, metrics, paper_terms, strategy as strategy_runtime
from engine.kline_events import KlineEvents
from engine import paper_checkpoint as checkpoint, protection
from engine.order_rules import OrderRules, denied_exiting
from engine.fill import fill_model
from engine.paper_redis import CacheUnavailable, NativeCache
from engine.paper_session import Session, declares_recovery, in_flight, unrestorable
from engine.signals import Signals
from engine.cadence import Cadence
from engine.realtime import MarketRows, node_base
from engine.config import (ACCOUNT_CONTRACT, EXECUTION_BAR_MINUTES, atomic, MINUTE_NS, Refusal, instrument_id, leverage_of,
                           runtime_source_metadata, utc_text)
from engine.load import (
    LoadedStrategy, diagnostics, load_strategy, read_universe, strategy_id, strategy_metadata,
)
from engine import membership as membership_months

EXECUTION = "paper-bars"
VENUE = ACCOUNT_CONTRACT["venue"]
STOP_CANCEL_SECONDS = 10
# The runner's exit status after its journal failed (ledger.run_journal.JOURNAL_FAILED_EXIT reads it: with a full disk the
# summary is as likely missing as the journal's last lines, and the exit status is what the seal still has).
JOURNAL_FAILED_EXIT = 3
JOURNAL_WRITE_FAILED = "PAPER_JOURNAL_WRITE_FAILED"
# The order in which data callbacks were held, across strategies (release_before).
SEQUENCE = itertools.count()
# Names of variables that may hold an exchange credential. Matching is on names only: values are never read.
CREDENTIAL_NAME = re.compile(
    r"^(BINANCE|BNB|OKX|OKEX|BYBIT|BITMEX|BITGET|COINBASE|KRAKEN|DERIBIT|HYPERLIQUID|DYDX|GATE|KUCOIN|MEXC|HTX|"
    r"HUOBI|POLYMARKET|LIGHTER|ARCHITECT)_|(API_KEY|API_SECRET|SECRET_KEY|PASSPHRASE|PRIVATE_KEY)", re.IGNORECASE)


def credential_names(environ) -> list[str]:
    """engine.paper.credential_names: the environment variable names that may hold an exchange credential."""
    return sorted(name for name in environ if CREDENTIAL_NAME.search(name))


# The journal

class Journal:
    """events.jsonl (appended and flushed line by line) and state.json (replaced whole).

    The first write the disk refuses (a full disk: Errno 28) latches `failure` and stops the run
    (``on_failure``, finding 20261114-43): a journal with a gap is not a record, so nothing is written after it, and
    nothing raises into a callback, so the source still receives the event the write belonged to."""

    def __init__(self, output: Path, on_failure=None):
        output.mkdir(parents=True, exist_ok=True)
        self.output = output
        self._stream = (output / "events.jsonl").open("a", encoding="utf-8", buffering=1)
        self._lock = threading.Lock()
        self._on_failure = on_failure
        self.failure: str | None = None

    def fail(self, exc: OSError) -> None:
        """Latch the first failed write; the runner log (stdout) is the record a full disk leaves."""
        if self.failure is None:
            self.failure = f"{type(exc).__name__}: {exc}"
            print(f"Paper journal write failed, the run stops: {self.failure}", flush=True)
            if self._on_failure is not None:
                self._on_failure()

    def write(self, kind: str, **fields) -> None:
        line = json.dumps({"wall_ns": time.time_ns(), "kind": kind, **fields}, default=str, sort_keys=True)
        with self._lock:
            if self.failure is not None:
                return
            try:
                self._stream.write(line + "\n")
            except OSError as exc:
                self.fail(exc)

    def state(self, value: dict) -> None:
        if self.failure is not None:
            return
        try:
            atomic(self.output / "state.json", json.dumps(value, default=str, sort_keys=True).encode())
        except OSError as exc:
            self.fail(exc)

    def close(self) -> None:
        try:
            self._stream.close()
        except OSError as exc:  # its buffer held a line the disk refused
            self.fail(exc)

    def sync(self) -> None:
        with self._lock:
            if self.failure is not None:
                raise OSError(f"the journal failed: {self.failure}")
            try:
                self._stream.flush()
                os.fsync(self._stream.fileno())
            except OSError as exc:
                self.fail(exc)
                raise


JOURNAL: Journal | None = None
SESSION: Session | None = None
KLINES: KlineEvents | None = None


def record_kline_events() -> None:
    """Journal the side connection's state changes and the closed klines' event times read since the last call
    (engine.kline_events), on the node's thread."""
    if KLINES is not None:
        MARKET.kline_events(KLINES)


def disk(action) -> None:
    """One of the run's own disk operations: a refusal by the disk is the journal's failure (the run stops and still
    reaches its summary and its dispose), not an exception out of a callback, the watcher or the end."""
    try:
        action()
    except OSError as exc:
        if JOURNAL is None:
            raise
        JOURNAL.fail(exc)


def mutation(callback):
    """Guard the entire runner callback, including cadence and deferred admission."""
    @functools.wraps(callback)
    def call(*args, **kwargs):
        with SESSION.callback() if SESSION else nullcontext():
            return callback(*args, **kwargs)
    return call


def pausing() -> bool:
    """Whether the stop leaves the working orders as they are: the pause (SIGTERM, SIGINT) of a recovery-capable
    source, or of any other source that held a position when the stop was requested (`Session.holding`: it is then
    held, engine.paper_session), or any stop but STOP and the duration of a recovery that did not start its sources (a
    refused one), whose working orders are the restored ones: cancelling them would record cancels the interrupted
    market never made (docs/plans/paper-recovery-open-orders-20261117.zh.md). Such a recovery publishes no checkpoint
    (it is not ready) and its stop reason is not a pause, so the daemon seals it."""
    if not (SESSION and STOP_REASON):
        return False
    if SESSION.saved and not SESSION.ready and STOP_REASON[0] not in ("STOP_FILE", "DURATION"):
        return True
    return (SESSION.supported or SESSION.holding) and STOP_REASON[0] in ("SIGTERM", "SIGINT")


def journal(kind: str, **fields) -> None:
    if JOURNAL is not None:
        JOURNAL.write(kind, **fields)


MARKET = MarketRows(journal)  # the market rows `paper compare` reads, in Live's evidence format (engine.realtime)


def bar_gap(previous_ns: int | None, ts_event: int) -> int:
    """engine.paper.bar_gap: the one-minute bars missing between two consecutive bars' close stamps."""
    if previous_ns is None:
        return 0
    return max(0, (ts_event - previous_ns) // MINUTE_NS - 1)


# The strategy: the replay's class around the source, with the live cadence and the journal

class PaperClock(strategy_runtime.GuardedClock):
    """A timer which already fired must not be recreated by on_start during recovery."""

    def __getattr__(self, name):
        found = super().__getattr__(name)
        if name not in strategy_runtime.CLOCK_CALLBACK_APIS:
            return found

        def register(*args, **kwargs):
            self._instance._paper_user_timers = True
            return found(*args, **kwargs)
        return register


def _paper_clock(self):
    return PaperClock(Strategy.clock.__get__(self, type(self)), self)


class _PaperConfigured(history.Warming, metrics.Feed, paper_terms.Waiting, OrderRules, strategy_runtime.Subscriptions):
    """Construct the source's entry class from the paper runner's inputs (the same source arguments as Replay).
    Paper trading streams no trades, so any trade subscription stops the run (TRADES_NOT_SERVED): its orders
    would match the bars, as a replay's in the bar environment. Metrics come from REST (engine.metrics.Feed)."""

    _source_constructor_args: tuple[tuple, dict]
    _runner_warmup: tuple[tuple[str, int], ...]
    _runner_funding: int
    _runner_reads_funding: bool

    def __new__(cls, inputs: PaperInputs):
        iid = InstrumentId.from_str(inputs.instrument_id)
        args = (iid, BarType.from_str(f"{iid}-1-MINUTE-LAST-EXTERNAL"))
        strategy_id = StrategyId(inputs.strategy_id)
        kwargs = dict(
            trade_start_ns=inputs.trade_start_ns,
            execution_bar_minutes=EXECUTION_BAR_MINUTES,
            strategy_id=strategy_id,
            universe_membership=inputs.universe_membership,  # a Membership, growing month by month
        )
        return strategy_runtime.allocate_strategy(cls, strategy_id, args, kwargs)

    def __init__(self, inputs: PaperInputs):
        self._paper_user_timers = False
        args, kwargs = self._source_constructor_args
        del self._source_constructor_args
        declared = vars(type(self))["_runner_warmup"]
        strategy_runtime.declare(self, declared)
        self._warming_setup(kwargs["strategy_id"], args[0], inputs.warm_at, declared,
                            vars(type(self))["_runner_funding"], inputs.fetch,
                            follows=vars(type(self))["_runner_reads_funding"],
                            reads=bool(SESSION and inputs.instrument_id in SESSION.working),
                            since=SESSION.since if SESSION else None)
        self._metrics_setup(inputs.read_metrics)
        super().__init__(*args, **kwargs)
        strategy_runtime.require_source_config(self, kwargs["strategy_id"])
        self._replay_input_start_ns = inputs.input_start_ns
        self._paper_instrument_id = inputs.instrument_id
        self._paper_membership = inputs.universe_membership
        self._paper_entry_terms = inputs.entry_terms
        self._paper_cadence: dict[str, Cadence] = {}  # instrument ID -> its updates'
        self._paper_held: list = []  # data callbacks waiting for the execution their data caused (release_before)
        self._paper_released_ns = 0  # the clock at the latest dispatch whose held callbacks ran
        self._paper_subscriptions: set[str] = set()
        self._paper_subscription_changes = False
        strategy_runtime.STRATEGIES[inputs.instrument_id] = self  # type: ignore[assignment]

    def submit_order(self, order, position_id=None, client_id=None, params=None):
        """An entry of a contract outside its membership now is not sent and the journal records it; the run goes
        on and the contract only reduces (coverage U9). An order on a back-filled bar that cannot wait for T is not
        sent either: the recovery is refused (engine.paper_session.Session.submitted). Any other entry waits for its
        terms read, unless Nautilus denies it (engine.paper_terms). The order rules see every order sent."""
        now = NOW()
        if not order.is_reduce_only and not self._paper_membership.member_at(now):
            journal("entry_not_sent", code="PAPER_NOT_A_MEMBER", instrument_id=self._paper_instrument_id,
                    client_order_id=str(order.client_order_id), ts_ns=now)
            return None
        if SESSION and SESSION.submitted(order):
            return None
        send = functools.partial(super().submit_order, order, position_id, client_id, params)
        if order.is_reduce_only or not self._paper_entry_terms or denied_exiting(self, order):
            return send()
        return self._paper_wait(order, send, position_id, client_id, params)

    def cancel_order(self, client_order_id, client_id=None, params=None):
        return None if SESSION and SESSION.commanded() else super().cancel_order(client_order_id, client_id, params)

    def cancel_orders(self, client_order_ids, client_id=None, params=None):
        return None if SESSION and SESSION.commanded() else super().cancel_orders(client_order_ids, client_id, params)

    def cancel_all_orders(self, instrument_id, order_side=None, client_id=None, strategy_only=True, params=None):
        return None if SESSION and SESSION.commanded() else super().cancel_all_orders(
            instrument_id, order_side, client_id, strategy_only, params)

    def close_position(self, position, client_id=None, tags=None, time_in_force=None, reduce_only=None,
                       quote_quantity=None, params=None):
        """A close on a back-filled bar is a MARKET order the recovery refuses; after a refusal no cancel or close is sent
        (engine.paper_session.Session.commanded). A market exit is native past these overrides (Session.exiting)."""
        if SESSION and SESSION.commanded(close=True):
            return None
        return super().close_position(position, client_id, tags, time_in_force, reduce_only, quote_quantity, params)

    def market_exit(self):
        if SESSION and SESSION.exiting():
            return None
        return super().market_exit()

    def subscribe_bars(self, bar_type, *args, **kwargs):
        if SESSION and (SESSION.ready or args or kwargs):
            self._paper_subscription_changes = True
        self._paper_subscriptions.add(str(bar_type))
        return super().subscribe_bars(bar_type, *args, **kwargs)

    def _metrics_follow(self, instrument_id: str, after_ns: int | None = None) -> None:  # fixed as subscribe_bars'
        self._paper_subscription_changes |= bool(SESSION and (SESSION.ready or SESSION.handing is not None))
        super()._metrics_follow(instrument_id, SESSION.metrics_after() if SESSION and after_ns is None else after_ns)

    def _metrics_unfollow(self, instrument_id: str) -> None:
        """Journalled: `paper compare` expects no row after it (replay.comparison.compare_metrics), as Live does."""
        if instrument_id in self._metrics_followed:
            self._paper_subscription_changes = True  # a recovery's on_start would follow it again
            MARKET.metrics_unsubscribed(instrument_id)
        super()._metrics_unfollow(instrument_id)

    def unsubscribe_bars(self, bar_type, *args, **kwargs):
        self._paper_subscription_changes = True
        self._paper_subscriptions.discard(str(bar_type))
        return super().unsubscribe_bars(bar_type, *args, **kwargs)

    @mutation
    def _warming_begin(self):
        """Journal the history the source received; a recovering source then loads its saved state. The sources
        and the recorder start together once all have warmed (engine.paper_session.Session.start)."""
        MARKET.warmup(self._paper_instrument_id, self._warming_state()["delivered"])
        if SESSION:
            SESSION.restore_source(self, self._paper_instrument_id)
            SESSION.start(lambda: _begin(self))
        else:
            _begin(self)


@dataclass
class PaperInputs:
    instrument_id: str
    trade_start_ns: int
    input_start_ns: int
    strategy_id: str
    universe_membership: Membership
    warm_at: int  # T of this process's warm-up: the input start, or for a recovery the first minute it can be
    # The warm-up's fetch (fetch_at: engine.history.fetch into this run's Catalog), the read of the metrics
    # (engine.metrics.read) and, for each entry, the terms Binance's differ in from the market's (TERMS_CHANGED);
    # None reads nothing from the network.
    fetch: Callable | None = None
    read_metrics: Callable | None = None
    entry_terms: Callable | None = None


def fetch_at(instrument_id, at: int, declared, precisions: tuple[int, int], *, catalog: Path, proxy_url: str | None,
             session: Session | None, **kwargs):
    """engine.history.fetch, and for a recovery of a contract with working orders the contract's klines of the
    interruption on the same reader thread (engine.paper_session.Session.read_downtime)."""
    found = history.fetch(instrument_id, at, declared, precisions, catalog, proxy_url, **kwargs)
    if session is not None and str(instrument_id) in session.working:
        session.read_downtime(instrument_id, at, precisions, proxy_url)
    return found


def _begin(source) -> None:
    """Lift the order rule's warm-up gate and run the source's on_start (engine.history.Warming)."""
    history.Warming._warming_begin(source)


# The attributes of Nautilus order and position events the live view draws from (fills as markers, working
# orders as price lines, positions as shading); an event without one leaves it out.
EVENT_FIELDS = ("client_order_id", "venue_order_id", "order_side", "order_type", "quantity", "price", "trigger_price",
                "reduce_only", "contingency_type", "parent_order_id", "linked_order_ids", "order_list_id", "tags",
                "time_in_force", "last_qty", "last_px", "commission", "liquidity_side", "trade_id", "position_id",
                "reason", "side", "signed_qty", "avg_px_open", "avg_px_close", "realized_pnl", "opening_order_id",
                "closing_order_id")


def _field(value):
    if value is None or isinstance(value, bool | int):
        return value
    if isinstance(value, list | tuple):
        return [str(item) for item in value]
    return str(value)


def _event_fields(event) -> dict:
    """engine.paper._event_fields: an order or position event's journal fields, its repr included."""
    fields = {name: _field(getattr(event, name)) for name in EVENT_FIELDS
              if getattr(event, name, None) is not None}
    return {**fields, "type": type(event).__name__, "instrument_id": str(getattr(event, "instrument_id", "")),
            "ts_event": getattr(event, "ts_event", None), "event": repr(event)}


def dispatch_of(value) -> tuple:
    """The data event a callback came with, the same for every subscriber of one dispatch."""
    return (type(value).__name__, str(getattr(value, "bar_type", None) or getattr(value, "instrument_id", None)),
            getattr(value, "ts_init", None))


def release_before(value) -> None:
    """A data event is being dispatched, so the live runner has processed every execution event and command queued
    before it (the module docstring): run every strategy's held data callbacks but those of this same dispatch, in
    the order they came. One that raises was recorded by its guard and does not stop the rest."""
    dispatch, due = dispatch_of(value), []
    for strategy in list(strategy_runtime.STRATEGIES.values()):
        strategy = cast(Any, strategy)
        held = getattr(strategy, "_paper_held", None)
        if held and any(item[1] != dispatch for item in held):
            due += [(item, strategy) for item in held if item[1] != dispatch]
            strategy._paper_held = [item for item in held if item[1] == dispatch]
    for (_, _, held_ns, callback, data), strategy in sorted(due, key=lambda pair: pair[0][0]):
        strategy._paper_released_ns = max(strategy._paper_released_ns, held_ns)
        with suppress(Exception):  # engine.strategy.execution_failure recorded it
            callback(strategy, data)


def _hold(self, callback, value, dispatched, *, release: bool = True) -> None:
    """Queue a data callback until the next data dispatch (release_before); `dispatched` is the data that came. Data
    that no dispatch brought (`release` False: a metrics row the Feed hands over from its timer, which rc7's live
    runner takes before the execution events queued with it) releases nothing: it only joins the queue."""
    if release:
        release_before(dispatched)
    clock = Strategy.clock.__get__(self, type(self))
    self._paper_held.append((next(SEQUENCE), dispatch_of(dispatched), clock.timestamp_ns(), callback, value))


def _late(self, event) -> None:
    """PAPER_RELEASE_LATE: a fill stamped before a dispatch whose held callbacks already ran reached the cache after
    them, so they ran without it."""
    if type(event).__name__ == "OrderFilled" and event.ts_event <= self._paper_released_ns:
        journal("release_late", code="PAPER_RELEASE_LATE", client_order_id=str(event.client_order_id),
                ts_event=event.ts_event, released_ns=self._paper_released_ns)


def _repeated(self, bar) -> bool:
    """An external bar stamped no later than the latest of its type the source had: Binance pushing a closed kline
    again, revised or not (rc7's validate_data_sequence passes an equal stamp). It is journalled and the source does
    not see it, or it decides twice on one bar, as engine.live_connection.bar does for Live. A replay never repeats a
    bar, so this keeps parity. An aggregated bar received late is journalled first (MarketRows.aggregated)."""
    MARKET.aggregated(bar)
    kind = bar.bar_type
    if not (isinstance(kind, BarType) and kind.is_externally_aggregated()):
        return False
    latest = self.__dict__.setdefault("_paper_latest_bar", {})
    previous = latest.get(str(kind))
    if previous is not None and bar.ts_event <= previous:
        journal("bar_repeated", bar_type=str(kind), after_ns=previous, received_ns=bar.ts_event)
        return True
    latest[str(kind)] = bar.ts_event
    return False


def paper_callbacks(strategy_class: type) -> dict:
    """engine.strategy.guarded_callbacks, with MARK and funding at the replay's cadence, every data callback run once
    the fills its data caused are applied, and every order and position event journalled before the source
    sees it."""
    found = strategy_runtime.deferred_start(strategy_runtime.guarded_callbacks(strategy_class))
    source = {name: found.get(name) for name in ("on_mark_price", "on_funding_rate", "on_order_event",
                                                 "on_position_event", "on_data")}
    held = {name: (lambda callback: lambda self, value: _hold(self, callback, value, value))(found[name])
            for name in strategy_runtime.DATA_CALLBACKS
            if found.get(name) and name not in ("on_mark_price", "on_funding_rate", "on_data")}
    if "on_bar" in held:
        held["on_bar"] = (lambda hold: lambda self, bar: release_before(bar) if _repeated(self, bar) else hold(self, bar))(
            held["on_bar"])

    def at_cadence(name: str):
        method = source[name]
        return Cadence.wrap(name, "_paper_cadence", (lambda self, passed, update: _hold(self, method, passed, update))
                            if method else lambda self, passed, update: release_before(update), release_before)

    on_mark_price, on_funding_rate = at_cadence("on_mark_price"), at_cadence("on_funding_rate")

    def on_data(self, data):
        """A metrics row the Feed hands the source (engine.metrics) is journalled as it comes, whether or not the
        source handles it, before it is held: `paper compare` checks it against the archive's as `live compare`
        does (replay.comparison.compare_metrics). The Feed hands it over on a timer, not a data dispatch, so it
        releases no held callback: one released there could run before the fills its own bar caused."""
        row = getattr(data, "data", None)
        handed = isinstance(row, strategy_runtime.Metrics)
        if handed:
            MARKET.metrics(row)
        if source["on_data"]:
            _hold(self, source["on_data"], data, data, release=not handed)

    def _warming_settled(self, update):
        """The settlement of T's hour (engine.history, step 6): data like any other, held until the next dispatch."""
        _hold(self, source["on_funding_rate"], update, update)

    def on_order_event(self, event):
        journal("order", strategy_id=str(event.strategy_id), **_event_fields(event))
        _late(self, event)
        if source["on_order_event"]:
            return source["on_order_event"](self, event)

    def on_position_event(self, event):
        journal("position", strategy_id=str(event.strategy_id), **_event_fields(event))
        if source["on_position_event"]:
            return source["on_position_event"](self, event)

    callbacks = {**found, **held, "on_mark_price": on_mark_price, "on_funding_rate": on_funding_rate,
                 "on_order_event": on_order_event, "on_position_event": on_position_event, "on_data": on_data,
                 "_warming_settled": _warming_settled, "_runner_reads_funding": bool(source["on_funding_rate"])}
    return {**{name: mutation(value) if callable(value) else value for name, value in callbacks.items()},
            "clock": property(_paper_clock)}


@functools.cache
def paper_class(loaded: LoadedStrategy) -> type:
    return type(f"PaperExternal_{loaded.content_hash}_{loaded.entry_class}", (_PaperConfigured, loaded.strategy_class),
                {"__module__": __name__, "_runner_warmup": loaded.warmup, "_runner_funding": loaded.funding,
                 **paper_callbacks(loaded.strategy_class)})


class Holder(Strategy):
    """A held start's stand-in for the source of one contract (engine.paper_session, held): the source's strategy ID
    and native configuration, so the restored orders' events reach it and it can cancel them (2026-11-17 probe), and
    nothing of the source. At T + SETTLE_NS it reads the interruption's klines of its contract when that holds a
    restored order (Session.read_downtime, retried as a warm-up until T + DEADLINE_NS; what it cannot read fails the
    check), then joins the start barrier. Once every restored order is proven untouched it withdraws the entries it
    inherited (working orders that are not reduce-only), as Live's held start does, and places nothing."""

    def __new__(cls, inputs: PaperInputs, proxy_url: str | None = None):
        return Strategy.__new__(cls, strategy_runtime.source_config(StrategyId(inputs.strategy_id)))  # type: ignore[call-arg]

    def __init__(self, inputs: PaperInputs, proxy_url: str | None = None):
        super().__init__()
        self._paper_instrument_id = inputs.instrument_id
        self._paper_proxy_url = proxy_url
        self._paper_held: list = []  # no data callback is ever held (release_before reads it)
        self._paper_reader: threading.Thread | None = None
        strategy_runtime.STRATEGIES[inputs.instrument_id] = self

    @mutation
    def on_start(self):
        assert SESSION is not None
        if self._paper_instrument_id not in SESSION.working:
            return SESSION.start(self._held_begin)
        when = SESSION.warm_at + history.SETTLE_NS
        if self.clock.timestamp_ns() >= when:
            return self._held_read()
        self.clock.set_time_alert_ns("held-read", when, self._held_read)

    @mutation
    def _held_read(self, _event=None):
        session, iid, proxy_url = SESSION, self._paper_instrument_id, self._paper_proxy_url
        assert session is not None
        instrument = self.cache.instrument(InstrumentId.from_str(iid))

        def work():
            if instrument is None:
                return
            try:
                history.read_until(lambda: session.read_downtime(iid, session.warm_at, (
                    instrument.price_precision, instrument.size_precision), proxy_url),
                    session.warm_at + history.DEADLINE_NS)
            except Exception as exc:  # the minutes stay unread, so the check refuses the recovery
                print(f"Paper held read of {iid} failed: {type(exc).__name__}: {exc}", flush=True)

        self._paper_reader = threading.Thread(target=work, name=f"held-{iid}", daemon=True)
        self._paper_reader.start()
        self.clock.set_timer("held-read-wait", history.WAIT, callback=self._held_wait)

    @mutation
    def _held_wait(self, _event=None):
        if self._paper_reader is None or self._paper_reader.is_alive():
            return
        self._paper_reader = None
        self.clock.cancel_timer("held-read-wait")
        assert SESSION is not None
        SESSION.start(self._held_begin)

    def _held_begin(self):
        for order in self.cache.orders_open():
            if str(order.instrument_id) == self._paper_instrument_id and not order.is_reduce_only:
                self.cancel_order(order.client_order_id)

    @mutation
    def on_order_event(self, event):
        journal("order", strategy_id=str(event.strategy_id), **_event_fields(event))

    @mutation
    def on_position_event(self, event):
        journal("position", strategy_id=str(event.strategy_id), **_event_fields(event))


# The recorder

STOP = threading.Event()
STOP_REASON: list[str] = []


def request_stop(reason: str) -> None:
    if not STOP.is_set():
        STOP_REASON.append(reason)
        STOP.set()


@dataclass
class RecorderConfig:
    instrument_ids: list
    terms: dict  # instrument ID -> the market's terms at the run's market day (paper start's inputs/terms.json)


class Recorder(DataActor):
    """Journals the live data and account; runs the stop sequence on the node's own thread."""

    def __init__(self, config: RecorderConfig):
        super().__init__(None)
        self.instrument_ids = [InstrumentId.from_str(value) for value in config.instrument_ids]
        self.terms = config.terms
        self.last_bar: dict[str, int] = {}
        self.marks: dict[str, tuple[int, Price]] = {}
        self.cadence: dict[str, Cadence] = {}
        self.minute: int | None = None
        self.gaps = protection.Gaps()  # position ID -> since when it exceeded its resting stops (engine.protection)
        self.stopping_since: float | None = None
        self.handle = None
        self.checked_account = False

    def on_start(self):
        self.clock.set_timer("paper-stop", timedelta(seconds=1), callback=self.on_stop_timer)
        self._check_terms()
        if SESSION:
            SESSION.cache = self.cache
            SESSION.restore_recorder(self)
            SESSION.start(self.start_subscriptions)
        else:
            self.start_subscriptions()

    def start_subscriptions(self):
        for iid in self.instrument_ids:
            self.subscribe_bars(BarType.from_str(f"{iid}-1-MINUTE-LAST-EXTERNAL"))
            self.subscribe_mark_prices(iid)
            self.subscribe_funding_rates(iid)
            self.subscribe_instrument_status(iid)
        self.subscribe_socket_state()

    @mutation
    def on_socket_state(self, event):
        journal("socket", endpoint=event.endpoint, state=str(event.state), ts_event=event.ts_event)

    @mutation
    def on_instrument_status(self, status):
        release_before(status)
        journal("instrument_status", instrument_id=str(status.instrument_id), status=repr(status))

    @mutation
    def on_bar(self, bar):
        release_before(bar)
        iid = str(bar.bar_type.instrument_id)
        missing = bar_gap(self.last_bar.get(iid), bar.ts_event)
        if missing:
            journal("data_gap", instrument_id=iid, missing_bars=missing, after_ts=self.last_bar[iid],
                    before_ts=bar.ts_event)
        self.last_bar[iid] = bar.ts_event
        MARKET.bar(bar)
        if not self.checked_account:
            self._check_account()

    @mutation
    def on_mark_price(self, update):
        release_before(update)
        minute = update.ts_event // MINUTE_NS
        if self.minute is None or minute > self.minute:
            if self.minute is not None:
                self._snapshot()  # at the minute's own marks: this one belongs to the next minute
            self.minute = minute
        self.marks[str(update.instrument_id)] = (update.ts_event, update.value)

    @mutation
    def on_funding_rate(self, update):
        release_before(update)
        iid = str(update.instrument_id)
        settled = self.cadence.setdefault(iid, Cadence()).funding(update)
        if settled is None:
            return
        positions = [{"position_id": str(position.id), "signed_qty": str(position.signed_qty)}
                     for position in self.cache.positions_open(instrument_id=update.instrument_id)]
        mark = self.marks.get(iid)
        record = {"instrument_id": iid, "settlement_ns": settled.ts_event, "stream_rate": str(settled.rate),
                  "mark": str(mark[1]) if mark else None, "mark_ts": mark[0] if mark else None,
                  "positions": positions}
        journal("funding_settlement", **record)

    def _check_terms(self) -> None:
        """TERMS_CHANGED: each loaded contract has the market's terms and the rates its leverage is set from."""
        for iid in self.instrument_ids:
            changed = paper_terms.loaded(self.terms[str(iid)], self.cache.instrument(iid))
            if changed:
                journal("refusal", code="TERMS_CHANGED", instrument_id=str(iid), changed=changed)
                request_stop("TERMS_CHANGED")

    def _check_account(self) -> None:
        account = self.cache.account_for_venue(Venue(VENUE))
        if account is None:
            return
        self.checked_account = True
        if "SANDBOX" not in str(account.id):
            journal("refusal", code="PAPER_EXEC_CLIENT_NOT_SANDBOX", account_id=str(account.id))
            request_stop("PAPER_EXEC_CLIENT_NOT_SANDBOX")

    def _snapshot(self) -> None:
        account = self.cache.account_for_venue(Venue(VENUE))
        usdt = Currency.from_str(ACCOUNT_CONTRACT["base_currency"])
        positions = []
        for position in self.cache.positions_open():
            mark = self.marks.get(str(position.instrument_id))
            positions.append({
                "position_id": str(position.id), "instrument_id": str(position.instrument_id),
                "signed_qty": str(position.signed_qty), "avg_px_open": str(position.avg_px_open),
                "mark": str(mark[1]) if mark else None,
                "unrealized_pnl": str(position.unrealized_pnl(mark[1])) if mark else None,
                "realized_pnl": str(position.realized_pnl)})
        orders = [{"client_order_id": str(order.client_order_id), "instrument_id": str(order.instrument_id),
                   "side": str(order.side), "type": str(order.order_type), "quantity": str(order.quantity),
                   "price": str(getattr(order, "price", None)), "trigger_price": str(getattr(order, "trigger_price", None)),
                   "reduce_only": order.is_reduce_only}
                  for order in self.cache.orders_open()]
        unrealized = [item["unrealized_pnl"] for item in positions]
        totals = {"minute_ns": (self.minute or 0) * MINUTE_NS,
                  "balance_total": str(account.balance_total(usdt)) if account else None,
                  "balance_free": str(account.balance_free(usdt)) if account else None,
                  "unrealized_pnl": None if None in unrealized else str(sum(
                      (Money.from_str(value).as_decimal() for value in unrealized if value is not None), Decimal(0)))}
        # The journal keeps the account totals; the positions and orders behind them are already journalled
        # as events, and state.json carries them for the live view.
        journal("snapshot", **totals)
        if JOURNAL is not None:
            JOURNAL.state({**totals, "positions": positions, "orders": orders})

    def _protection(self) -> None:
        """engine.protection on the native cache, every tick: a position its resting stops do not cover for longer
        than the allowance is journalled once per gap."""
        uncovered = {}
        for position in self.cache.positions_open():
            held = position.quantity.as_decimal() * (1 if position.side.name == "LONG" else -1)
            stops = protection.stop_quantity(held, protection.of_position(self.cache, position))
            if stops < abs(held):
                uncovered[str(position.id)] = (position, held, stops)
        for key in self.gaps.update(self.clock.timestamp_ns(), uncovered):
            position, held, stops = uncovered[key]
            journal("protection_gap", position_id=key, instrument_id=str(position.instrument_id), position=str(held),
                    stop_quantity=str(stops), since_ns=self.gaps.since[key])

    def on_stop_timer(self, _event):
        record_kline_events()
        self._protection()
        if paper_terms.QUEUE:  # a callback of the run: it sends orders (Session.callback), unless refused (Session.submitted)
            with SESSION.callback() if SESSION else nullcontext():
                paper_terms.release(journal, request_stop, stopping=STOP.is_set() or bool(SESSION and SESSION.refused))
        if SESSION and not STOP.is_set():
            try:
                SESSION.backend.health()
            except CacheUnavailable as exc:
                # The cache holds the checkpoint's originals and the native writes; a run which trades on without it
                # cannot be recovered and says nothing about it (finding 20261114-34). It stops like a refused one.
                journal("refusal", code="PAPER_CACHE_UNAVAILABLE", reason=str(exc))
                request_stop("PAPER_CACHE_UNAVAILABLE")
                return  # the next tick runs the stop sequence
        if SESSION and not SESSION.ready and not STOP.is_set() and (
                SESSION.refused or time.monotonic() >= SESSION.restore_deadline):
            checkpoint.dirty(SESSION.backend.output)
            # Latched, so a start that completes after the deadline starts nothing (Session.maybe_begin).
            SESSION.refused = SESSION.refused or "native initialization did not complete"
            journal("refusal", code="PAPER_RECOVERY_UNAVAILABLE", reason=SESSION.refused)
            request_stop("PAPER_RECOVERY_UNAVAILABLE")
        found = strategy_runtime.breaches()
        if found is not None and not STOP.is_set():
            code, subscriptions = found
            journal("refusal", code=code, subscriptions=subscriptions)
            request_stop(code)
            return  # the next tick runs the stop sequence
        if SESSION and SESSION.held and SESSION.ready and not STOP.is_set() and not self.cache.positions_open():
            request_stop("HELD_FLAT")  # the held run's positions are closed: it ends (engine.paper_session, held)
            return  # the next tick runs the stop sequence, which cancels what is left
        if not STOP.is_set():
            if SESSION:
                SESSION.try_cut(self.cache)
            return
        open_orders = self.cache.orders_open()
        if self.stopping_since is None:
            self.stopping_since = time.monotonic()
            if SESSION:
                # A source without the protocol is held only with a position whose working orders a checkpoint can
                # hold (in flight ones are waited for); otherwise it cancels and ends as before.
                SESSION.holding = bool(self.cache.positions_open()) and not any(
                    unrestorable(order) and not in_flight(order) for order in self.cache.orders())
            journal("stop_requested", reason=STOP_REASON[0] if STOP_REASON else None, open_orders=len(open_orders))
            if not pausing():
                self._cancel_all()
            return
        if SESSION and SESSION.holding and not SESSION.supported and not self.cache.positions_open():
            # The held pause's last position closed while it waited for the orders in flight: nothing is left to hold
            # and its cut needs an open position, so it cancels what is left and ends as a flat stop does.
            SESSION.holding = False
            self._cancel_all()
            return
        # A pause keeps the working orders but waits for those in flight: Sandbox `stop()` refuses the commands still
        # queued, and a checkpoint cannot hold an order the venue has not answered (engine.paper_session.unrestorable).
        # It also waits for the bar of a declared aggregation's bucket that has ended: the final cut cannot be published
        # before that bar reached the source (engine.paper_session.Session.due).
        pending = (any(strategy._paper_held for strategy in strategy_runtime.STRATEGIES.values())
                   or bool(paper_terms.QUEUE) or any(in_flight(order) for order in self.cache.orders())
                   or bool(SESSION and SESSION.ready and SESSION.due(self.cache, time.time_ns()))
                   ) if pausing() else open_orders
        if self.handle is None or pending and time.monotonic() - self.stopping_since < STOP_CANCEL_SECONDS:
            return
        if pausing() and SESSION:
            SESSION.before_stop(self.cache)
        paper_terms.release(journal, request_stop, stopping=True, final=True)
        journal("stopping", open_orders=len(open_orders))
        self.handle.stop()
        self.handle = None

    @staticmethod
    def _cancel_all() -> None:
        """The runner's own cancel, past the gate on the source's commands (Session.commanded): a STOP cancels even
        after a refused back-fill whose refusal has not been journalled yet. A held run's holder is the runner's own
        strategy, without that gate."""
        for iid, strategy in strategy_runtime.STRATEGIES.items():
            if isinstance(strategy, Holder):
                strategy.cancel_all_orders(InstrumentId.from_str(iid))
            else:
                OrderRules.cancel_all_orders(cast(Any, strategy), InstrumentId.from_str(iid))


# The run

def parse(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="python -m engine.paper", description=__doc__.split("\n")[0])
    parser.add_argument("--strategy-file", type=Path, required=True)
    parser.add_argument("--strategy-class", required=True)
    parser.add_argument("--strategy-sha256", required=True)
    parser.add_argument("--symbols", nargs="+", required=True)
    parser.add_argument("--universe", type=Path, required=True, help="the membership file the replay takes")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--maker-fee", type=Decimal, required=True, help="the market's assumed maker rate")
    parser.add_argument("--taker-fee", type=Decimal, required=True, help="the market's assumed taker rate")
    parser.add_argument("--leverage", type=leverage_of, required=True, help="the account's Binance leverage")
    parser.add_argument("--terms", type=Path, required=True,
                        help="the market's terms of each symbol at the run's market day (TERMS_CHANGED)")
    parser.add_argument("--proxy-url", help="the egress proxy that admits only Binance's public hosts")
    parser.add_argument("--duration-seconds", type=int, help="stop after this long (engineering trials)")
    return parser.parse_args(argv)


def plan(symbols: list[str], membership: dict, start_ns: int, warm_at: int, months: Path | None = None, *,
         fetch: Callable | None = None, read_metrics: Callable | None = None, entry_terms: Callable | None = None) -> list:
    """The instances: each contract in the universe at the input start, with its membership from there to the end
    of that month and, month by month after it, from the host's month files in `months` (Membership), and the
    network reads of their warm-ups, metrics and entry terms."""
    planned = []
    end = membership_months.month_end_ns(start_ns)
    for symbol in symbols:
        intervals = membership_months.opening(membership[symbol], start_ns, end)
        if not any(low <= start_ns < high for low, high in intervals):
            raise Refusal("PAPER_NOT_IN_UNIVERSE", f"{symbol}: the universe does not hold it at the input start "
                                                   f"{utc_text(start_ns)}")
        planned.append(PaperInputs(instrument_id(symbol), start_ns, start_ns, strategy_id(symbol),
                                   Membership(symbol, intervals, end, months), warm_at, fetch, read_metrics,
                                   entry_terms))
    return planned


NOW = time.time_ns  # the instant a membership is read at (a test sets it)


class Membership(membership_months.Membership):
    """A Paper contract's `universe_membership` (engine.membership): read at NOW, journalled with Paper's code."""

    def __init__(self, symbol: str, intervals, known_until_ns: int, months: Path | None):
        super().__init__(symbol, intervals, known_until_ns, months, now=lambda: NOW(),
                         record=lambda kind, **fields: journal(kind, **fields), stale_code="PAPER_MEMBERSHIP_STALE")


def build_node(planned: list[PaperInputs], loaded: LoadedStrategy, proxy_url: str | None,
               fees: tuple[Decimal, Decimal], catalog: Path, leverage: str, terms: dict,
               session: Session | None = None) -> tuple[Any, Recorder]:
    """The node, and the recorder it holds."""
    account = ACCOUNT_CONTRACT
    usdt = Currency.from_str(account["base_currency"])
    builder = node_base("paper", account["trader_id"], Environment.SANDBOX, catalog,
                        [item.instrument_id for item in planned], proxy_url)
    balance = Money(Decimal(account["starting_balance_usdt"]), usdt)  # type: ignore[arg-type]
    builder.with_cache_config(CacheConfig(use_instance_id=False, bar_capacity=history.bar_capacity(loaded.warmup)))
    if session:
        session.expected_starts = len(planned) + 1
        builder.with_cache_database_factory(session.backend.config).with_load_state(bool(session.saved))
        # Strategy hook state belongs to the same frozen native FIFO marker as this journal cut.
        # A second, independently saved strategy state would not define the same cut.
        builder.with_save_state(False)
        accounts = session.backend.accounts()
        if session.saved:
            session.working = session.backend.open_contracts()
        if accounts:
            # A held checkpoint has the account and no source state: of a source without the protocol, or of one with
            # it whose earlier recovery fell back to held (Session.hold), the only cut that leaves its state out.
            sources = bool((session.saved or {}).get("sources"))
            if len(accounts) != 1 or sources and not session.declared:
                raise checkpoint.fail("native accounts and checkpoint strategy state disagree")
            if session.supported and not sources:
                session.hold("an earlier recovery of this run was held")
            original = next(iter(accounts.values()))
            if "SANDBOX" not in str(original.id):
                raise checkpoint.fail("the checkpoint account is not a Sandbox account")
            balance = original.balance_total(usdt)
        elif (session.saved or {}).get("sources"):
            raise checkpoint.fail("the checkpoint strategy state has no native account")
    builder.with_reconciliation(bool(session))
    builder.with_risk_engine_config(LiveRiskEngineConfig(max_order_submit_rate=account["max_order_submit_rate"]))
    builder.add_simulated_exec_client(VENUE, SandboxExecutionClientFactory(), SandboxExecutionClientConfig(
        venue=Venue(VENUE), starting_balances=[balance],
        base_currency=usdt, oms_type=getattr(OmsType, account["oms_type"]),
        account_type=getattr(AccountType, account["account_type"]), default_leverage=Decimal(leverage) * paper_terms.LOADER_MARGIN,
        book_type=getattr(BookType, account["book_type"]), bar_execution=account["bar_execution"],
        bar_adaptive_high_low_ordering=account["bar_adaptive_high_low_ordering"],
        reject_stop_orders=account["reject_stop_orders"], support_gtd_orders=account["support_gtd_orders"],
        support_contingent_orders=account["support_contingent_orders"],
        # The matching engine's own position IDs restart from 0 in every process and collide with the cached
        # ones after a recovery; the execution engine's (strategy-side `P-…`) are kept in the cache.
        use_position_ids=False, fill_model=fill_model(account), fee_model=MakerTakerFeeModel(*fees),
        # The contract's matching terms a replay's venue takes (engine.run.add_venue), so a change of the contract
        # reaches Paper's Sandbox too (finding 20261114-39).
        liquidity_consumption=account["liquidity_consumption"], queue_position=account["queue_position"]))
    node = builder.build()
    paper_terms.add_gate(node)
    for inputs in planned:
        node.add_strategy(Holder(inputs, proxy_url) if session and session.held
                          else strategy_runtime.configure_strategy(loaded, inputs, paper_class))
    node.add_actor(history.WarmupActor(history.WarmupActorConfig(live=True)))
    recorder = Recorder(RecorderConfig([item.instrument_id for item in planned], terms))
    node.add_actor(recorder)
    if recorder.trader_id is None:  # the node registers this instance itself; one it does not would record nothing
        raise Refusal("NATIVE_EXECUTION_FAILED", "the node did not register the paper recorder")
    return node, recorder


def summary(args, loaded: LoadedStrategy, planned: list[PaperInputs], recorder: Recorder, node, started_ns: int) -> dict:
    cache = node.cache
    usdt = Currency.from_str(ACCOUNT_CONTRACT["base_currency"])
    account = cache.account_for_venue(Venue(VENUE))
    denied = any(str(order.status).endswith(("DENIED", "REJECTED")) for order in cache.orders())
    instances = {}
    for inputs in planned:
        strategy = strategy_runtime.STRATEGIES.get(inputs.instrument_id)
        if isinstance(strategy, Holder):
            strategy = None  # a held run has no source to ask
        found = None
        try:
            found = strategy.replay_integrity_findings(denied) if strategy is not None else None  # type: ignore[attr-defined]
        except Exception as exc:
            strategy_runtime.execution_failure("replay_integrity_findings", exc, strategy)
        instances[inputs.instrument_id] = {
            "strategy_id": inputs.strategy_id, "input_start_ns": inputs.input_start_ns,
            "diagnostics": diagnostics(strategy) if strategy is not None else None, "integrity_findings": found}
    positions = []
    for position in cache.positions_open():
        mark = recorder.marks.get(str(position.instrument_id))
        positions.append({"position_id": str(position.id), "signed_qty": str(position.signed_qty),
                          "avg_px_open": str(position.avg_px_open), "mark": str(mark[1]) if mark else None,
                          "unrealized_pnl": str(position.unrealized_pnl(mark[1])) if mark else None})
    return {
        "execution": EXECUTION,
        "identity": {**strategy_metadata(loaded), **runtime_source_metadata(),
                     "engine_version": importlib.metadata.version("nautilus_trader")},
        # Binance's terms: rates 1 at --leverage lock what the Sandbox's loader rates at the derived leverage do.
        "account": dict(ACCOUNT_CONTRACT, execution=EXECUTION, default_leverage=args.leverage),
        "fees": {"maker": str(args.maker_fee), "taker": str(args.taker_fee)},
        "symbols": args.symbols, "started_ns": started_ns, "stopped_ns": time.time_ns(),
        "stop_reason": STOP_REASON[0] if STOP_REASON else "node_stopped",
        "instances": instances,
        "balance_total": str(account.balance_total(usdt)) if account else None,
        "positions_at_stop": positions,
        "orders_denied_or_rejected": denied,
    }


REPORTS = "reports"


def write_native_reports(output: Path, cache) -> None:
    """``<output>/reports/``: the native cache's orders, fills, positions and account reports and its order events,
    as a replay writes them (engine.report.write_cache_reports), replaced whole: an earlier end's are
    removed first, so a failed write leaves none. A recovered run's cache holds the whole run, so the latest end's
    reports do."""
    from engine.report import write_cache_reports
    partial = output / f".{REPORTS}.partial"
    shutil.rmtree(output / REPORTS, ignore_errors=True)
    shutil.rmtree(partial, ignore_errors=True)
    partial.mkdir()
    account = cache.account_for_venue(Venue(VENUE))
    write_cache_reports(partial, cache, Venue(VENUE),
                        account_states(account.events, resumed_at(output)) if account is not None else None,
                        unfilled_liquidity=False)
    os.replace(partial, output / REPORTS)


def resumed_at(output: Path) -> list[int]:
    """The wall times of the run's `resumed` lines in its journal."""
    found = []
    with (output / "events.jsonl").open("rb") as stream:
        for raw in stream:
            try:
                line = json.loads(raw)
            except ValueError:  # an interrupted line
                continue
            if line.get("kind") == "resumed" and isinstance(line.get("wall_ns"), int):
                found.append(line["wall_ns"])
    return found


def account_states(events: list, resumed: list[int]) -> list:
    """The account's states as an uninterrupted run has them, for its report. rc7 adds two kinds to a resumed run's
    account that no trading made: its Redis cache appends the account's last state on every cache update
    (crates/infrastructure/src/redis/cache.rs, update_account), so the restored account repeats states under one event
    ID, kept here once; and the Sandbox, connecting again, restates the balance it was started with (the checkpoint's
    total, build_node) with nothing locked and no margins (crates/adapters/sandbox/src/execution.rs, connect) while
    the restored positions still hold theirs. That restatement is the first state after a `resumed`; it is left out
    only when it restates the state before it so, and any other state stays."""
    seen: set[str] = set()
    states = []
    for event in events:
        if str(event.event_id) not in seen:
            seen.add(str(event.event_id))
            states.append(event)
    restated = set()
    for at in resumed:
        index = next((index for index, state in enumerate(states) if state.ts_event >= at), None)
        if index and restates(states[index - 1], states[index]):
            restated.add(index)
    return [state for index, state in enumerate(states) if index not in restated]


def restates(before, state) -> bool:
    """Whether `state` holds `before`'s totals with nothing locked and no margins."""
    return (not state.margins and all(balance.locked.as_decimal() == 0 for balance in state.balances)
            and {str(balance.currency): balance.total for balance in state.balances}
            == {str(balance.currency): balance.total for balance in before.balances})


def main(argv: list[str] | None = None) -> None:
    found = credential_names(os.environ)
    if found:
        raise Refusal("PAPER_CREDENTIALS_PRESENT", "exchange credential variables are in the environment: " +
                      ", ".join(found) + "; start the runner with an allowlisted environment")
    args = parse(argv)
    with Signals(request_stop):
        failed = _main(args)
    if failed:
        sys.exit(JOURNAL_FAILED_EXIT)


def _main(args) -> bool:
    """Run the node to its end; whether the journal failed on the way (the runner then exits JOURNAL_FAILED_EXIT)."""
    global JOURNAL, SESSION, KLINES
    strategy_runtime.begin_run(args.output, {"Metrics": {instrument_id(symbol) for symbol in args.symbols}})
    try:
        loaded = load_strategy(args.strategy_file, args.strategy_class, args.strategy_sha256)
    except Refusal as exc:
        # Bytes that are not the declared source are no verdict on it; a resumed run's journal stays at its checkpoint.
        if not exc.code.startswith("CONTENT_HASH_") and not (args.output / "events.jsonl").exists():
            JOURNAL = Journal(args.output)
            journal("refusal", code=exc.code, reason=str(exc))
            JOURNAL.close()
        raise
    membership = read_universe(args.universe, list(args.symbols))
    binding = args.strategy_file.parent / "recovery.json"
    backend = None
    saved = None
    if binding.is_file():
        backend = NativeCache(args.output, json.loads(binding.read_bytes())["identity"], ACCOUNT_CONTRACT["trader_id"])
        try:
            saved = backend.state()
        except BaseException:
            backend.close()
            raise
    elif (args.output / "events.jsonl").exists():
        raise checkpoint.fail("an existing run has no native recovery binding; a new account is refused")
    started_ns = saved["started_ns"] if saved else time.time_ns()
    # T: a new run's input starts at its warm-up; a recovery warms again at its own first minute, or at the input
    # start when that is still ahead.
    warm_at = history.start_at(time.time_ns())
    start_ns = saved["input_start_ns"] if saved else warm_at
    warm_at = max(warm_at, start_ns)
    JOURNAL = Journal(args.output, on_failure=lambda: request_stop(JOURNAL_WRITE_FAILED))
    catalog = Path(tempfile.mkdtemp(prefix="paper-warmup-"))
    try:
        SESSION = (Session(backend, JOURNAL, loaded, saved, started_ns, start_ns, warm_at, release=release_before)
                   if backend else None)
        if SESSION:
            checkpoint.dirty(args.output)
            warm_at = SESSION.warm_at  # a recovery that back-fills an aggregation may move it (Session.crossed)
        if saved:
            assert backend is not None
            backend.retain_attempt()
            journal("resumed", execution=EXECUTION)
            if SESSION and SESSION.fallen:
                # The source's recovery is refused and the run is held (Session.hold); `paper compare` reads the
                # held start from this line following `resumed` (paper.compare.held_since).
                journal("refusal", code="PAPER_RECOVERY_UNAVAILABLE", reason=f"{SESSION.fallen}; the run is held")
        else:
            # The runner's own protocol verdict (paper_session.declares_recovery), which the page and paper compare
            # read; not in strategy_metadata, which also feeds the replay summary.
            journal("started", symbols=args.symbols, input_start_ns=start_ns, execution=EXECUTION,
                    recovery_declared=declares_recovery(loaded.strategy_class), **strategy_metadata(loaded))
            journal("waiting", until_ns=start_ns)
        market_terms = json.loads(args.terms.read_bytes())
        planned = plan(list(args.symbols), membership, start_ns, warm_at, args.universe.parent / membership_months.MONTHS,
                       fetch=functools.partial(fetch_at, catalog=catalog, proxy_url=args.proxy_url, session=SESSION),
                       read_metrics=functools.partial(metrics.read, proxy_url=args.proxy_url),
                       entry_terms=functools.partial(paper_terms.entry, market_terms, proxy_url=args.proxy_url))
        node, recorder = build_node(planned, loaded, args.proxy_url,
                          (args.maker_fee, args.taker_fee), catalog, args.leverage,
                          {instrument_id(symbol): market_terms[symbol] for symbol in args.symbols}, SESSION)
        recorder.handle = node.handle()

        def watch():
            deadline = None if args.duration_seconds is None else time.monotonic() + args.duration_seconds
            written = 0
            while not STOP.is_set():
                if (args.output / "STOP").exists():
                    request_stop("STOP_FILE")
                elif deadline is not None and time.monotonic() >= deadline:
                    request_stop("DURATION")
                total = sum(receipt["count"] for receipt in strategy_runtime.FAILURES)
                if total != written:
                    disk(strategy_runtime.write_failures)
                    written = total
                STOP.wait(1)

        threading.Thread(target=watch, daemon=True).start()
        KLINES = KlineEvents(args.symbols, args.proxy_url)
        KLINES.start()
        try:
            node.run()
        finally:
            KLINES.stop()
            record_kline_events()
            if SESSION:
                disk(lambda: checkpoint.dirty(args.output))
            result = summary(args, loaded, planned, recorder, node, started_ns)
            result["runtime_failures"] = len(strategy_runtime.FAILURES)
            if strategy_runtime.FAILURES:
                disk(strategy_runtime.write_failures)
            disk(lambda: atomic(args.output / "summary.json",
                                           json.dumps(result, default=str, indent=2, sort_keys=True).encode()))
            journal("summary_written", stop_reason=result["stop_reason"])
            try:
                write_native_reports(args.output, node.cache)
            except Exception as exc:  # the seal then audits nothing and says so
                journal("reports_failed", error=f"{type(exc).__name__}: {exc}")
            if SESSION and pausing():
                SESSION.try_cut(node.cache)
            node.dispose()
    finally:
        JOURNAL.close()
        if backend:
            backend.close()
        SESSION = None
        KLINES = None
        shutil.rmtree(catalog, ignore_errors=True)
    return JOURNAL is not None and JOURNAL.failure is not None


if __name__ == "__main__":
    from engine.paper import main as paper_main
    try:
        paper_main()
    except Refusal as refusal:
        print(json.dumps({"refused": refusal.code, "message": str(refusal)}), file=sys.stderr)
        sys.exit(2)
