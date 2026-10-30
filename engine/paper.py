"""Paper trading: run one complete strategy on live Binance public market data with Nautilus's simulated fills.

The user authorized this on 2026-10-25 for public market data only, with no credential of any kind and only
the Sandbox execution client (docs/plans/paper-trading-design.zh.md). Nothing here can reach an account:

- the node gets one data client (Binance USD-M public data, no key) and one simulated execution client;
- the runner refuses to start while any exchange credential variable is in its environment
  (PAPER_CREDENTIALS_PRESENT), and refuses the run once the account it trades is not the Sandbox's
  (PAPER_EXEC_CLIENT_NOT_SANDBOX).

The strategy is the replay's: the same source file, entry class and hash, constructed with the same inputs
(``engine.run`` builds the same class around it and guards its callbacks). The account is ``ACCOUNT_CONTRACT``'s,
in the execution environment ``paper-bars``. The live feed differs from the replay's input in ways the runner
corrects where it can:

- MARK updates arrive every second; the strategy gets the first of each minute, as the replay gives one per
  minute.
- Funding estimates arrive every second; the strategy gets one update per settlement, stamped at the
  settlement, as the replay does.
- An instance's data starts at the next minute (or, for a DAILY_WARMUP source, at the next 00:00 UTC, with its
  daily warm-up read from Binance's public daily klines).
- Aggregated bars skip the first incomplete one.
- No trades are streamed (orders match bars, so a mid-bar trade signal would see the bar's end); a strategy
  subscribing to trades stops the run with ``TRADES_NOT_SERVED``.
- The Sandbox matches a bar before the strategy sees it, as a replay's exchange does, but its fills reach the
  cache on the live runner's execution channel, after the bar's dispatch. The strategy's data callbacks
  therefore run HOLD_NS later, in the order they came, once the fills the bar caused are applied: a stop or
  target filled on a bar is closed when the strategy's ``on_bar`` for it runs, as in the replay.

The Sandbox matches with the replay's terms: its fill model, book type and bar ordering, and the maker and
taker rates the run is given (``--maker-fee``, ``--taker-fee``: the market's assumed rates, which a replay
reads from its export receipts).

Its own record is ``<output>/events.jsonl``: bars, data gaps, socket state, orders, positions, funding
settlements, the account totals once a minute and protection gaps. ``<output>/state.json`` holds the latest
totals with the open positions and orders, and ``<output>/summary.json`` is written at the end. Sandbox
settles no funding (native probe, 2026-10-25), so the journal records each settlement with the positions it
applies to, and the sealing step accounts for it.

Stopping (SIGTERM, SIGINT, ``<output>/STOP`` or ``--duration-seconds``) cancels every working order, waits up to
STOP_CANCEL_SECONDS for the cancels, then stops the node. Positions stay open and are valued at their latest
MARK in the summary.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import re
import signal
import sys
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from nautilus_trader.adapters.binance import (
    BinanceDataClientConfig, BinanceDataClientFactory, BinanceEnvironment, BinanceInstrumentProviderConfig,
    BinanceProductType,
)
from nautilus_trader.adapters.sandbox import SandboxExecutionClientConfig, SandboxExecutionClientFactory
from nautilus_trader.common import DataActor, Environment, ImportableActorConfig, LoggerConfig
from nautilus_trader.execution import MakerTakerFeeModel
from nautilus_trader.live import LiveDataEngineConfig, LiveNode, LiveRiskEngineConfig
from nautilus_trader.model import (
    AccountType, Bar, BarType, BookType, Currency, FundingRateUpdate, InstrumentId, Money, OmsType, Price, Quantity,
    StrategyId, TraderId, Venue,
)
from nautilus_trader.trading import Strategy

from engine import run
from engine.config import ACCOUNT_CONTRACT, MINUTE_NS, Refusal, runtime_source_metadata, utc_text
from engine.load import (
    DAY_NS, WARMUP_DAYS, LoadedStrategy, diagnostics, episode_membership, load_strategy, read_universe,
    strategy_id, strategy_metadata,
)

EXECUTION = "paper-bars"
VENUE = ACCOUNT_CONTRACT["venue"]
REST_BASE = "https://fapi.binance.com"
LATE_BAR_NS = 2_000_000_000  # a bar arriving later than this after its close is a late-bar event
STOP_CANCEL_SECONDS = 10
# How long the strategy's data callbacks wait for the execution events their data caused. Those are queued
# before the data's dispatch returns and the live runner polls them ahead of data; they take milliseconds.
HOLD_NS = 100_000_000
DAILY_KLINE_LIMIT = 1500  # Binance's maximum per request; WARMUP_DAYS fits in one
LIMITATIONS = (
    "paper-bars: Sandbox settles no funding; events.jsonl records each settlement with the positions it applies "
    "to, for the sealing step",
    "paper-bars: aggregated bars skip the first incomplete one (the replay's are complete from its aligned start)",
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


def input_start(now_ns: int, daily_warmup: bool) -> int:
    """engine.paper.input_start: the next minute, or the next 00:00 UTC for a DAILY_WARMUP source (its warm-up
    must end 1 ms before its input starts, and its daily aggregation must begin at a day's start)."""
    unit = DAY_NS if daily_warmup else MINUTE_NS
    return (now_ns // unit + 1) * unit


# The live feed brought to the replay's cadence (one MARK a minute, one funding update per settlement)

@dataclass
class Cadence:
    """Per strategy instance: which live MARK and funding updates the strategy sees."""
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


# The daily warm-up from Binance's public klines (a DAILY_WARMUP source)

def _get_json(url: str, proxy_url: str | None):
    handlers = [urllib.request.ProxyHandler({"https": proxy_url, "http": proxy_url} if proxy_url else {})]
    with urllib.request.build_opener(*handlers).open(url, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def _decimals(step: str) -> int:
    exponent = Decimal(step).normalize().as_tuple().exponent
    return max(0, -exponent) if isinstance(exponent, int) else 0


def rest_terms(symbols: list[str], proxy_url: str | None, fetch=_get_json) -> dict[str, tuple[int, int]]:
    """(price precision, size precision) of each contract, from its exchange tick and step sizes."""
    info = fetch(f"{REST_BASE}/fapi/v1/exchangeInfo", proxy_url)
    found = {}
    for item in info.get("symbols", []):
        if item.get("symbol") in symbols:
            filters = {entry.get("filterType"): entry for entry in item.get("filters", [])}
            found[item["symbol"]] = (_decimals(filters["PRICE_FILTER"]["tickSize"]),
                                     _decimals(filters["LOT_SIZE"]["stepSize"]))
    missing = sorted(set(symbols) - set(found))
    if missing:
        raise Refusal("PAPER_INSTRUMENT_UNKNOWN", f"Binance lists no USD-M contract {', '.join(missing)}")
    return found


def daily_warmup(symbol: str, start_ns: int, precisions: tuple[int, int], proxy_url: str | None,
                 fetch=_get_json) -> list[Bar]:
    """engine.paper.daily_warmup: the unbroken run of closed daily bars ending 1 ms before `start_ns`, as
    engine.load.warmup_daily_bars gives a replay (``{id}-1-DAY-LAST-EXTERNAL``, stamped at close); at least
    WARMUP_DAYS."""
    rows = fetch(f"{REST_BASE}/fapi/v1/klines?symbol={symbol}&interval=1d&limit={DAILY_KLINE_LIMIT}"
                 f"&endTime={start_ns // 1_000_000 - 1}", proxy_url)
    bar_type = BarType.from_str(f"{instrument_id(symbol)}-1-DAY-LAST-EXTERNAL")
    price, size = precisions
    bars = []
    for row in rows:
        close_ns = int(row[6]) * 1_000_000
        if close_ns >= start_ns:
            continue
        o, h, low, c = (Price.from_str(f"{Decimal(value):.{price}f}") for value in row[1:5])
        bars.append(Bar(bar_type, o, h, low, c, Quantity.from_str(f"{Decimal(row[5]):.{size}f}"), close_ns, close_ns))
    if not bars or bars[-1].ts_event != start_ns - 1_000_000:
        raise Refusal("WARMUP_NOT_ADJACENT", f"{symbol}: no daily kline closes 1 ms before the input start")
    first = len(bars) - 1
    while first > 0 and bars[first].ts_event - bars[first - 1].ts_event == DAY_NS:
        first -= 1
    if len(bars) - first < WARMUP_DAYS:
        raise Refusal("WARMUP_INSUFFICIENT", f"{symbol}: {len(bars) - first} contiguous daily klines end at the "
                                             f"input start, {WARMUP_DAYS} are needed")
    return bars[first:]


def warmup_digest(bars: list[Bar]) -> dict:
    """What the sealing step checks against the market database's daily bars."""
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


JOURNAL: Journal | None = None


def journal(kind: str, **fields) -> None:
    if JOURNAL is not None:
        JOURNAL.write(kind, **fields)


def bar_gap(previous_ns: int | None, ts_event: int) -> int:
    """engine.paper.bar_gap: the one-minute bars missing between two consecutive bars' close stamps."""
    if previous_ns is None:
        return 0
    return max(0, (ts_event - previous_ns) // MINUTE_NS - 1)


# The strategy: the replay's class around the source, with the live cadence and the journal

class _PaperConfigured(run._TradeSubscriptions):
    """Construct the source's entry class from the paper runner's inputs (engine.run._Configured's arguments).
    Paper trading streams no trades, so any trade subscription stops the run (TRADES_NOT_SERVED): its orders
    would match the bars, as a replay's in the bar environment."""

    def __new__(cls, inputs: PaperInputs):
        return Strategy.__new__(cls)

    def __init__(self, inputs: PaperInputs):
        iid = InstrumentId.from_str(inputs.instrument_id)
        super().__init__(  # type: ignore[call-arg]
            iid,
            BarType.from_str(f"{iid}-1-DAY-LAST-INTERNAL"),
            trade_start_ns=inputs.trade_start_ns,
            historical_daily_bars=list(inputs.historical_daily_bars),
            execution_bar_minutes=run.EXECUTION_BAR_MINUTES,
            strategy_id=StrategyId(inputs.strategy_id),
            universe_membership=tuple(tuple(interval) for interval in inputs.universe_membership),
        )
        self._replay_input_start_ns = inputs.input_start_ns
        self._paper_cadence = Cadence()
        self._paper_held: list = []  # data callbacks waiting for the fills their data caused
        run.STRATEGIES[inputs.instrument_id] = self  # type: ignore[assignment]


@dataclass
class PaperInputs:
    instrument_id: str
    trade_start_ns: int
    input_start_ns: int
    strategy_id: str
    universe_membership: list
    historical_daily_bars: list = field(default_factory=list)


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


def _release(self, _event=None) -> None:
    """Run the held data callbacks in the order they came. One that raises was recorded by its guard and
    does not stop the rest, as each ran on its own before."""
    held, self._paper_held = self._paper_held, []
    for callback, value in held:
        try:
            callback(self, value)
        except Exception:  # noqa: BLE001 (engine.run.execution_failure recorded it)
            pass


def _hold(self, callback, value) -> None:
    """Queue a data callback until HOLD_NS from now (see the module docstring)."""
    self._paper_held.append((callback, value))
    if len(self._paper_held) == 1:
        clock = Strategy.clock.__get__(self, type(self))
        clock.set_time_alert_ns(f"paper-hold-{id(self)}", clock.timestamp_ns() + HOLD_NS, self._paper_release)


def paper_callbacks(strategy_class: type) -> dict:
    """engine.run.guarded_callbacks, with MARK and funding at the replay's cadence, every data callback run once
    the fills its data caused are applied, and every order and position event journalled before the source
    sees it."""
    found = run.guarded_callbacks(strategy_class)
    source = {name: found.get(name) for name in ("on_mark_price", "on_funding_rate", "on_order_event",
                                                 "on_position_event")}
    held = {name: (lambda callback: lambda self, value: _hold(self, callback, value))(found[name])
            for name in run.DATA_CALLBACKS if found.get(name) and name not in ("on_mark_price", "on_funding_rate")}

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

    return {**found, **held, "on_mark_price": on_mark_price, "on_funding_rate": on_funding_rate,
            "on_order_event": on_order_event, "on_position_event": on_position_event, "_paper_release": _release}


FINDINGS: list[str] = []


def paper_class(loaded: LoadedStrategy) -> type:
    name = f"PaperExternal_{loaded.content_hash}_{loaded.entry_class}"
    if name not in globals():
        globals()[name] = type(name, (_PaperConfigured, loaded.strategy_class),
                               {"__module__": __name__, **paper_callbacks(loaded.strategy_class)})
    return globals()[name]


def configure_strategy(loaded: LoadedStrategy, inputs: PaperInputs) -> Strategy:
    try:
        return paper_class(loaded)(inputs)
    except Exception as exc:
        run.execution_failure("constructor", exc, None)
        raise Refusal("STRATEGY_CONSTRUCTION_FAILED", f"{inputs.instrument_id}: {type(exc).__name__}: {exc}") from exc


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


RECORDERS: list = []  # the node constructs the recorder from its importable configuration


class Recorder(DataActor):
    """Journals the live data and account; runs the stop sequence on the node's own thread."""

    def __new__(cls, config=None):
        return DataActor.__new__(cls)

    def __init__(self, config: RecorderConfig):
        super().__init__(None)
        self.instrument_ids = [InstrumentId.from_str(value) for value in config.instrument_ids]
        self.uses_stop_loss = config.uses_stop_loss
        self.last_bar: dict[str, int] = {}
        self.marks: dict[str, tuple[int, Price]] = {}
        self.cadence: dict[str, Cadence] = {}
        self.minute: int | None = None
        self.uncovered: dict[str, int] = {}  # instrument -> consecutive minutes a position exceeded its stops
        self.settlements: list[dict] = []
        self.findings = FINDINGS
        self.stopping_since: float | None = None
        self.handle = None
        self.checked_account = False
        RECORDERS.append(self)

    def on_start(self):
        for iid in self.instrument_ids:
            self.subscribe_bars(BarType.from_str(f"{iid}-1-MINUTE-LAST-EXTERNAL"))
            self.subscribe_mark_prices(iid)
            self.subscribe_funding_rates(iid)
            self.subscribe_instrument_status(iid)
        self.subscribe_socket_state()
        self.clock.set_timer("paper-stop", timedelta(seconds=1), callback=self.on_stop_timer)

    def on_socket_state(self, event):
        journal("socket", endpoint=event.endpoint, state=str(event.state), ts_event=event.ts_event)

    def on_instrument_status(self, status):
        journal("instrument_status", instrument_id=str(status.instrument_id), status=repr(status))

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
                low=str(bar.low), close=str(bar.close), volume=str(bar.volume))
        if not self.checked_account:
            self._check_account()

    def on_mark_price(self, update):
        iid = str(update.instrument_id)
        self.marks[iid] = (update.ts_event, update.value)
        minute = update.ts_event // MINUTE_NS
        if self.minute is None or minute > self.minute:
            if self.minute is not None:
                self._snapshot()
            self.minute = minute

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
        if self.uses_stop_loss:
            self._protection(positions)

    def _protection(self, positions: list[dict]) -> None:
        """A position larger than its accepted reduce-only stop orders on the closing side for more than one
        minute: the audit's rule, reported as it happens."""
        for item in positions:
            iid, held = item["instrument_id"], Decimal(item["signed_qty"])
            covered = sum((Decimal(str(order.quantity)) for order in self.cache.orders_open(
                instrument_id=InstrumentId.from_str(iid))
                if order.is_reduce_only and "STOP" in str(order.order_type)
                and (str(order.side).endswith("SELL") if held > 0 else str(order.side).endswith("BUY"))),
                Decimal(0))
            if covered < abs(held):
                self.uncovered[iid] = self.uncovered.get(iid, 0) + 1
                if self.uncovered[iid] == 2:
                    journal("protection_gap", instrument_id=iid, position=str(held), stop_quantity=str(covered))
            else:
                self.uncovered.pop(iid, None)

    def on_stop_timer(self, _event):
        if run.UNSERVED_TRADES and not STOP.is_set():
            self.findings.append("TRADES_NOT_SERVED: " + "; ".join(run.UNSERVED_TRADES))
            journal("refusal", code="TRADES_NOT_SERVED", subscriptions=list(run.UNSERVED_TRADES))
            request_stop("TRADES_NOT_SERVED")
            return  # the next tick runs the stop sequence
        if not STOP.is_set():
            return
        open_orders = self.cache.orders_open()
        if self.stopping_since is None:
            self.stopping_since = time.monotonic()
            journal("stop_requested", reason=STOP_REASON[0] if STOP_REASON else None, open_orders=len(open_orders))
            for iid, strategy in run.STRATEGIES.items():
                strategy.cancel_all_orders(InstrumentId.from_str(iid))
            return
        if self.handle is None or open_orders and time.monotonic() - self.stopping_since < STOP_CANCEL_SECONDS:
            return
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
    parser.add_argument("--proxy-url", help="the egress proxy that admits only Binance's public hosts")
    parser.add_argument("--duration-seconds", type=int, help="stop after this long (engineering trials)")
    return parser.parse_args(argv)


def plan(loaded: LoadedStrategy, symbols: list[str], membership: dict, start_ns: int, warmup: dict) -> list:
    """The instances: each contract in the universe at the input start, with its membership from there on."""
    planned = []
    for symbol in symbols:
        intervals = [[max(low, start_ns), high] for low, high in episode_membership(membership[symbol], None)
                     if high > start_ns]
        if not any(low <= start_ns < high for low, high in intervals):
            raise Refusal("PAPER_NOT_IN_UNIVERSE", f"{symbol}: the universe does not hold it at the input start "
                                                   f"{utc_text(start_ns)}")
        planned.append(PaperInputs(instrument_id(symbol), start_ns, start_ns, strategy_id(symbol), intervals,
                                   warmup.get(symbol, [])))
    return planned


def build_node(planned: list[PaperInputs], loaded: LoadedStrategy, uses_stop_loss: bool, proxy_url: str | None,
               fees: tuple[Decimal, Decimal]):
    account = ACCOUNT_CONTRACT
    usdt = Currency.from_str(account["base_currency"])
    builder = LiveNode.builder("paper", TraderId(account["trader_id"]), Environment.SANDBOX)
    builder.with_logging(LoggerConfig(stdout_level=run.LogLevel.WARNING, print_config=False))
    builder.with_reconciliation(False)
    builder.with_data_engine_config(LiveDataEngineConfig(
        time_bars_timestamp_on_close=account["time_bars_timestamp_on_close"],
        time_bars_skip_first_non_full_bar=True, validate_data_sequence=account["validate_data_sequence"]))
    builder.with_risk_engine_config(LiveRiskEngineConfig(max_order_submit_rate=account["max_order_submit_rate"]))
    builder.add_data_client(VENUE, BinanceDataClientFactory(), BinanceDataClientConfig(
        product_type=BinanceProductType.USD_M, environment=BinanceEnvironment.LIVE, api_key=None, api_secret=None,
        proxy_url=proxy_url,
        instrument_provider=BinanceInstrumentProviderConfig(load_all=False,
                                                            load_ids=[item.instrument_id for item in planned])))
    builder.add_simulated_exec_client(VENUE, SandboxExecutionClientFactory(), SandboxExecutionClientConfig(
        venue=Venue(VENUE), starting_balances=[Money(Decimal(account["starting_balance_usdt"]), usdt)],  # type: ignore[arg-type]
        base_currency=usdt, oms_type=getattr(OmsType, account["oms_type"]),
        account_type=getattr(AccountType, account["account_type"]), default_leverage=Decimal(account["default_leverage"]),
        book_type=getattr(BookType, account["book_type"]), bar_execution=account["bar_execution"],
        bar_adaptive_high_low_ordering=account["bar_adaptive_high_low_ordering"],
        reject_stop_orders=account["reject_stop_orders"], support_gtd_orders=account["support_gtd_orders"],
        support_contingent_orders=account["support_contingent_orders"], fill_model=run.fill_model(account),
        fee_model=MakerTakerFeeModel(*fees)))
    node = builder.build()
    for inputs in planned:
        node.add_strategy(configure_strategy(loaded, inputs))
    node.add_actor_from_config(ImportableActorConfig("engine.paper:Recorder", "engine.paper:RecorderConfig",
                                                     {"instrument_ids": [item.instrument_id for item in planned],
                                                      "uses_stop_loss": uses_stop_loss}))
    return node


def summary(args, loaded: LoadedStrategy, planned: list[PaperInputs], recorder: Recorder, node, started_ns: int,
            warmup: dict) -> dict:
    cache = node.cache
    usdt = Currency.from_str(ACCOUNT_CONTRACT["base_currency"])
    account = cache.account_for_venue(Venue(VENUE))
    denied = any(str(order.status).endswith(("DENIED", "REJECTED")) for order in cache.orders())
    instances = {}
    for inputs in planned:
        strategy = run.STRATEGIES.get(inputs.instrument_id)
        found = None
        try:
            found = strategy.replay_integrity_findings(denied) if strategy is not None else None  # type: ignore[attr-defined]
        except Exception as exc:
            run.execution_failure("replay_integrity_findings", exc, strategy)
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
        "account": dict(ACCOUNT_CONTRACT, execution=EXECUTION),
        "fees": {"maker": str(args.maker_fee), "taker": str(args.taker_fee)},
        "symbols": args.symbols, "started_ns": started_ns, "stopped_ns": time.time_ns(),
        "stop_reason": STOP_REASON[0] if STOP_REASON else "node_stopped",
        "instances": instances, "warmup": {symbol: warmup_digest(bars) for symbol, bars in warmup.items()},
        "balance_total": str(account.balance_total(usdt)) if account else None,
        "positions_at_stop": positions,
        "orders_open_at_stop": [str(order.client_order_id) for order in cache.orders_open()],
        "orders_denied_or_rejected": denied, "funding_settlements": recorder.settlements,
        "findings": recorder.findings, "limitations": list(LIMITATIONS),
    }


def main(argv: list[str] | None = None) -> None:
    global JOURNAL
    found = credential_names(os.environ)
    if found:
        raise Refusal("PAPER_CREDENTIALS_PRESENT", "exchange credential variables are in the environment: " +
                      ", ".join(found) + "; start the runner with an allowlisted environment")
    args = parse(argv)
    run.clear_failures()
    run.FAILURE_PATH = args.output / "runtime_failures.jsonl"
    JOURNAL = Journal(args.output)
    loaded = load_strategy(args.strategy_file, args.strategy_class, args.strategy_sha256)
    membership = read_universe(args.universe, list(args.symbols))
    started_ns = time.time_ns()
    start_ns = input_start(started_ns, loaded.daily_warmup)
    journal("started", symbols=args.symbols, input_start_ns=start_ns, execution=EXECUTION,
            daily_warmup=loaded.daily_warmup, **strategy_metadata(loaded))
    for name in ("SIGTERM", "SIGINT"):
        signal.signal(getattr(signal, name), lambda *_, name=name: request_stop(name))
    warmup: dict[str, list] = {}
    if loaded.daily_warmup:
        journal("waiting", until_ns=start_ns)
        while time.time_ns() < start_ns + 5_000_000_000:  # the day's kline is final a moment after it closes
            if (args.output / "STOP").exists():
                request_stop("STOP_FILE")
            if STOP.wait(1):
                journal("stopped_before_start", reason=STOP_REASON[0])
                return
        terms = rest_terms(list(args.symbols), args.proxy_url)
        warmup = {symbol: daily_warmup(symbol, start_ns, terms[symbol], args.proxy_url) for symbol in args.symbols}
    planned = plan(loaded, list(args.symbols), membership, start_ns, warmup)
    run.STRATEGIES.clear()
    run.SERVED_TRADES.clear()
    run.UNSERVED_TRADES.clear()
    RECORDERS.clear()
    FINDINGS.clear()
    node = build_node(planned, loaded, getattr(loaded.strategy_class, "USES_STOP_LOSS", True), args.proxy_url,
                      (args.maker_fee, args.taker_fee))
    if len(RECORDERS) != 1:
        raise Refusal("NATIVE_EXECUTION_FAILED", "the paper recorder was not constructed exactly once")
    recorder = RECORDERS[0]
    recorder.handle = node.handle()

    def watch():
        deadline = None if args.duration_seconds is None else time.monotonic() + args.duration_seconds
        while not STOP.is_set():
            if (args.output / "STOP").exists():
                request_stop("STOP_FILE")
            elif deadline is not None and time.monotonic() >= deadline:
                request_stop("DURATION")
            STOP.wait(1)

    threading.Thread(target=watch, daemon=True).start()
    try:
        node.run()
    finally:
        result = summary(args, loaded, planned, recorder, node, started_ns, warmup)
        result["runtime_failures"] = len(run.FAILURES)
        if run.FAILURES:
            run.write_failures()
        (args.output / "summary.json").write_text(json.dumps(result, default=str, indent=2, sort_keys=True),
                                                  encoding="utf-8")
        journal("summary_written", stop_reason=result["stop_reason"])
        JOURNAL.close()


if __name__ == "__main__":
    from engine.paper import main as paper_main
    try:
        paper_main()
    except Refusal as refusal:
        print(json.dumps({"refused": refusal.code, "message": str(refusal)}), file=sys.stderr)
        sys.exit(2)
