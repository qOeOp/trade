"""The streamed replay equals BacktestNode on the same inputs: every event the strategy sees, every
order, fill, position, account row and exposure, with chunks of one event and session windows of six
hours over contracts with gaps, a non-ASCII name, funding stamped on a bar close and a settlement."""

import csv
import gzip
import hashlib
import json
import re
import tempfile
import unittest
from unittest.mock import patch
from decimal import Decimal
from pathlib import Path

import numpy as np
from nautilus_trader.model import (
    InstrumentClose, InstrumentCloseType, InstrumentId, InstrumentStatus, MarketStatusAction, Price,
)
from nautilus_trader.persistence import ParquetDataCatalog

from engine import run
from engine.config import ACCOUNT_CONTRACT, Refusal, execution_account, parse_window, utc_text
from engine.load import load_strategy, read_market, read_universe
from market import export, instrument, lifecycle


UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
MIN, DAY = 60_000, 86_400_000
START = 1_767_225_600_000  # 2026-01-01T00:00:00Z, ms
DAYS = 2
END = START + DAYS * DAY
TERMS = {"price_increment": "0.01", "size_increment": "0.001", "max_quantity": None, "min_quantity": None,
         "min_notional": None, "max_price": None, "min_price": None, "terms_source": "inferred", "observed_at": 0}
PROBE = '''
from datetime import timedelta
from decimal import Decimal
from nautilus_trader.model import BarType, OrderSide, OrderType, TimeInForce
from nautilus_trader.trading import Strategy, StrategyConfig


class Probe(Strategy):
    USES_STOP_LOSS = False

    def __init__(self, instrument_id, daily_bar_type, **kw):
        super().__init__(StrategyConfig(strategy_id=kw["strategy_id"]))
        self.iid, self.trade_start, self.n, self.seen = instrument_id, kw["trade_start_ns"], 0, []

    def on_start(self):
        self.minute = BarType.from_str(f"{self.iid}-1-MINUTE-LAST-EXTERNAL")
        self.quarter = BarType.from_str(f"{self.iid}-15-MINUTE-LAST-INTERNAL@1-MINUTE-EXTERNAL")
        self.subscribe_bars(self.minute)
        self.subscribe_bars(self.quarter)
        self.subscribe_mark_prices(self.iid)
        self.subscribe_funding_rates(self.iid)
        self.subscribe_instrument_status(self.iid)
        self.subscribe_instrument_close(self.iid)
        self.clock.set_timer(f"T-{self.iid}", timedelta(minutes=37, microseconds=13), callback=self.on_timer)

    def on_mark_price(self, mark):
        self.seen.append(("mark", mark.ts_event, str(mark.value), self.clock.timestamp_ns()))

    def on_funding_rate(self, funding):
        self.seen.append(("funding", funding.ts_event, str(funding.rate), self.clock.timestamp_ns()))

    def on_instrument_status(self, status):
        self.seen.append(("status", status.ts_event, status.action.name))

    def on_instrument_close(self, close):
        self.seen.append(("close", close.ts_event, str(close.close_price)))

    def on_order_event(self, event):
        self.seen.append(("order", type(event).__name__, event.ts_event))

    def on_timer(self, event):
        now = self.clock.timestamp_ns()
        self.seen.append(("timer", now))
        if now >= self.trade_start:
            held = self.cache.positions_open(instrument_id=self.iid, strategy_id=self.strategy_id)
            side = OrderSide.SELL if held and held[0].is_long else OrderSide.BUY
            self.submit_order(self.order_factory.market(self.iid, side, self.cache.instrument(self.iid).make_qty(
                Decimal("1.5"))))

    def on_bar(self, bar):
        self.seen.append(("bar", str(bar.bar_type), bar.ts_event, str(bar.close), self.clock.timestamp_ns()))
        if bar.ts_event < self.trade_start:
            return
        instrument = self.cache.instrument(self.iid)
        if bar.bar_type == self.quarter:
            close = bar.close.as_decimal()
            self.submit_order_list(self.order_factory.bracket(
                self.iid, OrderSide.BUY, instrument.make_qty(Decimal("2")), entry_order_type=OrderType.LIMIT,
                entry_price=instrument.make_price(close * Decimal("0.999")), time_in_force=TimeInForce.GTD,
                expire_time=bar.ts_event + 450_000_000_000, sl_trigger_price=instrument.make_price(close * Decimal("0.99")),
                tp_price=instrument.make_price(close * Decimal("1.004"))))
            return
        self.n += 1
        if self.n % 41 == 0:
            self.clock.set_time_alert_ns(f"A-{self.iid}-{self.n}", bar.ts_event + 90_000_000_007, self.on_timer)

    def replay_diagnostics(self):
        return {"bars": self.n}

    def replay_integrity_findings(self, orders_denied_or_rejected):
        return []
'''


AFTER_SETTLEMENT = '''
from datetime import timedelta
from decimal import Decimal
from nautilus_trader.model import OrderSide
from nautilus_trader.trading import Strategy, StrategyConfig


class AfterSettle(Strategy):
    """Trades nothing until its contract settled, then a round trip in each timer callback."""
    USES_STOP_LOSS = False

    def __init__(self, instrument_id, daily_bar_type, **kw):
        super().__init__(StrategyConfig(strategy_id=kw["strategy_id"]))
        self.iid, self.settled, self.trips = instrument_id, False, 0

    def on_start(self):
        self.subscribe_instrument_close(self.iid)
        self.clock.set_timer(f"T-{self.iid}", timedelta(minutes=37, microseconds=13), callback=self.on_t)

    def on_instrument_close(self, close):
        self.settled = True

    def on_t(self, event):
        if not self.settled or self.trips >= 5:
            return
        quantity = self.cache.instrument(self.iid).make_qty(Decimal("10"))
        self.submit_order(self.order_factory.market(self.iid, OrderSide.BUY, quantity))
        self.submit_order(self.order_factory.market(self.iid, OrderSide.SELL, quantity))
        self.trips += 1

    def replay_diagnostics(self):
        return {"trips": self.trips}

    def replay_integrity_findings(self, orders_denied_or_rejected):
        return []
'''


