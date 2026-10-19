"""The streamed replay equals BacktestNode on the same inputs: every event the strategy sees, every
order, fill, position, account row and exposure, with chunks of one event and session windows of six
hours over contracts with gaps, a non-ASCII name, funding stamped on a bar close and a settlement."""

import gzip
import hashlib
import json
import re
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

import numpy as np
from nautilus_trader.model import (
    InstrumentClose, InstrumentCloseType, InstrumentId, InstrumentStatus, MarketStatusAction, Price,
)
from nautilus_trader.persistence import ParquetDataCatalog

from engine import run
from engine.config import ACCOUNT_CONTRACT, parse_window, utc_text
from engine.load import load_strategy, read_market, read_universe, strategy_id
from market import export, lifecycle


UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
MIN, DAY = 60_000, 86_400_000
START = 1_767_225_600_000  # 2026-01-01T00:00:00Z, ms
DAYS = 2
END = START + DAYS * DAY
TERMS = {"price_increment": "0.01", "size_increment": "0.001", "max_quantity": None, "min_quantity": None,
         "min_notional": None, "max_price": None, "min_price": None}
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


def contract(root, symbol, minutes, funding, episode=None, seed=0):
    path = root / symbol
    path.mkdir(parents=True)
    store = ParquetDataCatalog(str(path))
    store.write_instruments([export.build_instrument(symbol, TERMS, 2)])
    iid = InstrumentId.from_str(export.instrument_id(symbol))
    bars = series(seed, minutes)
    counts = {"last": export.write_bars(store, f"{iid}-1-MINUTE-LAST-EXTERNAL", bars, MIN, 2, 3, 8, 4),
              "mark": export.write_marks(store, iid, bars, MIN, 8),
              "funding": export.write_funding(path, str(iid), [(at, Decimal("0.0001")) for at in sorted(funding)])}
    if episode is not None:
        counts.update(lifecycle.write_lifecycle_events(path, episode, START * 10**6, END * 10**6, 2))
    receipt = {"symbol": symbol, "instrument_id": str(iid), "commit": "c" * 32, "timeframe": "1m",
               "start_ns": START * 10**6, "end_ns": END * 10**6, "counts": counts,
               "historical_terms": "CURRENT_SNAPSHOT_APPROXIMATION", "episode": episode}
    (path / "export.json").write_text(json.dumps(receipt))


def market(root: Path) -> list[str]:
    every = np.arange(DAYS * 1440)
    eight = [START + hour * 3_600_000 for hour in range(0, DAYS * 24, 8)]
    contract(root, "AAAUSDT", every, eight + [START + DAY + 6 * 3_600_000 - 1], seed=1)  # funding on a bar close
    keep = np.random.default_rng(7).random(len(every)) > 0.1
    keep[(every >= 600) & (every < 1500)] = False  # a gap longer than a session window
    contract(root, "币安USDT", every[keep], eight, seed=2)
    iid = InstrumentId.from_str(export.instrument_id("CCCUSDT"))
    pre, settled = (START + DAY + 10 * MIN - 1) * 10**6, (START + DAY + 12 * 3_600_000) * 10**6
    events = [InstrumentStatus(iid, MarketStatusAction.PRE_CLOSE, pre, pre).to_dict(),
              InstrumentStatus(iid, MarketStatusAction.CLOSE, settled, settled).to_dict(),
              InstrumentClose(iid, Price.from_str("101.23"), InstrumentCloseType.CONTRACT_EXPIRED, settled,
                              settled).to_dict()]
    episode = {"symbol": "CCCUSDT", "instrument_id": str(iid), "start_ns": (START + 3 * MIN) * 10**6,
               "events": events, "sources": ["notice"]}
    minutes = every[(every >= 3) & (every < 1440 + 720)]
    contract(root, "CCCUSDT", minutes, [at for at in eight if at < START + DAY + 12 * 3_600_000], episode, seed=3)
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


def node_replay(rows, window, loaded, universe, output, chunk):
    from nautilus_trader.backtest import (
        BacktestDataConfig, BacktestEngineConfig, BacktestNode, BacktestRunConfig, BacktestVenueConfig,
    )
    from nautilus_trader.common import ImportableActorConfig, LoggerConfig, LogLevel
    from nautilus_trader.config import ImportableStrategyConfig
    from nautilus_trader.data import DataEngineConfig
    from nautilus_trader.model import AccountType, BookType, Currency, OmsType, TraderId
    from nautilus_trader.risk import RiskEngineConfig
    account, data = ACCOUNT_CONTRACT, []
    for row in rows:
        iid, path = row["instrument_id"], str(row["catalog_path"])
        data += [BacktestDataConfig(data_type="MarkPriceUpdate", catalog_path=path, instrument_id=iid),
                 BacktestDataConfig(data_type="FundingRateUpdate", catalog_path=path, instrument_id=iid),
                 BacktestDataConfig(data_type="Bar", catalog_path=path, instrument_id=iid,
                                    bar_types=[f"{iid}-1-MINUTE-LAST-EXTERNAL"])]
        for key, kind in (("instrument_status", "InstrumentStatus"), ("instrument_close", "InstrumentClose")):
            if row["counts"].get(key):
                data.append(BacktestDataConfig(data_type=kind, catalog_path=path, instrument_id=iid))
    config = BacktestRunConfig(
        venues=[BacktestVenueConfig(
            name=account["venue"], oms_type=getattr(OmsType, account["oms_type"]),
            account_type=getattr(AccountType, account["account_type"]), book_type=getattr(BookType, account["book_type"]),
            base_currency=Currency.from_str(account["base_currency"]),
            starting_balances=[f"{account['starting_balance_usdt']} {account['base_currency']}"],
            default_leverage=Decimal(account["default_leverage"]), support_gtd_orders=account["support_gtd_orders"],
            support_contingent_orders=account["support_contingent_orders"], reject_stop_orders=account["reject_stop_orders"],
            bar_execution=account["bar_execution"],
            bar_adaptive_high_low_ordering=account["bar_adaptive_high_low_ordering"])],
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
            strategy_path=run.importable_strategy(loaded), config_path="engine.run:StrategyInputs",
            config={"instrument_id": str(row["instrument_id"]), "trade_start_ns": trade_start,
                    "input_start_ns": input_start, "strategy_id": strategy_id(row["symbol"]),
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


class StreamTests(unittest.TestCase):
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
        self.assertTrue(node["fills"] and any(item[0] == "close" for item in node["seen"]["CCCUSDT-PERP.BINANCE"]))
        for key in ("orders", "fills", "positions", "account", "seen", "observer"):
            with self.subTest(key=key):
                self.assertEqual(streamed[key], node[key])
        strip = [[line.split(",", 2)[0] + "," + line.split(",", 2)[2] for line in table] for table in exposures]
        self.assertEqual(strip[1], strip[0])


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
                "effective_config": {"start": utc_text(START * 10**6), "end": utc_text(END * 10**6)}}))
            result = audit(work / "reports")
            summary = json.loads((work / "reports" / "summary.json").read_text())
        late = [item for item in result["findings"] if item.startswith("LATE_ORDER_EVENT")]
        self.assertEqual(len(late), 10, result["findings"])  # five round trips, one finding per order
        self.assertTrue(all("created at" in item for item in late))
        self.assertTrue(summary["integrity_findings"][0].startswith("ORDERS_DENIED_OR_REJECTED"))


if __name__ == "__main__":
    unittest.main()
