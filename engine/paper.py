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
  settlement, as the replay does.
- An instance starts at T, the first whole minute at least half a minute after the runner starts (engine.history):
  its declared WARMUP history and the minutes that warm its aggregations are read from Binance's public klines into
  a temporary Catalog and served as a replay serves them, so its first aggregated bars are complete.
- No trades are streamed (orders match bars, so a mid-bar trade signal would see the bar's end); a strategy
  subscribing to trades stops the run with ``TRADES_NOT_SERVED``. No metrics are streamed either; a metrics
  subscription stops it with ``METRICS_NOT_SERVED``.
- The Sandbox matches a bar before the strategy sees it, as a replay's exchange does, but its fills reach the
  cache on the live runner's execution channel, after the bar's dispatch. The strategy's data callbacks
  therefore run HOLD_NS later, in the order they came, once the fills the bar caused are applied: a stop or
  target filled on a bar is closed when the strategy's ``on_bar`` for it runs, as in the replay.

The Sandbox matches with the replay's terms: its fill model, book type and bar ordering, and the maker and
taker rates the run is given (``--maker-fee``, ``--taker-fee``: the market's assumed rates, which a replay
reads from its export receipts).

Its own record is ``<output>/events.jsonl``: bars, data gaps, socket state, orders, positions, funding
settlements, the account totals once a minute and protection gaps. ``<output>/state.json`` holds the latest
totals with the open positions and orders, ``<output>/runtime_failures.jsonl`` is rewritten within a second of
each runtime failure, and ``<output>/summary.json`` and ``<output>/reports/`` (the native cache's reports and order
events as a replay writes them, which the sealing step audits) are written at the end. Sandbox
settles no funding (native probe, 2026-10-25), so the journal records each settlement with the positions it
applies to, and the sealing step accounts for it.

Explicit STOP/duration cancels working orders and stops the node. For a recovery-capable source, SIGTERM/
SIGINT instead pauses without calling the source terminal stop hook. Only terminal-order, timer-free,
completed callbacks can publish a native checkpoint. A dirty or incomplete point refuses recovery and
retains its original journal; no new account is substituted.
"""

from __future__ import annotations

# This must precede third-party imports: every native worker must inherit the mask.
if __name__ == "__main__":
    from engine.paper_signals import block
    block()

import argparse
from contextlib import nullcontext
import functools
import hashlib
import importlib.metadata
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from nautilus_trader.adapters.binance import (
    BinanceDataClientConfig, BinanceDataClientFactory, BinanceEnvironment, BinanceInstrumentProviderConfig,
    BinanceProductType,
)
from nautilus_trader.adapters.sandbox import SandboxExecutionClientConfig, SandboxExecutionClientFactory
from nautilus_trader.common import CacheConfig, DataActor, Environment, ImportableActorConfig, LoggerConfig, LogLevel
from nautilus_trader.execution import MakerTakerFeeModel
from nautilus_trader.live import LiveDataEngineConfig, LiveNode, LiveNodeConfig, LiveRiskEngineConfig
from nautilus_trader.persistence import DataCatalogConfig
from nautilus_trader.model import (
    AccountType, Bar, BarType, BookType, Currency, InstrumentId, Money, OmsType, Price, StrategyId, TraderId, Venue,
)
from nautilus_trader.trading import Strategy

from engine import history, strategy as strategy_runtime
from engine import paper_checkpoint as checkpoint, protection
from engine.order_rules import OrderRules
from engine.fill import fill_model
from engine.paper_redis import NativeCache
from engine.paper_session import Session
from engine.paper_signals import Signals
from engine.cadence import Cadence
from engine.config import (ACCOUNT_CONTRACT, EXECUTION_BAR_MINUTES, MINUTE_NS, Refusal, leverage_of,
                           runtime_source_metadata, terms_changed, utc_text)
from engine.load import (
    LoadedStrategy, diagnostics, episode_membership, load_strategy, read_universe, strategy_id, strategy_metadata,
)
from engine import order_rules

EXECUTION = "paper-bars"
VENUE = ACCOUNT_CONTRACT["venue"]
# rc7's Binance loader gives every USD-M perpetual these margin rates (probe 2026-11-11; upstream
# nautechsystems/nautilus_trader#5531, open); neither the Sandbox's config nor rc7's Python cache can replace
# them. Nautilus locks notional x rate / leverage, Binance notional / leverage:
# the Sandbox's leverage is --leverage x this rate, and a loaded contract with other rates stops the run
# (TERMS_CHANGED; docs/plans/r1-2d-leverage-terms-20261111.zh.md).
LOADER_MARGIN = Decimal("0.1")
LATE_BAR_NS = 2_000_000_000  # a bar arriving later than this after its close is a late-bar event
STOP_CANCEL_SECONDS = 10
# How long the strategy's data callbacks wait for the execution events their data caused. Those are queued
# before the data's dispatch returns and the live runner polls them ahead of data; they take milliseconds.
HOLD_NS = 100_000_000
LIMITATIONS = (
    "paper-bars: Sandbox settles no funding; events.jsonl records each settlement with the positions it applies "
    "to, for the sealing step",
)
# Names of variables that may hold an exchange credential. Matching is on names only: values are never read.
CREDENTIAL_NAME = re.compile(
    r"^(BINANCE|BNB|OKX|OKEX|BYBIT|BITMEX|BITGET|COINBASE|KRAKEN|DERIBIT|HYPERLIQUID|DYDX|GATE|KUCOIN|MEXC|HTX|"
    r"HUOBI|POLYMARKET|LIGHTER|ARCHITECT)_|(API_KEY|API_SECRET|SECRET_KEY|PASSPHRASE|PRIVATE_KEY)", re.IGNORECASE)


def credential_names(environ) -> list[str]:
    """engine.paper.credential_names: the environment variable names that may hold an exchange credential."""
    return sorted(name for name in environ if CREDENTIAL_NAME.search(name))


def instrument_id(symbol: str) -> str:
    return f"{symbol}-PERP.{VENUE}"


def warmup_digest(bars: list[Bar]) -> dict:
    """A history the source received (engine.history), as the journal and summary record it."""
    text = "\n".join(f"{bar.ts_event},{bar.open},{bar.high},{bar.low},{bar.close},{bar.volume}" for bar in bars)
    return {"bars": len(bars), "first_ts_event": bars[0].ts_event if bars else None,
            "last_ts_event": bars[-1].ts_event if bars else None,
            "sha256": hashlib.sha256(text.encode()).hexdigest()}


# The journal

class Journal:
    """events.jsonl (appended and flushed line by line) and state.json (replaced whole)."""

    def __init__(self, output: Path):
        output.mkdir(parents=True, exist_ok=True)
        self.output = output
        self._stream = (output / "events.jsonl").open("a", encoding="utf-8", buffering=1)
        self._lock = threading.Lock()

    def write(self, kind: str, **fields) -> None:
        line = json.dumps({"wall_ns": time.time_ns(), "kind": kind, **fields}, default=str, sort_keys=True)
        with self._lock:
            self._stream.write(line + "\n")

    def state(self, value: dict) -> None:
        partial = self.output / ".state.json.partial"
        partial.write_text(json.dumps(value, default=str, sort_keys=True), encoding="utf-8")
        os.replace(partial, self.output / "state.json")

    def close(self) -> None:
        self._stream.close()

    def sync(self) -> None:
        with self._lock:
            self._stream.flush()
            os.fsync(self._stream.fileno())


JOURNAL: Journal | None = None
SESSION: Session | None = None


def mutation(callback):
    """Guard the entire runner callback, including cadence and deferred admission."""
    @functools.wraps(callback)
    def call(*args, **kwargs):
        with SESSION.callback() if SESSION else nullcontext():
            return callback(*args, **kwargs)
    return call


def pausing() -> bool:
    return bool(SESSION and SESSION.supported and STOP_REASON and STOP_REASON[0] in ("SIGTERM", "SIGINT"))


def journal(kind: str, **fields) -> None:
    if JOURNAL is not None:
        JOURNAL.write(kind, **fields)


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


class _PaperConfigured(history.Warming, OrderRules, strategy_runtime.Subscriptions):
    """Construct the source's entry class from the paper runner's inputs (the same source arguments as Replay).
    Paper trading streams no trades, so any trade subscription stops the run (TRADES_NOT_SERVED): its orders
    would match the bars, as a replay's in the bar environment. It streams no metrics either
    (METRICS_NOT_SERVED)."""

    _source_constructor_args: tuple[tuple, dict]
    _runner_warmup: tuple[tuple[str, int], ...]

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
        self._warming_setup(kwargs["strategy_id"], args[0], inputs.warm_at, declared, FETCH[0] if FETCH else None)
        super().__init__(*args, **kwargs)
        strategy_runtime.require_source_config(self, kwargs["strategy_id"])
        self._replay_input_start_ns = inputs.input_start_ns
        self._paper_instrument_id = inputs.instrument_id
        self._paper_membership = inputs.universe_membership
        self._paper_cadence = Cadence()
        self._paper_held: list = []  # data callbacks waiting for the fills their data caused
        self._paper_subscriptions: set[str] = set()
        self._paper_subscription_changes = False
        strategy_runtime.STRATEGIES[inputs.instrument_id] = self  # type: ignore[assignment]

    def submit_order(self, order, position_id=None, client_id=None, params=None):
        """An entry of a contract outside its membership now is not sent and the journal records it; the run goes
        on and the contract only reduces (coverage U9). The order rules see every other order."""
        now = NOW()
        if not order.is_reduce_only and not self._paper_membership.member_at(now):
            journal("entry_not_sent", code="PAPER_NOT_A_MEMBER", instrument_id=self._paper_instrument_id,
                    client_order_id=str(order.client_order_id), ts_ns=now)
            return None
        return super().submit_order(order, position_id=position_id, client_id=client_id, params=params)

    def subscribe_bars(self, bar_type, *args, **kwargs):
        if SESSION and (SESSION.ready or args or kwargs):
            self._paper_subscription_changes = True
        self._paper_subscriptions.add(str(bar_type))
        return super().subscribe_bars(bar_type, *args, **kwargs)

    def unsubscribe_bars(self, bar_type, *args, **kwargs):
        self._paper_subscription_changes = True
        self._paper_subscriptions.discard(str(bar_type))
        return super().unsubscribe_bars(bar_type, *args, **kwargs)

    @mutation
    def _warming_begin(self):
        """Journal the history the source received; a recovering source then loads its saved state. The sources
        and the recorder start together once all have warmed (engine.paper_session.Session.start)."""
        state = self._warming_state()
        for period, bars in state["delivered"].items():
            journal("warmup", instrument_id=self._paper_instrument_id, period=period, fetched_ns=state["fetched_ns"],
                    **warmup_digest(bars))
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


# The fetch the instances' warm-ups use (engine.history.fetch into this run's Catalog), set by _main.
FETCH: list = []


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


@mutation
def _release(self, _event=None) -> None:
    """Run the held data callbacks in the order they came. One that raises was recorded by its guard and
    does not stop the rest, as each ran on its own before."""
    held, self._paper_held = self._paper_held, []
    for callback, value in held:
        try:
            callback(self, value)
        except Exception:  # engine.strategy.execution_failure recorded it
            pass


def _hold(self, callback, value) -> None:
    """Queue a data callback until HOLD_NS from now (see the module docstring)."""
    self._paper_held.append((callback, value))
    if len(self._paper_held) == 1:
        clock = Strategy.clock.__get__(self, type(self))
        clock.set_time_alert_ns(f"paper-hold-{id(self)}", clock.timestamp_ns() + HOLD_NS, self._paper_release)


def paper_callbacks(strategy_class: type) -> dict:
    """engine.strategy.guarded_callbacks, with MARK and funding at the replay's cadence, every data callback run once
    the fills its data caused are applied, and every order and position event journalled before the source
    sees it."""
    found = strategy_runtime.deferred_start(strategy_runtime.guarded_callbacks(strategy_class))
    source = {name: found.get(name) for name in ("on_mark_price", "on_funding_rate", "on_order_event",
                                                 "on_position_event")}
    held = {name: (lambda callback: lambda self, value: _hold(self, callback, value))(found[name])
            for name in strategy_runtime.DATA_CALLBACKS if found.get(name) and name not in ("on_mark_price", "on_funding_rate")}

    def on_mark_price(self, update):
        if self._paper_cadence.mark(update) and source["on_mark_price"]:
            _hold(self, source["on_mark_price"], update)

    def on_funding_rate(self, update):
        settled = self._paper_cadence.funding(update)
        if settled is not None and source["on_funding_rate"]:
            _hold(self, source["on_funding_rate"], settled)

    def on_order_event(self, event):
        journal("order", strategy_id=str(event.strategy_id), **_event_fields(event))
        if source["on_order_event"]:
            return source["on_order_event"](self, event)

    def on_position_event(self, event):
        journal("position", strategy_id=str(event.strategy_id), **_event_fields(event))
        if source["on_position_event"]:
            return source["on_position_event"](self, event)

    callbacks = {**found, **held, "on_mark_price": on_mark_price, "on_funding_rate": on_funding_rate,
                 "on_order_event": on_order_event, "on_position_event": on_position_event}
    return {**{name: mutation(value) if callable(value) else value for name, value in callbacks.items()},
            "clock": property(_paper_clock), "_paper_release": _release}


FINDINGS: list[str] = []


def paper_class(loaded: LoadedStrategy) -> type:
    name = f"PaperExternal_{loaded.content_hash}_{loaded.entry_class}"
    if name not in globals():
        globals()[name] = type(name, (_PaperConfigured, loaded.strategy_class),
                               {"__module__": __name__, "_runner_warmup": loaded.warmup,
                                **paper_callbacks(loaded.strategy_class)})
    return globals()[name]


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
    uses_stop_loss: bool
    terms: dict  # instrument ID -> the market's terms at the run's market day (paper start's inputs/terms.json)


RECORDERS: list = []  # the node constructs the recorder from its importable configuration


class Recorder(DataActor):
    """Journals the live data and account; runs the stop sequence on the node's own thread."""

    def __new__(cls, config=None):
        return DataActor.__new__(cls)

    def __init__(self, config: RecorderConfig):
        super().__init__(None)
        self.instrument_ids = [InstrumentId.from_str(value) for value in config.instrument_ids]
        self.uses_stop_loss = config.uses_stop_loss
        self.terms = config.terms
        self.last_bar: dict[str, int] = {}
        self.marks: dict[str, tuple[int, Price]] = {}
        self.cadence: dict[str, Cadence] = {}
        self.minute: int | None = None
        self.gaps = protection.Gaps()  # position ID -> since when it exceeded its resting stops (engine.protection)
        self.settlements: list[dict] = []
        self.findings = FINDINGS
        self.stopping_since: float | None = None
        self.handle = None
        self.checked_account = False
        RECORDERS.append(self)

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
        journal("instrument_status", instrument_id=str(status.instrument_id), status=repr(status))

    @mutation
    def on_bar(self, bar):
        iid = str(bar.bar_type.instrument_id)
        missing = bar_gap(self.last_bar.get(iid), bar.ts_event)
        if missing:
            journal("data_gap", instrument_id=iid, missing_bars=missing, after_ts=self.last_bar[iid],
                    before_ts=bar.ts_event)
        self.last_bar[iid] = bar.ts_event
        late = time.time_ns() - (bar.ts_event + 1_000_000)
        if late > LATE_BAR_NS:
            journal("late_bar", instrument_id=iid, ts_event=bar.ts_event, late_ns=late)
        journal("bar", instrument_id=iid, ts_event=bar.ts_event, open=str(bar.open), high=str(bar.high),
                low=str(bar.low), close=str(bar.close), volume=str(bar.volume), ts_init=bar.ts_init)
        if not self.checked_account:
            self._check_account()

    @mutation
    def on_mark_price(self, update):
        iid = str(update.instrument_id)
        self.marks[iid] = (update.ts_event, update.value)
        minute = update.ts_event // MINUTE_NS
        if self.minute is None or minute > self.minute:
            if self.minute is not None:
                self._snapshot()
            self.minute = minute

    @mutation
    def on_funding_rate(self, update):
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
        self.settlements.append(record)
        journal("funding_settlement", **record)

    def _check_terms(self) -> None:
        """TERMS_CHANGED: each loaded contract has the market's terms and the rates its leverage is set from."""
        for iid in self.instrument_ids:
            instrument = self.cache.instrument(iid)
            if instrument is None:
                changed = ["the loader gave no instrument"]
            else:
                changed = terms_changed(self.terms[str(iid)], {
                    "price_increment": instrument.price_increment, "size_increment": instrument.size_increment,
                    "min_notional": instrument.min_notional.as_decimal() if instrument.min_notional else None})
                changed += [f"{name}: {rate}, leverage set from {LOADER_MARGIN}" for name, rate in
                            (("margin_init", instrument.margin_init), ("margin_maint", instrument.margin_maint))
                            if Decimal(str(rate)) != LOADER_MARGIN]
            if changed:
                self.findings.append(f"TERMS_CHANGED: {iid}: {'; '.join(changed)}")
                journal("refusal", code="TERMS_CHANGED", instrument_id=str(iid), changed=changed)
                request_stop("TERMS_CHANGED")

    def _check_account(self) -> None:
        account = self.cache.account_for_venue(Venue(VENUE))
        if account is None:
            return
        self.checked_account = True
        if "SANDBOX" not in str(account.id):
            self.findings.append(f"PAPER_EXEC_CLIENT_NOT_SANDBOX: the account is {account.id}")
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
        if self.uses_stop_loss:
            self._protection()
        if SESSION and not SESSION.ready and time.monotonic() >= SESSION.restore_deadline and not STOP.is_set():
            checkpoint.dirty(SESSION.backend.output)
            journal("refusal", code="PAPER_RECOVERY_UNAVAILABLE", reason="native initialization did not complete")
            request_stop("PAPER_RECOVERY_UNAVAILABLE")
        found = strategy_runtime.breaches()
        if found is not None and not STOP.is_set():
            code, subscriptions = found
            self.findings.append(f"{code}: " + "; ".join(subscriptions))
            journal("refusal", code=code, subscriptions=subscriptions)
            request_stop(code)
            return  # the next tick runs the stop sequence
        if not STOP.is_set():
            if SESSION:
                SESSION.try_cut(self.cache)
            return
        open_orders = self.cache.orders_open()
        if self.stopping_since is None:
            self.stopping_since = time.monotonic()
            journal("stop_requested", reason=STOP_REASON[0] if STOP_REASON else None, open_orders=len(open_orders))
            if not pausing():
                for iid, strategy in strategy_runtime.STRATEGIES.items():
                    strategy.cancel_all_orders(InstrumentId.from_str(iid))
            return
        pending = any(strategy._paper_held for strategy in strategy_runtime.STRATEGIES.values()) if pausing() else open_orders
        if self.handle is None or pending and time.monotonic() - self.stopping_since < STOP_CANCEL_SECONDS:
            return
        if pausing() and SESSION:
            SESSION.before_stop(self.cache)
        journal("stopping", open_orders=len(open_orders))
        self.handle.stop()
        self.handle = None


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


def plan(symbols: list[str], membership: dict, start_ns: int, warm_at: int, months: Path | None = None) -> list:
    """The instances: each contract in the universe at the input start, with its membership from there to the end
    of that month and, month by month after it, from the host's month files in `months` (Membership)."""
    planned = []
    end = month_end_ns(start_ns)
    for symbol in symbols:
        intervals = [(max(low, start_ns), min(high, end)) for low, high in episode_membership(membership[symbol], None)
                     if high > start_ns and low < end]
        if not any(low <= start_ns < high for low, high in intervals):
            raise Refusal("PAPER_NOT_IN_UNIVERSE", f"{symbol}: the universe does not hold it at the input start "
                                                   f"{utc_text(start_ns)}")
        planned.append(PaperInputs(instrument_id(symbol), start_ns, start_ns, strategy_id(symbol),
                                   Membership(symbol, intervals, end, months), warm_at))
    return planned


MONTHS = "membership"  # beside the universe file: the host's month files (paper.runs.write_months)
NOW = time.time_ns  # the instant a membership is read at (a test sets it)


def month_end_ns(at_ns: int) -> int:
    """The first instant of the UTC month after the one holding `at_ns`."""
    moment = datetime.fromtimestamp(at_ns // 10**9, UTC)
    following = date(moment.year + moment.month // 12, moment.month % 12 + 1, 1)
    return int(datetime(following.year, following.month, 1, tzinfo=UTC).timestamp()) * 10**9


class Membership(Sequence):
    """A Paper contract's `universe_membership`: [start_ns, end_ns) intervals that grow while the run goes on (coverage
    U9). The universe file gives the input start's month; each later month comes from the host's
    `membership/<YYYY-MM>.json` ({"members": [symbol, ...]}), read when the source or the order rule first looks
    after the month began. Until that file is there the contract is no member (reduce-only) and the journal says
    so once (PAPER_MEMBERSHIP_STALE); a copy taken earlier keeps the months it held."""

    def __init__(self, symbol: str, intervals, known_until_ns: int, months: Path | None):
        self.symbol, self.known_until_ns, self._months = symbol, known_until_ns, months
        self._intervals = [tuple(interval) for interval in intervals]
        self._stale: set[str] = set()

    def _refresh(self) -> None:
        while self._months is not None and NOW() >= self.known_until_ns:
            month = datetime.fromtimestamp(self.known_until_ns // 10**9, UTC).strftime("%Y-%m")
            path = self._months / f"{month}.json"
            try:
                data = path.read_bytes()
            except FileNotFoundError:
                if month not in self._stale:
                    self._stale.add(month)
                    journal("membership_stale", code="PAPER_MEMBERSHIP_STALE", symbol=self.symbol, month=month)
                return
            try:
                members = json.loads(data)["members"]
                if not isinstance(members, list) or not all(isinstance(member, str) for member in members):
                    raise ValueError("members is not a list of symbols")
            except (ValueError, KeyError, TypeError) as exc:
                raise Refusal("UNIVERSE_FILE_INVALID", f"{path}: {exc}") from exc
            end = month_end_ns(self.known_until_ns)
            member = self.symbol in members
            if member and self._intervals and self._intervals[-1][1] == self.known_until_ns:
                self._intervals[-1] = (self._intervals[-1][0], end)
            elif member:
                self._intervals.append((self.known_until_ns, end))
            journal("membership", symbol=self.symbol, month=month, member=member,
                    sha256=hashlib.sha256(data).hexdigest())
            self.known_until_ns = end

    def __getitem__(self, index):
        self._refresh()
        return self._intervals[index]

    def __len__(self) -> int:
        self._refresh()
        return len(self._intervals)

    def __iter__(self):
        self._refresh()
        return iter(tuple(self._intervals))

    def __repr__(self) -> str:
        return f"Membership({self.symbol}, {self._intervals!r})"

    def member_at(self, at_ns: int) -> bool:
        return any(low <= at_ns < high for low, high in self)


def build_node(planned: list[PaperInputs], loaded: LoadedStrategy, uses_stop_loss: bool, proxy_url: str | None,
               fees: tuple[Decimal, Decimal], catalog: Path, leverage: str, terms: dict,
               session: Session | None = None):
    account = ACCOUNT_CONTRACT
    usdt = Currency.from_str(account["base_currency"])
    builder = LiveNode.builder("paper", TraderId(account["trader_id"]), Environment.SANDBOX)
    data = LiveDataEngineConfig(
        time_bars_timestamp_on_close=account["time_bars_timestamp_on_close"],
        time_bars_skip_first_non_full_bar=account["time_bars_skip_first_non_full_bar"],
        validate_data_sequence=account["validate_data_sequence"], time_bars_build_delay=history.BUILD_DELAY_US)
    balance = Money(Decimal(account["starting_balance_usdt"]), usdt)  # type: ignore[arg-type]
    # The warm-ups are requested from the run's Catalog, which they fill at T (engine.history).
    builder = builder.from_config("paper", LiveNodeConfig(
        environment=Environment.SANDBOX, trader_id=TraderId(account["trader_id"]), data_engine=data,
        catalogs=[DataCatalogConfig(path=str(catalog))]))
    builder.with_cache_config(CacheConfig(use_instance_id=False, bar_capacity=history.bar_capacity(loaded.warmup)))
    if session:
        session.expected_starts = len(planned) + 1
        builder.with_cache_database_factory(session.backend.config).with_load_state(bool(session.saved))
        # Strategy hook state belongs to the same frozen native FIFO marker as this journal cut.
        # A second, independently saved strategy state would not define the same cut.
        builder.with_save_state(False)
        accounts = session.backend.accounts()
        if accounts:
            if len(accounts) != 1 or not (session.saved or {}).get("sources"):
                raise checkpoint.fail("native accounts and checkpoint strategy state disagree")
            original = next(iter(accounts.values()))
            if "SANDBOX" not in str(original.id):
                raise checkpoint.fail("the checkpoint account is not a Sandbox account")
            balance = original.balance_total(usdt)
        elif (session.saved or {}).get("sources"):
            raise checkpoint.fail("the checkpoint strategy state has no native account")
    builder.with_logging(LoggerConfig(stdout_level=LogLevel.WARNING, print_config=False))
    builder.with_reconciliation(bool(session))
    builder.with_data_engine_config(data)
    builder.with_risk_engine_config(LiveRiskEngineConfig(max_order_submit_rate=account["max_order_submit_rate"]))
    builder.add_data_client(VENUE, BinanceDataClientFactory(), BinanceDataClientConfig(
        product_type=BinanceProductType.USD_M, environment=BinanceEnvironment.LIVE, api_key=None, api_secret=None,
        proxy_url=proxy_url,
        instrument_provider=BinanceInstrumentProviderConfig(load_all=False,
                                                            load_ids=[item.instrument_id for item in planned])))
    builder.add_simulated_exec_client(VENUE, SandboxExecutionClientFactory(), SandboxExecutionClientConfig(
        venue=Venue(VENUE), starting_balances=[balance],
        base_currency=usdt, oms_type=getattr(OmsType, account["oms_type"]),
        account_type=getattr(AccountType, account["account_type"]), default_leverage=Decimal(leverage) * LOADER_MARGIN,
        book_type=getattr(BookType, account["book_type"]), bar_execution=account["bar_execution"],
        bar_adaptive_high_low_ordering=account["bar_adaptive_high_low_ordering"],
        reject_stop_orders=account["reject_stop_orders"], support_gtd_orders=account["support_gtd_orders"],
        support_contingent_orders=account["support_contingent_orders"], fill_model=fill_model(account),
        fee_model=MakerTakerFeeModel(*fees)))
    node = builder.build()
    for inputs in planned:
        node.add_strategy(strategy_runtime.configure_strategy(loaded, inputs, paper_class))
    node.add_actor(history.WarmupActor(history.WarmupActorConfig(live=True)))
    node.add_actor_from_config(ImportableActorConfig("engine.paper:Recorder", "engine.paper:RecorderConfig",
                                                     {"instrument_ids": [item.instrument_id for item in planned],
                                                      "uses_stop_loss": uses_stop_loss, "terms": terms}))
    return node


def summary(args, loaded: LoadedStrategy, planned: list[PaperInputs], recorder: Recorder, node, started_ns: int) -> dict:
    cache = node.cache
    usdt = Currency.from_str(ACCOUNT_CONTRACT["base_currency"])
    account = cache.account_for_venue(Venue(VENUE))
    denied = any(str(order.status).endswith(("DENIED", "REJECTED")) for order in cache.orders())
    instances = {}
    for inputs in planned:
        strategy = strategy_runtime.STRATEGIES.get(inputs.instrument_id)
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
        "warmup": {inputs.instrument_id: {period: warmup_digest(bars) for period, bars in
                                          history.STATES.get(inputs.strategy_id, {}).get("delivered", {}).items()}
                   for inputs in planned},
        "balance_total": str(account.balance_total(usdt)) if account else None,
        "positions_at_stop": positions,
        "orders_open_at_stop": [str(order.client_order_id) for order in cache.orders_open()],
        "orders_denied_or_rejected": denied, "funding_settlements": recorder.settlements,
        "findings": recorder.findings, "limitations": list(LIMITATIONS),
    }


REPORTS = "reports"


def write_native_reports(output: Path, cache) -> None:
    """``<output>/reports/``: the native cache's orders, fills, positions and account reports and its order events,
    as a replay writes them (engine.write_reports, engine.write_order_events), replaced whole: an earlier end's are
    removed first, so a failed write leaves none. A recovered run's cache holds the whole run, so the latest end's
    reports do."""
    import pandas as pd
    from nautilus_trader.analysis import ReportProvider
    from engine.report import ORDER_EVENTS, write_order_events, write_reports
    partial = output / f".{REPORTS}.partial"
    shutil.rmtree(output / REPORTS, ignore_errors=True)
    shutil.rmtree(partial, ignore_errors=True)
    partial.mkdir()
    orders, account = cache.orders(), cache.account_for_venue(Venue(VENUE))
    write_reports(partial, cache, ReportProvider.generate_orders_report(orders),
                  ReportProvider.generate_fills_report(orders),
                  ReportProvider.generate_positions_report(cache.positions(), cache.position_snapshots()),
                  ReportProvider.generate_account_report(account) if account is not None else pd.DataFrame())
    write_order_events(orders, partial / ORDER_EVENTS)
    os.replace(partial, output / REPORTS)


def main(argv: list[str] | None = None) -> None:
    found = credential_names(os.environ)
    if found:
        raise Refusal("PAPER_CREDENTIALS_PRESENT", "exchange credential variables are in the environment: " +
                      ", ".join(found) + "; start the runner with an allowlisted environment")
    args = parse(argv)
    with Signals(request_stop):
        _main(args)


def _main(args) -> None:
    global JOURNAL, SESSION
    strategy_runtime.clear_failures()
    strategy_runtime.FAILURE_PATH = args.output / "runtime_failures.jsonl"
    loaded = load_strategy(args.strategy_file, args.strategy_class, args.strategy_sha256)
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
    JOURNAL = Journal(args.output)
    catalog = Path(tempfile.mkdtemp(prefix="paper-warmup-"))
    try:
        SESSION = Session(backend, JOURNAL, loaded, saved, started_ns, start_ns, warm_at) if backend else None
        if SESSION:
            checkpoint.dirty(args.output)
        if saved:
            assert backend is not None
            # Preserve per-attempt originals before the conventional latest files are replaced.
            for name in ("summary.json", "runtime_failures.jsonl"):
                path = args.output / name
                if path.is_file():
                    data = path.read_bytes()
                    target = backend.root / "attempts" / f"{hashlib.sha256(data).hexdigest()}.{name}"
                    if not target.exists():
                        checkpoint.atomic(target, data)
            journal("resumed", execution=EXECUTION)
        else:
            journal("started", symbols=args.symbols, input_start_ns=start_ns, execution=EXECUTION,
                    **strategy_metadata(loaded))
            journal("waiting", until_ns=start_ns)
        planned = plan(list(args.symbols), membership, start_ns, warm_at, args.universe.parent / MONTHS)
        FETCH[:] = [functools.partial(history.fetch, catalog=catalog, proxy_url=args.proxy_url)]
        strategy_runtime.STRATEGIES.clear()
        for served in strategy_runtime.SERVED.values():
            served.clear()
        strategy_runtime.BREACHES.clear()
        strategy_runtime.DECLARED.clear()
        order_rules.WARMING.clear()
        history.clear()
        RECORDERS.clear()
        FINDINGS.clear()
        market_terms = json.loads(args.terms.read_bytes())
        node = build_node(planned, loaded, getattr(loaded.strategy_class, "USES_STOP_LOSS", True), args.proxy_url,
                          (args.maker_fee, args.taker_fee), catalog, args.leverage,
                          {instrument_id(symbol): market_terms[symbol] for symbol in args.symbols}, SESSION)
        if len(RECORDERS) != 1:
            raise Refusal("NATIVE_EXECUTION_FAILED", "the paper recorder was not constructed exactly once")
        recorder = RECORDERS[0]
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
                    strategy_runtime.write_failures()
                    written = total
                STOP.wait(1)

        threading.Thread(target=watch, daemon=True).start()
        try:
            node.run()
        finally:
            if SESSION:
                checkpoint.dirty(args.output)
            result = summary(args, loaded, planned, recorder, node, started_ns)
            result["runtime_failures"] = len(strategy_runtime.FAILURES)
            if strategy_runtime.FAILURES:
                strategy_runtime.write_failures()
            checkpoint.atomic(args.output / "summary.json",
                              json.dumps(result, default=str, indent=2, sort_keys=True).encode())
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
        FETCH.clear()
        shutil.rmtree(catalog, ignore_errors=True)


if __name__ == "__main__":
    from engine.paper import main as paper_main
    try:
        paper_main()
    except Refusal as refusal:
        print(json.dumps({"refused": refusal.code, "message": str(refusal)}), file=sys.stderr)
        sys.exit(2)