HOLD = '''
from decimal import Decimal
from nautilus_trader.model import BarType, OrderSide
from nautilus_trader.trading import Strategy, StrategyConfig


class Hold(Strategy):
    """Buys once at trade start and holds."""
    USES_STOP_LOSS = False

    def __init__(self, instrument_id, daily_bar_type, **kw):
        super().__init__(StrategyConfig(strategy_id=kw["strategy_id"]))
        self.iid, self.trade_start, self.done = instrument_id, kw["trade_start_ns"], False

    def on_start(self):
        self.subscribe_bars(BarType.from_str(f"{self.iid}-1-MINUTE-LAST-EXTERNAL"))

    def on_bar(self, bar):
        if not self.done and bar.ts_event >= self.trade_start:
            self.submit_order(self.order_factory.market(self.iid, OrderSide.BUY,
                                                        self.cache.instrument(self.iid).make_qty(Decimal("3"))))
            self.done = True

    def replay_diagnostics(self):
        return {}

    def replay_integrity_findings(self, orders_denied_or_rejected):
        return []
'''


def series(seed, minutes):
    rng = np.random.default_rng(seed)
    close = 10_000 + np.cumsum(rng.integers(-30, 31, len(minutes)))
    open_ = np.concatenate([[close[0]], close[:-1]])
    bars = {"ts_open": START + minutes * MIN, "open": open_, "close": close,
            "high": np.maximum(open_, close) + rng.integers(0, 20, len(minutes)),
            "low": np.minimum(open_, close) - rng.integers(0, 20, len(minutes))}
    bars = {name: (values.astype(np.int64) * 10**6 if name != "ts_open" else values) for name, values in bars.items()}
    bars["volume"] = np.full(len(minutes), 10**8, dtype=np.int64)
    return bars


def contract(root, symbol, minutes, funding, episode=None, seed=0, observed_at=0, quotes=False, margins=None,
             trades=False, metrics=False):
    """One contract's export as market.export_episode lays it out: an episode is piece 1 in episode-1/. With
    `quotes`, two best bid/ask states a minute (at the minute's low, then at its high); `margins` writes the
    instrument with those (initial, maintenance) rates, as the runner applies the quote environment's; with
    `trades`, three aggregate trades a minute at 1.00, far below every quote: two in the millisecond of the first
    quote, one ten seconds later; with `metrics`, every five-minute row the window shows, the account ratio
    empty except in every seventh."""
    index = 1 if episode is not None else None
    path = root / symbol
    catalog_path = path / "episode-1" if index else path
    catalog_path.mkdir(parents=True)
    store = ParquetDataCatalog(str(catalog_path))
    native = export.native_symbol(symbol, index)["instrument_id"]
    made = instrument.build_instrument(symbol, TERMS, 2, native, on_grid=True)[0]
    store.write_instruments([run.with_margins(made, margins) if margins else made])
    iid = InstrumentId.from_str(native)
    bars = series(seed, minutes)
    counts = {"last": export.write_bars(store, f"{iid}-1-MINUTE-LAST-EXTERNAL", bars, MIN, 2, 3, 8, 4),
              "mark": export.write_marks(store, iid, bars, MIN, 8, 8),
              "funding": export.write_funding(catalog_path, str(iid),
                                              [(at, Decimal("0.0001")) for at in sorted(funding)])}
    if quotes:
        tick = 10**6  # 0.01 at scale 8
        rows = []
        for at, low, high in zip(bars["ts_open"].tolist(), bars["low"].tolist(), bars["high"].tolist(), strict=True):
            rows += [(at + 20_000, low, low + tick), (at + 40_000, high - tick, high)]
        counts["quote"] = export.write_quotes(store, iid, [rows], 2, "1000", 3, 8)
    if trades:
        rows = [(at + offset, 3 * index + number, 10**8, 10**5, number % 2)
                for index, at in enumerate(bars["ts_open"].tolist())
                for number, offset in enumerate((20_000, 20_000, 30_000))]
        counts["trade"] = export.write_trades(store, iid, [rows], 2, 3)
    if metrics:
        stamps = range(START - 5 * MIN, END - export.METRICS_VISIBLE_MS, 5 * MIN)
        counts["metrics"] = export.write_metrics(catalog_path, str(iid), [
            (at, Decimal("1234.5") + number, Decimal("1.25"), Decimal("0.875"), None if number % 7 else Decimal("2"))
            for number, at in enumerate(stamps)])
    if episode is not None:
        counts.update(lifecycle.write_lifecycle_events(store, episode, START * 10**6, END * 10**6))
    piece = {"index": index, "instrument_id": str(iid), "catalog_dir": "episode-1" if index else "", "counts": counts,
             "last_bar_ns": int((bars["ts_open"][-1] + MIN - 1) * 10**6) if len(minutes) else None, "episode": episode}
    receipt = {"format": "market-coverage-v1", "symbol": symbol, "commit": "c" * 32, "timeframe": "1m",
               "start_ns": START * 10**6, "end_ns": END * 10**6,
               "historical_terms": "CURRENT_SNAPSHOT_APPROXIMATION", "terms_observed_at": observed_at,
               "assumed": dict(instrument.ASSUMED), "pieces": [piece]}
    (path / "export.json").write_text(json.dumps(receipt))


def market(root: Path, quotes: bool = False, margins=None, trades: bool = False, metrics: bool = False) -> list[str]:
    every = np.arange(DAYS * 1440)
    eight = [START + hour * 3_600_000 for hour in range(0, DAYS * 24, 8)]
    contract(root, "AAAUSDT", every, eight + [START + DAY + 6 * 3_600_000 - 1], seed=1, quotes=quotes,
             margins=margins, trades=trades, metrics=metrics)  # funding on a bar close
    keep = np.random.default_rng(7).random(len(every)) > 0.1
    keep[(every >= 600) & (every < 1500)] = False  # a gap longer than a session window
    contract(root, "币安USDT", every[keep], eight, seed=2, quotes=quotes, margins=margins, trades=trades,
             metrics=metrics)
    iid = InstrumentId.from_str(export.native_symbol("CCCUSDT", 1)["instrument_id"])
    pre, settled = (START + DAY + 10 * MIN - 1) * 10**6, (START + DAY + 12 * 3_600_000) * 10**6
    events = [InstrumentStatus(iid, MarketStatusAction.PRE_CLOSE, pre, pre).to_dict(),
              InstrumentStatus(iid, MarketStatusAction.CLOSE, settled, settled).to_dict(),
              InstrumentClose(iid, Price.from_str("101.23"), InstrumentCloseType.CONTRACT_EXPIRED, settled,
                              settled).to_dict()]
    episode = {"symbol": "CCCUSDT", "instrument_id": str(iid), "start_ns": (START + 3 * MIN) * 10**6,
               "events": events, "sources": ["notice"]}
    minutes = every[(every >= 3) & (every < 1440 + 720)]
    contract(root, "CCCUSDT", minutes, [at for at in eight if at < START + DAY + 12 * 3_600_000], episode, seed=3,
             quotes=quotes, margins=margins)
    return ["AAAUSDT", "币安USDT", "CCCUSDT"]


def normal(frame) -> list[str]:
    """Report rows without the identifiers the two runs number differently."""
    if frame is None or len(frame) == 0:
        return []
    rows = frame.reset_index().drop(columns=["venue_order_id", "trade_id", "position_id", "id", "client_order_id",
                                             "account_id", "linked_order_ids", "parent_order_id", "init_id",
                                             "last_trade_id", "opening_order_id", "closing_order_id", "index", "venue_order_ids",
                                             "events", "trade_ids", "event_id", "causation_id"], errors="ignore")
    return sorted(UUID.sub("UUID", json.dumps({key: str(value) for key, value in row.items()}, sort_keys=True))
                  for row in rows.to_dict("records"))


def node_replay(rows, window, loaded, universe, output, chunk, account=ACCOUNT_CONTRACT):
    from nautilus_trader.backtest import (
        BacktestDataConfig, BacktestEngineConfig, BacktestNode, BacktestRunConfig, BacktestVenueConfig,
    )
    from nautilus_trader.common import ImportableActorConfig, LoggerConfig, LogLevel
    from nautilus_trader.config import ImportableStrategyConfig
    from nautilus_trader.data import DataEngineConfig
    from nautilus_trader.model import (
        AccountType, BookType, Currency, NautilusDataType, OmsType, StandardMarginModel, TraderId,
    )
    from nautilus_trader.risk import RiskEngineConfig
    data = []
    quote_mode = account["execution"] == "quotes"
    for row in rows:
        iid, path = row["instrument_id"], str(row["catalog_path"])
        data += [BacktestDataConfig(data_type=NautilusDataType.MarkPriceUpdate, catalog_path=path, instrument_id=iid)]
        if quote_mode and row["counts"].get("quote"):
            data.append(BacktestDataConfig(data_type=NautilusDataType.QuoteTick, catalog_path=path, instrument_id=iid))
        data += [BacktestDataConfig(data_type=NautilusDataType.FundingRateUpdate, catalog_path=path, instrument_id=iid),
                 BacktestDataConfig(data_type=NautilusDataType.Bar, catalog_path=path, instrument_id=iid,
                                    bar_types=[f"{iid}-1-MINUTE-LAST-EXTERNAL"])]
        for key, kind in (("instrument_status", "InstrumentStatus"), ("instrument_close", "InstrumentClose")):
            if row["counts"].get(key):
                data.append(BacktestDataConfig(data_type=getattr(NautilusDataType, kind), catalog_path=path,
                                               instrument_id=iid))
    config = BacktestRunConfig(
        venues=[BacktestVenueConfig(
            name=account["venue"], oms_type=getattr(OmsType, account["oms_type"]),
            account_type=getattr(AccountType, account["account_type"]), book_type=getattr(BookType, account["book_type"]),
            base_currency=Currency.from_str(account["base_currency"]),
            starting_balances=[f"{account['starting_balance_usdt']} {account['base_currency']}"],
            default_leverage=Decimal(account["default_leverage"]), support_gtd_orders=account["support_gtd_orders"],
            support_contingent_orders=account["support_contingent_orders"], reject_stop_orders=account["reject_stop_orders"],
            bar_execution=account["bar_execution"],
            margin_model=StandardMarginModel() if account["margin_model"] == "StandardMarginModel" else None,
            liquidation_enabled=account["liquidation_enabled"],
            bar_adaptive_high_low_ordering=account["bar_adaptive_high_low_ordering"], fill_model=run.fill_model(account),
            liquidity_consumption=account["liquidity_consumption"], queue_position=account["queue_position"],
            fee_model=run.fee_model(rows))],
        data=data,
        engine=BacktestEngineConfig(
            trader_id=TraderId(account["trader_id"]), logging=LoggerConfig(stdout_level=LogLevel.OFF, print_config=False),
            data_engine=DataEngineConfig(time_bars_timestamp_on_close=account["time_bars_timestamp_on_close"],
                                         time_bars_skip_first_non_full_bar=account["time_bars_skip_first_non_full_bar"],
                                         validate_data_sequence=account["validate_data_sequence"]),
            risk_engine=RiskEngineConfig(max_order_submit_rate=account["max_order_submit_rate"])),
        chunk_size=chunk, dispose_on_completion=False)
    node = BacktestNode([config])
    node.build()
    run.STRATEGIES.clear()
    run.OBSERVERS.clear()
    planned, _ = run.plan_instances(rows, window, loaded)
    for row, input_start, trade_start in planned:
        node.add_strategy_from_config(config.id, ImportableStrategyConfig(
            strategy_path=f"engine.run:{run._runner_class(loaded).__name__}", config_path="engine.run:StrategyInputs",
            config={"instrument_id": str(row["instrument_id"]), "trade_start_ns": trade_start,
                    "input_start_ns": input_start, "strategy_id": row["strategy_id"],
                    "catalog_path": str(row["catalog_path"]),
                    "universe_membership": [list(item) for item in run.episode_membership(universe[row["symbol"]],
                                                                                           row["episode"])]}))
    node.add_actor_from_config(config.id, ImportableActorConfig(
        actor_path="engine.run:CapitalObserver", config_path="engine.run:CapitalObserverConfig",
        config={"instrument_ids": tuple(str(row["instrument_id"]) for row in rows),
                "exposure_path": str(output / "exposures.csv.gz"),
                "lifecycle_ids": tuple(str(row["instrument_id"]) for row in rows if row["episode"] is not None)}))
    result = node.run()[0]
    observer = run.OBSERVERS[0]
    observer.finish(node.get_engine_cache(config.id))
    return {"iterations": result.iterations, "orders": normal(node.generate_orders_report(config.id)),
            "fills": normal(node.generate_fills_report(config.id)),
            "positions": normal(node.generate_positions_report(config.id)),
            "account": normal(node.generate_account_report(config.id, venue=run.Venue("BINANCE"))),
            "seen": {key: value.seen for key, value in run.STRATEGIES.items()},
            "observer": (observer.timestamps, list(observer.findings), observer.lifecycle)}


LEVERED = '''
from decimal import Decimal
from nautilus_trader.model import BarType, OrderSide
from nautilus_trader.trading import Strategy, StrategyConfig


class Levered(Strategy):
    """Quote environment: one large market short on AAAUSDT at its trading start, then nothing; the venue's
    native liquidation closes it when the quotes carry the price far enough (seed 1 rises 15%)."""
    USES_STOP_LOSS = False

    def __init__(self, instrument_id, daily_bar_type, **kw):
        super().__init__(StrategyConfig(strategy_id=kw["strategy_id"]))
        self.iid, self.trade_start, self.sent, self.quotes, self.seen = instrument_id, kw["trade_start_ns"], False, 0, []

    def on_start(self):
        self.subscribe_bars(BarType.from_str(f"{self.iid}-1-MINUTE-LAST-EXTERNAL"))
        self.subscribe_quotes(self.iid)

    def on_quote(self, quote):
        self.quotes += 1

    def on_bar(self, bar):
        if bar.ts_event < self.trade_start or self.sent or not str(self.iid).startswith("AAAUSDT"):
            return  # one levered short on one contract; the others only watch
        self.sent = True
        self.submit_order(self.order_factory.market(self.iid, OrderSide.SELL, self.cache.instrument(self.iid).make_qty(
            Decimal("QUANTITY"))))

    def on_order_event(self, event):
        self.seen.append((type(event).__name__, str(event.client_order_id)[:11], event.ts_event))

    def replay_diagnostics(self):
        return {"quotes": self.quotes}

    def replay_integrity_findings(self, orders_denied_or_rejected):
        return []
'''


WATCHER = '''
from decimal import Decimal
from nautilus_trader.model import BarType, DataType, OrderSide, Price
from nautilus_trader.trading import Strategy, StrategyConfig


class Watcher(Strategy):
    """Quote environment with trade ticks: every event it is handed, and on AAAUSDT's first trade of the trading
    window a resting buy limit at 2.00, which every later trade (at 1.00) trades through, and a market buy."""
    USES_STOP_LOSS = False

    def __init__(self, instrument_id, daily_bar_type, **kw):
        super().__init__(StrategyConfig(strategy_id=kw["strategy_id"]))
        self.iid, self.trade_start, self.sent, self.seen = instrument_id, kw["trade_start_ns"], False, []

    SUBSCRIBE = "served"  # "served": trades of the contracts exported with them; "every"; "native"

    def on_start(self):
        self.subscribe_bars(BarType.from_str(f"{self.iid}-1-MINUTE-LAST-EXTERNAL"))
        self.subscribe_quotes(self.iid)
        if self.SUBSCRIBE == "native":
            self.subscribe_trades(self.iid)
        elif self.SUBSCRIBE == "every" or not str(self.iid).startswith("CCCUSDT"):
            self.subscribe_data(DataType("TradeTick", metadata={"instrument_id": str(self.iid)}))

    def on_quote(self, quote):
        self.seen.append(("quote", quote.ts_event, str(quote.ask_price)))

    def on_data(self, data):
        trade = data.data
        self.seen.append(("trade", trade.ts_event, str(trade.trade_id), str(trade.price), str(trade.size),
                          str(trade.aggressor_side)))
        if trade.ts_event >= self.trade_start and not self.sent and str(self.iid).startswith("AAAUSDT"):
            self.sent = True
            quantity = self.cache.instrument(self.iid).make_qty(Decimal("0.010"))
            self.submit_order(self.order_factory.limit(self.iid, OrderSide.BUY, quantity, Price.from_str("2.00")))
            self.submit_order(self.order_factory.market(self.iid, OrderSide.BUY, quantity))

    def replay_diagnostics(self):
        return {"trades": sum(event[0] == "trade" for event in self.seen)}

    def replay_integrity_findings(self, orders_denied_or_rejected):
        return []
'''


METRICS_WATCHER = '''
from decimal import Decimal
from nautilus_trader.model import BarType, DataType, OrderSide
from nautilus_trader.trading import Strategy, StrategyConfig


class MetricsWatcher(Strategy):
    """Bar environment with metrics: every bar and metrics row it is handed, and on AAAUSDT's first row of the
    trading window a market buy."""
    USES_STOP_LOSS = False
    SUBSCRIBE = "served"  # "served": metrics of the contracts exported with them; "every"

    def __init__(self, instrument_id, daily_bar_type, **kw):
        super().__init__(StrategyConfig(strategy_id=kw["strategy_id"]))
        self.iid, self.trade_start, self.sent, self.seen = instrument_id, kw["trade_start_ns"], False, []

    def on_start(self):
        self.subscribe_bars(BarType.from_str(f"{self.iid}-1-MINUTE-LAST-EXTERNAL"))
        if self.SUBSCRIBE == "every" or not str(self.iid).startswith("CCCUSDT"):
            self.subscribe_data(DataType("Metrics", metadata={"instrument_id": str(self.iid)}))

    def on_bar(self, bar):
        self.seen.append(("bar", bar.ts_init, str(bar.close)))

    def on_data(self, data):
        row = data.data
        self.seen.append(("metrics", row.ts_init, row.ts_event, row.instrument_id, row.sum_open_interest,
                          row.count_toptrader_long_short_ratio, row.sum_toptrader_long_short_ratio,
                          row.count_long_short_ratio))
        if row.ts_init >= self.trade_start and not self.sent and str(self.iid).startswith("AAAUSDT"):
            self.sent = True
            quantity = self.cache.instrument(self.iid).make_qty(Decimal("0.010"))
            self.submit_order(self.order_factory.market(self.iid, OrderSide.BUY, quantity))

    def replay_diagnostics(self):
        return {}

    def replay_integrity_findings(self, orders_denied_or_rejected):
        return []
'''


class StreamTests(unittest.TestCase):
    def test_runner_keeps_trusted_start_when_source_mutates_its_own_start(self):
        from engine.audit import audit
        from engine.report import write_native_reports
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            contract(root / "market", "AAAUSDT", np.arange(DAYS * 1440), [], seed=1)
            rows = read_market(root / "market", ["AAAUSDT"], "c" * 32, START * 10**6, END * 10**6)
            source = root / "early.py"
            # A source may change its own clock guard and self-report success; neither controls the audit.
            source.write_text(PROBE.replace('kw["trade_start_ns"]', '0')
                              .replace('if bar.ts_event < self.trade_start:', 'if True:'))
            loaded = load_strategy(source, "Probe", hashlib.sha256(source.read_bytes()).hexdigest())
            window = parse_window(utc_text(START * 10**6), utc_text((START + 60 * MIN) * 10**6), utc_text(END * 10**6))
            output = root / "reports"
            output.mkdir()
            finished, strategies, limitations = run.replay(rows, window, loaded, {"AAAUSDT": ((0, 10**20),)}, output)
            try:
                summary, _ = write_native_reports(output, finished, strategies, rows,
                                                  {"strategy_uses_stop_loss": False, "market_commit": "c" * 32}, window, ACCOUNT_CONTRACT,
                                                  limitations, run.mark_timestamps(rows))
                self.assertEqual(summary["trade_start_by_strategy"], {"R1-AAA": window.trade_start_ns})
                self.assertEqual(strategies["AAA"].trade_start, 0)
                with (output / "fills.csv").open(newline="") as stream:
                    fills = list(csv.DictReader(stream))
                with (output / "fill_volumes.csv").open(newline="") as stream:
                    volumes = list(csv.DictReader(stream))
                bars = {bar.ts_event + 1_000_000 - 60 * 10**9: bar.volume.as_decimal() for bar in
                        ParquetDataCatalog(str(rows[0]["catalog_path"])).query(
                            run.NautilusDataType.Bar, identifiers=[f"{rows[0]['instrument_id']}-1-MINUTE-LAST-EXTERNAL"])}
                self.assertTrue(fills)
                self.assertEqual(sorted(row["event_id"] for row in volumes), sorted(row["event_id"] for row in fills))
                for row in volumes:
                    opened = int(row["bar_ts_open_ns"])
                    self.assertEqual(opened, int(row["ts_event_ns"]) // (60 * 10**9) * 60 * 10**9)
                    self.assertEqual(Decimal(row["bar_volume"]), bars[opened])
                self.assertTrue(summary["integrity_passed"], summary["integrity_findings"])
                (root / "input-coverage.json").write_text(json.dumps({
                    "format": "execution-input-coverage-v1", "input_identity": {"market_commit": "c" * 32},
                    "effective_config": {"start": window.start, "trade_start": window.trade_start, "end": window.end},
                    "membership": {"commit": "c" * 32, "membership": {"AAAUSDT": [[window.start_ns, window.end_ns]]}},
                    "export_receipts": {"AAAUSDT": rows[0]["receipt"]}}))
                result = audit(output)
                self.assertFalse(result["passed"])
                self.assertTrue(any(item.startswith("ORDER_BEFORE_TRADE_START:") for item in result["findings"]),
                                result["findings"])
            finally:
                finished.engine.dispose()

    def test_the_streamed_replay_equals_backtest_node(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            symbols = market(root / "market")
            source = root / "probe.py"
            source.write_text(PROBE)
            loaded = load_strategy(source, "Probe", hashlib.sha256(source.read_bytes()).hexdigest())
            window = parse_window(utc_text(START * 10**6), utc_text((START + 3 * 3_600_000) * 10**6),
                                  utc_text(END * 10**6))
            rows = read_market(root / "market", symbols, "c" * 32, START * 10**6, END * 10**6)
            universe = read_universe(None, symbols)
            chunk, session = ACCOUNT_CONTRACT["chunk_size"], run.SESSION_WINDOW_NS
            ACCOUNT_CONTRACT["chunk_size"], run.SESSION_WINDOW_NS = 1, 6 * 3_600_000_000_000
            self.addCleanup(ACCOUNT_CONTRACT.__setitem__, "chunk_size", chunk)
            self.addCleanup(setattr, run, "SESSION_WINDOW_NS", session)
            (root / "node").mkdir()
            (root / "stream").mkdir()
            node = node_replay(rows, window, loaded, universe, root / "node", 1)
            finished, _, _ = run.replay(rows, window, loaded, universe, root / "stream")
            streamed = {"iterations": finished.result.iterations, "orders": normal(finished.orders()),
                        "fills": normal(finished.fills()), "positions": normal(finished.positions()),
                        "account": normal(finished.account(run.Venue("BINANCE"))),
                        "seen": {key: value.seen for key, value in run.STRATEGIES.items()},
                        "observer": (finished.observer.timestamps, list(finished.observer.findings),
                                     finished.observer.lifecycle)}
            exposures = [gzip.decompress((root / side / "exposures.csv.gz").read_bytes()).decode().splitlines()
                         for side in ("node", "stream")]
        expected = sum(sum(value for key, value in row["counts"].items() if key != "daily") for row in rows)
        self.assertEqual((node["iterations"], streamed["iterations"]), (expected, expected))
        self.assertTrue(node["fills"] and any(item[0] == "close" for item in node["seen"]["CCCUSDT-E1-PERP.BINANCE"]))
        for key in ("orders", "fills", "positions", "account", "seen", "observer"):
            with self.subTest(key=key):
                self.assertEqual(streamed[key], node[key])
        strip = [[line.split(",", 2)[0] + "," + line.split(",", 2)[2] for line in table] for table in exposures]
        self.assertEqual(strip[1], strip[0])


    def test_quote_execution_is_liquidated_natively_and_equals_backtest_node(self):
        """The quote environment (--execution quotes with its margin rates): quotes drive the book and the
        liquidation, bars only feed signals; the streamed replay and BacktestNode agree, the liquidation shows as a
        LIQUIDATION fill and iterations count the quotes. The same inputs without quotes exported are refused, and
        a source that declares the environment itself is refused."""
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            symbols = market(root / "market", quotes=True, margins=("0.02", "0.01"))
            source = root / "levered.py"
            source.write_text(LEVERED.replace("QUANTITY", "30000"))  # about 31x the 100,000 USDT at these prices
            loaded = load_strategy(source, "Levered", hashlib.sha256(source.read_bytes()).hexdigest())
            window = parse_window(utc_text(START * 10**6), utc_text((START + 3 * 3_600_000) * 10**6),
                                  utc_text(END * 10**6))
            rows = read_market(root / "market", symbols, "c" * 32, START * 10**6, END * 10**6)
            universe = read_universe(None, symbols)
            (root / "node").mkdir()
            (root / "stream").mkdir()
            account = execution_account("quotes", ("0.02", "0.01"))
            node = node_replay(rows, window, loaded, universe, root / "node", 1_000, account)
            finished, strategies, _ = run.replay(rows, window, loaded, universe, root / "stream", account)
            try:
                streamed = {"iterations": finished.result.iterations, "orders": normal(finished.orders()),
                            "fills": normal(finished.fills()), "positions": normal(finished.positions()),
                            "account": normal(finished.account(run.Venue("BINANCE"))),
                            "seen": {key: value.seen for key, value in run.STRATEGIES.items()}}
                fills = finished.fills().reset_index()
                liquidations = [row for row in fills.to_dict("records") if str(row["client_order_id"]).startswith("LIQUIDATION")]
                quotes_seen = {key: value.quotes for key, value in run.STRATEGIES.items()}
            finally:
                finished.engine.dispose()
            expected = sum(sum(value for key, value in row["counts"].items() if key != "daily") for row in rows)
            self.assertEqual((node["iterations"], streamed["iterations"]), (expected, expected))
            self.assertTrue(liquidations, "the levered short was not liquidated on these inputs")
            self.assertTrue(all(count > 0 for count in quotes_seen.values()), quotes_seen)
            for key in ("orders", "fills", "positions", "account", "seen"):
                with self.subTest(key=key):
                    self.assertEqual(streamed[key], node[key])
            # The same environment on an export without quotes is refused before anything runs.
            bare = market(root / "bare")
            rows = read_market(root / "bare", bare, "c" * 32, START * 10**6, END * 10**6)
            with self.assertRaises(Refusal) as caught:
                run.replay(rows, window, loaded, universe, root / "stream", account)
            self.assertEqual(caught.exception.code, "QUOTES_MISSING")
            # A source that declares the environment is refused: the environment is the runner's, not the source's.
            source.write_text(LEVERED.replace("QUANTITY", "30000").replace("    USES_STOP_LOSS = False\n",
                                                                           "    USES_STOP_LOSS = False\n    QUOTE_EXECUTION = True\n"))
            with self.assertRaises(Refusal) as caught:
                load_strategy(source, "Levered", hashlib.sha256(source.read_bytes()).hexdigest())
            self.assertEqual(caught.exception.code, "ENVIRONMENT_DECLARED")

    def test_a_trading_month_without_quotes_is_named_missing(self):
        """Quotes are checked per UTC month of [trade start, end): January and March held, February is missing,
        and a window inside the held months misses none."""
        with tempfile.TemporaryDirectory() as temp:
            catalog_path = Path(temp)
            store = ParquetDataCatalog(str(catalog_path))
            native = export.native_symbol("AAAUSDT", None)["instrument_id"]
            store.write_instruments([instrument.build_instrument("AAAUSDT", TERMS, 2, native, on_grid=True)[0]])
            iid = InstrumentId.from_str(native)
            march = START + (31 + 28) * DAY
            rows = [(START + MIN, 10**10, 10**10 + 10**6), (march + MIN, 10**10, 10**10 + 10**6)]
            export.write_quotes(store, iid, [rows], 2, "1000", 3, 8)
            row = {"catalog_path": str(catalog_path), "instrument_id": native}
            self.assertEqual(run.months_missing(row, "QuoteTick", START * 10**6, (march + DAY) * 10**6), ["2026-02"])
            self.assertEqual(run.months_missing(row, "QuoteTick", START * 10**6, (START + 31 * DAY) * 10**6), [])

    def test_trade_ticks_follow_their_millisecond_quotes_and_never_match(self):
        """Exported trades reach the strategy in (time, aggregate ID) order, after the quotes of their millisecond,
        and count in the consumed events; a contract exported without trades streams none. A trade never fills an
        order (every trade at 1.00 trades through the resting limit at 2.00, which stays open) and never moves the
        book: the market buy fills at the ask of the quote in force."""
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            symbols = market(root / "market", quotes=True, margins=("0.05", "0.025"), trades=True)
            source = root / "watcher.py"
            source.write_text(WATCHER)
            loaded = load_strategy(source, "Watcher", hashlib.sha256(source.read_bytes()).hexdigest())
            window = parse_window(utc_text(START * 10**6), utc_text((START + 3 * 3_600_000) * 10**6),
                                  utc_text(END * 10**6))
            rows = read_market(root / "market", symbols, "c" * 32, START * 10**6, END * 10**6)
            self.assertEqual([("trade" in row["counts"]) for row in rows], [True, True, False])
            finished, strategies, _ = run.replay(rows, window, loaded, read_universe(None, symbols), root,
                                                 execution_account("quotes", ("0.05", "0.025")))
            try:
                iterations = finished.result.iterations
                fills = finished.fills().reset_index().to_dict("records")
                statuses = sorted(str(order.status) for order in finished.engine.cache.orders())
            finally:
                finished.engine.dispose()
            seen = {row["coin"]: strategies[row["coin"]].seen for row in rows}
        self.assertEqual(iterations, sum(sum(value for key, value in row["counts"].items() if key != "daily")
                                         for row in rows))
        for row in rows:
            trades = [event for event in seen[row["coin"]] if event[0] == "trade"]
            self.assertEqual(len(trades), row["counts"].get("trade", 0))
            self.assertEqual([int(event[2]) for event in trades], sorted(int(event[2]) for event in trades))
            if trades:
                self.assertEqual(trades[0][3:], ("1.00", "0.001", "BUY"))
                self.assertEqual(trades[1][3:], ("1.00", "0.001", "SELL"))
            for index, event in enumerate(seen[row["coin"]]):
                if event[0] == "quote":  # no trade of this millisecond came before its quote
                    self.assertFalse(any(earlier[0] == "trade" and earlier[1] == event[1]
                                         for earlier in seen[row["coin"]][:index]))
        first = next(event for event in seen["AAA"] if event[0] == "trade" and event[1] >= window.trade_start_ns)
        ask = [event for event in seen["AAA"] if event[0] == "quote" and event[1] <= first[1]][-1][2]
        self.assertEqual(statuses, ["ACCEPTED", "FILLED"])
        self.assertEqual([str(fill["last_px"]) for fill in fills], [ask])

    def test_a_trade_subscription_the_run_does_not_serve_refuses_after_its_first_chunk(self):
        """A source subscribing to the trades of a contract exported without them, or to native trades (never
        streamed), would see none: the run stops after the chunk it subscribed in and refuses."""
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            symbols = market(root / "market", quotes=True, margins=("0.05", "0.025"), trades=True)
            window = parse_window(utc_text(START * 10**6), utc_text((START + 3 * 3_600_000) * 10**6),
                                  utc_text(END * 10**6))
            rows = read_market(root / "market", symbols, "c" * 32, START * 10**6, END * 10**6)
            for mode, named in (("every", "TradeTick for CCCUSDT-E1-PERP.BINANCE, which this run"),
                                ("native", "subscribe_trades")):
                source = root / f"watcher_{mode}.py"
                source.write_text(WATCHER.replace('SUBSCRIBE = "served"', f'SUBSCRIBE = "{mode}"'))
                loaded = load_strategy(source, "Watcher", hashlib.sha256(source.read_bytes()).hexdigest())
                consumed = []
                original = run.stream
                with self.subTest(mode=mode), patch.object(
                        run, "stream", lambda *a: consumed.append(original(*a)) or consumed[-1]), \
                        self.assertRaises(Refusal) as caught:
                    run.replay(rows, window, loaded, read_universe(None, symbols), root,
                               {**execution_account("quotes", ("0.05", "0.025")), "chunk_size": 1000})
                self.assertEqual(caught.exception.code, "TRADES_NOT_SERVED")
                self.assertIn(named, str(caught.exception))
                total = sum(sum(v for k, v in row["counts"].items() if k != "daily") for row in rows)
                self.assertEqual(len(consumed), 1)
                self.assertTrue(1000 <= consumed[0] < total)

    def test_metrics_arrive_on_minute_boundaries_as_exact_custom_data_and_fill_at_the_bar_ending_there(self):
        """Exported metrics reach the strategy in time order as engine.Metrics, 8 minutes after create_time and
        describing 5 minutes after it, with exact decimals and empty ratios as None, and count in the consumed
        events; a contract exported without them streams none. A market buy a row prompts in the bar environment
        fills at the close of the bar that ends where the row arrives. With --metrics, an active contract whose
        export holds none is refused."""
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            symbols = market(root / "market", metrics=True)
            source = root / "metrics_watcher.py"
            source.write_text(METRICS_WATCHER)
            loaded = load_strategy(source, "MetricsWatcher", hashlib.sha256(source.read_bytes()).hexdigest())
            window = parse_window(utc_text(START * 10**6), utc_text((START + 3 * 3_600_000) * 10**6),
                                  utc_text(END * 10**6))
            rows = read_market(root / "market", symbols, "c" * 32, START * 10**6, END * 10**6)
            self.assertEqual([("metrics" in row["counts"]) for row in rows], [True, True, False])
            finished, strategies, _ = run.replay(rows, window, loaded, read_universe(None, symbols), root)
            try:
                iterations = finished.result.iterations
                fills = finished.fills().reset_index().to_dict("records")
            finally:
                finished.engine.dispose()
            seen = {row["coin"]: strategies[row["coin"]].seen for row in rows}
            with self.assertRaises(Refusal) as caught:
                run.replay(rows, window, loaded, read_universe(None, symbols), root, metrics=True)
            self.assertEqual(caught.exception.code, "METRICS_MISSING")
            self.assertIn("CCCUSDT 2026-01", str(caught.exception))
        self.assertEqual(iterations, sum(sum(value for key, value in row["counts"].items() if key != "daily")
                                         for row in rows))
        for row in rows:
            found = [event for event in seen[row["coin"]] if event[0] == "metrics"]
            self.assertEqual(len(found), row["counts"].get("metrics", 0))
            if not found:
                continue
            self.assertEqual(found[0][1:3], ((START + 3 * MIN) * 10**6, START * 10**6))
            self.assertTrue(all(event[1] % (MIN * 10**6) == 0 and event[1] - event[2] == 3 * MIN * 10**6
                                for event in found))
            self.assertEqual([event[1] for event in found], sorted(event[1] for event in found))
            self.assertEqual(found[0][3], row["instrument_id"])
            self.assertEqual(found[1][4:], (Decimal("1235.5"), Decimal("1.25"), Decimal("0.875"), None))
            self.assertEqual(found[7][7], Decimal("2"))
        first = next(event for event in seen["AAA"] if event[0] == "metrics" and event[1] >= window.trade_start_ns)
        close = next(event[2] for event in seen["AAA"] if event[0] == "bar" and event[1] == first[1] - 10**6)
        self.assertEqual([str(fill["last_px"]) for fill in fills], [close])

    def test_a_metrics_subscription_the_run_does_not_serve_refuses_after_its_first_chunk(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            symbols = market(root / "market", metrics=True)
            source = root / "metrics_every.py"
            source.write_text(METRICS_WATCHER.replace('SUBSCRIBE = "served"', 'SUBSCRIBE = "every"'))
            loaded = load_strategy(source, "MetricsWatcher", hashlib.sha256(source.read_bytes()).hexdigest())
            window = parse_window(utc_text(START * 10**6), utc_text((START + 3 * 3_600_000) * 10**6),
                                  utc_text(END * 10**6))
            rows = read_market(root / "market", symbols, "c" * 32, START * 10**6, END * 10**6)
            with self.assertRaises(Refusal) as caught:
                run.replay(rows, window, loaded, read_universe(None, symbols), root,
                           {**ACCOUNT_CONTRACT, "chunk_size": 1000})
        self.assertEqual(caught.exception.code, "METRICS_NOT_SERVED")
        self.assertIn("subscribe_data Metrics for CCCUSDT-E1-PERP.BINANCE", str(caught.exception))

    def test_exported_trades_are_checked_per_month_and_a_file_never_spans_two(self):
        """Trades are checked per UTC month of [trade start, end) like quotes: January and March held, February
        missing. Each written file lies inside one UTC month, so its statistics name the months it holds."""
        with tempfile.TemporaryDirectory() as temp:
            catalog_path = Path(temp)
            store = ParquetDataCatalog(str(catalog_path))
            native = export.native_symbol("AAAUSDT", None)["instrument_id"]
            store.write_instruments([instrument.build_instrument("AAAUSDT", TERMS, 2, native, on_grid=True)[0]])
            iid = InstrumentId.from_str(native)
            february, march = START + 31 * DAY, START + (31 + 28) * DAY
            rows = [(february - 1, 1, 10**10, 10**5, 1), (march, 2, 10**10, 10**5, 0), (march, 3, 10**10, 10**5, 0)]
            self.assertEqual(export.write_trades(store, iid, [rows[:1], rows[1:]], 2, 3), 3)
            files = sorted((catalog_path / "data" / "trades").rglob("*.parquet"))
            self.assertEqual([run._bounds(str(path)) for path in files],
                             [((february - 1) * 10**6, (february - 1) * 10**6), (march * 10**6, march * 10**6)])
            row = {"catalog_path": str(catalog_path), "instrument_id": native}
            self.assertEqual(run.months_missing(row, "TradeTick", START * 10**6, (march + DAY) * 10**6), ["2026-02"])
            self.assertEqual(run.months_missing(row, "TradeTick", START * 10**6, february * 10**6), [])
            with self.assertRaises(export.store.MarketError) as caught:
                export.write_trades(store, iid, [[(march + 1, 4, 10**10 + 1, 10**5, 0)]], 2, 3)
            self.assertEqual(caught.exception.code, "TRADE_INEXACT")

    def test_each_exported_piece_is_its_numbered_episode_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            symbols = market(root / "market")
            rows = read_market(root / "market", symbols, "c" * 32, START * 10**6, END * 10**6)
            self.assertEqual([(row["coin"], row["strategy_id"], str(row["instrument_id"])) for row in rows][1:],
                             [("币安", "R1-XE5B881E5AE89", "XE5B881E5AE89USDT-PERP.BINANCE"),
                              ("CCC_E1", "R1-CCC_E1", "CCCUSDT-E1-PERP.BINANCE")])
            path = root / "market" / "CCCUSDT" / "export.json"
            receipt = json.loads(path.read_text())
            receipt["pieces"][0]["catalog_dir"] = "episode-2"
            path.write_text(json.dumps(receipt))
            with self.assertRaises(Refusal) as caught:
                read_market(root / "market", symbols, "c" * 32, START * 10**6, END * 10**6)
            self.assertEqual(caught.exception.code, "EPISODE_MAPPING_MISMATCH")

    def test_trading_after_a_settlement_is_rejected_by_the_market_and_refused_by_the_audit(self):
        from engine.audit import audit
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            symbols = market(root / "market")
            source = root / "after.py"
            source.write_text(AFTER_SETTLEMENT)
            work = root / "run"
            argv = ["--market-root", str(root / "market"), "--market-commit", "c" * 32, "--symbols", "AAAUSDT", "CCCUSDT",
                    "--start", utc_text(START * 10**6), "--end", utc_text(END * 10**6), "--output", str(work / "reports"),
                    "--strategy-file", str(source), "--strategy-class", "AfterSettle",
                    "--strategy-sha256", hashlib.sha256(source.read_bytes()).hexdigest()]
            with self.assertRaises(Exception) as caught:
                with __import__("contextlib").redirect_stdout(__import__("io").StringIO()):
                    run.main(argv)
            self.assertEqual(caught.exception.code, "INTEGRITY_FINDINGS")
            receipts = {symbol: json.loads((root / "market" / symbol / "export.json").read_text()) for symbol in symbols}
            (work / "input-coverage.json").write_text(json.dumps({
                "format": "execution-input-coverage-v1", "export_receipts": {key: receipts[key] for key in ("AAAUSDT", "CCCUSDT")},
                "input_identity": {"lifecycle_bundle": "lifecycle-test", "market_commit": "c" * 32},
                "membership": {"commit": "c" * 32, "membership": {
                    symbol: [[START * 10**6, END * 10**6]] for symbol in ("AAAUSDT", "CCCUSDT")}},
                "effective_config": {"start": utc_text(START * 10**6), "trade_start": utc_text(START * 10**6),
                                     "end": utc_text(END * 10**6)}}))
            result = audit(work / "reports")
            summary = json.loads((work / "reports" / "summary.json").read_text())
        late = [item for item in result["findings"] if item.startswith("LATE_ORDER_EVENT")]
        self.assertEqual(len(late), 10, result["findings"])  # five round trips, one finding per order
        self.assertTrue(all("created at" in item for item in late))
        self.assertTrue(summary["integrity_findings"][0].startswith("ORDERS_DENIED_OR_REJECTED"))


    def holes(self, gap_minutes: int) -> tuple[dict, BaseException | None]:
        """A held contract whose data lacks `gap_minutes` minutes in the middle of a day, beside one without."""
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            every = np.arange(DAYS * 1440)
            contract(root / "market", "AAAUSDT", every, [], seed=1)
            contract(root / "market", "BBBUSDT", every[(every < 600) | (every >= 600 + gap_minutes)], [], seed=2,
                     observed_at=END + DAY)  # terms observed after the window, as a backfilled market has them
            source = root / "hold.py"
            source.write_text(HOLD)
            argv = ["--market-root", str(root / "market"), "--market-commit", "c" * 32, "--symbols", "AAAUSDT", "BBBUSDT",
                    "--start", utc_text(START * 10**6), "--end", utc_text(END * 10**6),
                    "--output", str(root / "reports"), "--strategy-file", str(source), "--strategy-class", "Hold",
                    "--strategy-sha256", hashlib.sha256(source.read_bytes()).hexdigest()]
            failure = None
            try:
                with __import__("contextlib").redirect_stdout(__import__("io").StringIO()):
                    run.main(argv)
            except Exception as exc:
                failure = exc
            if not (root / "reports" / "summary.json").exists():
                raise failure
            return json.loads((root / "reports" / "summary.json").read_text()), failure

    def test_a_mark_hole_up_to_an_hour_is_carried_and_a_longer_one_is_one_valuation_gap(self):
        summary, failure = self.holes(30)
        self.assertIsNone(failure)
        approximated = [item for item in summary["limitations"] if item.startswith("CURRENT_SNAPSHOT_APPROXIMATION")]
        self.assertEqual(approximated, [f"CURRENT_SNAPSHOT_APPROXIMATION: BBBUSDT trades on terms observed at "
                                        f"{utc_text((END + DAY) * 10**6)} (observed_at {END + DAY}), after the window "
                                        f"end {utc_text(END * 10**6)}"])  # AAAUSDT's terms predate the window
        hole_start = (START + 600 * MIN - 1) * 10**6  # the last MARK before the hole closes there
        self.assertEqual(summary["mark_carry"], [{"instrument_id": "BBBUSDT-PERP.BINANCE", "mark_ns": hole_start,
                                                  "from_ns": hole_start + 60 * 10**9,
                                                  "to_ns": hole_start + 30 * 60 * 10**9, "labels": 30}])
        self.assertTrue(any("latest MARK, at most 60 minutes old (1 intervals" in item for item in summary["limitations"]))
        summary, failure = self.holes(90)
        self.assertEqual(failure.code, "INTEGRITY_FINDINGS")
        gaps = [item for item in summary["integrity_findings"] if item.startswith("CAPITAL_VALUATION_GAP")]
        self.assertEqual(len(gaps), 1, gaps)  # one finding for the interval past the carry limit
        self.assertIn("at 30 labels from", gaps[0])
        self.assertEqual(summary["mark_carry"][0]["labels"], 60)


if __name__ == "__main__":
    unittest.main()
