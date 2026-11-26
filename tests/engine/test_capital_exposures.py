"""The runner seals the observed exposure rows reproducibly and refuses an incomplete observation."""

import csv
import gzip
import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from engine.report import EXPOSURE_COLUMNS, ExposureWriter
from engine.report import capital_findings


ROWS = [(1_767_225_899_999_000_000, "AAAUSDT-PERP.BINANCE-R1-AAA", "100.00000000 USDT", "-1.00000000 USDT", "-0.10000000 USDT")]


class CapitalExposureTests(unittest.TestCase):
    def test_exposure_report_bytes_repeat_and_read_back(self):
        with tempfile.TemporaryDirectory() as temp:
            first, second = Path(temp) / "a.csv.gz", Path(temp) / "b.csv.gz"
            for path in (first, second):
                writer = ExposureWriter(path)
                for row in ROWS:
                    writer.write(row)
                writer.close()
            self.assertEqual(first.read_bytes(), second.read_bytes())
            rows = list(csv.reader(io.StringIO(gzip.decompress(first.read_bytes()).decode())))
        self.assertEqual(rows, [list(EXPOSURE_COLUMNS), [str(value) for value in ROWS[0]]])

    def test_observer_retains_native_partial_realizations(self):
        from decimal import Decimal
        from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
        from nautilus_trader.common import LoggerConfig, LogLevel
        from nautilus_trader.model import Bar, MarkPriceUpdate, OrderSide, Price, Quantity, StrategyId, TraderId
        from nautilus_trader.trading import Strategy, StrategyConfig
        from engine import run
        from tests.engine import test_fill_model as native

        class Partial(Strategy):
            def __init__(self):
                super().__init__(StrategyConfig(strategy_id=StrategyId("R1-AAA")))
                self.count = 0

            def on_start(self):
                self.subscribe_bars(native.BAR_TYPE)

            def on_bar(self, bar):
                # Every order after the first names the one HEDGING position, so it changes in place.
                self.count += 1
                held = self.cache.positions_open(strategy_id=self.strategy_id)
                named = held[0].id if held else None
                if self.count in (2, 5):
                    self.submit_order(self.order_factory.market(native.INSTRUMENT_ID, OrderSide.BUY,
                                                                 Quantity.from_str("2.000")), position_id=named)
                if self.count in (4, 7):
                    self.submit_order(self.order_factory.market(native.INSTRUMENT_ID, OrderSide.SELL,
                                                                 Quantity.from_str("1.000"), reduce_only=True),
                                      position_id=named)

        engine = BacktestEngine(BacktestEngineConfig(trader_id=TraderId(run.ACCOUNT_CONTRACT["trader_id"]),
                  logging=LoggerConfig(stdout_level=LogLevel.OFF, print_config=False)))
        self.addCleanup(engine.dispose)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "exposures.csv.gz"
            run.add_venue(engine, native.fees())
            engine.add_instrument(native.INSTRUMENT)
            engine.add_strategy(Partial())
            observer = run.capital_observer((str(native.INSTRUMENT_ID),), path)
            engine.add_actor(observer)
            data, base = [], native.START
            for i, value in enumerate((100, 110, 90, 85, 90, 80, 75, 75)):
                ts = base + (i + 1) * native.BAR_NS - 1_000_000
                price = Price.from_str(f"{value:.2f}")
                data += [MarkPriceUpdate(native.INSTRUMENT_ID, price, ts, ts),
                         Bar(native.BAR_TYPE, price, price, price, price, Quantity.from_str("1000.000"), ts, ts)]
            engine.add_data(data)
            engine.run()
            observer.finish(engine.cache)
            rows = list(csv.DictReader(io.StringIO(gzip.decompress(path.read_bytes()).decode())))
        self.assertEqual(observer.findings, [])
        self.assertEqual(Decimal(rows[0]["realized_pnl"].split()[0]), Decimal("-0.11000000"), "entry commission")
        self.assertEqual(Decimal(rows[-1]["realized_pnl"].split()[0]), Decimal("-46.94666667"),
                         "two partial exits, including native commissions")
        self.assertEqual(rows[-1]["realized_pnl"], str(engine.cache.positions_open()[0].realized_pnl))

    def test_missed_timestamps_and_unvalued_positions_fail_the_run(self):
        complete = SimpleNamespace(timestamps=3, findings=[])
        self.assertEqual(capital_findings(complete, 3), [])
        missed = SimpleNamespace(timestamps=2, findings=["capital observation cannot value X at 1", "capital observation cannot value X at 1"])
        self.assertEqual(capital_findings(missed, 3), [
            "capital observation cannot value X at 1",
            "CAPITAL_TIMESTAMP_COUNT_MISMATCH: capital observation valued 2 of 3 input timestamps"])

    def _read_reports(self, engine, venue, temp: Path):
        from engine import report
        report.write_reports(temp, engine.cache, engine.generate_orders_report(), engine.generate_fills_report(),
                             engine.generate_positions_report(), engine.generate_account_report(venue=venue))
        def load(name: str) -> list[dict]:
            with (temp / name).open(newline="", encoding="utf-8") as handle:
                return list(csv.DictReader(handle))
        return load("account.csv"), load("positions.csv"), load("fills.csv")

    def _run_quotes(self, strategy_cls, data):
        from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
        from nautilus_trader.common import LoggerConfig, LogLevel
        from nautilus_trader.model import TraderId, Venue
        from engine import config, run
        from tests.engine import test_fill_model as native

        account = config.execution_account("quotes", ("0.10", "0.05"))
        engine = BacktestEngine(BacktestEngineConfig(trader_id=TraderId(account["trader_id"]),
                  logging=LoggerConfig(stdout_level=LogLevel.OFF, print_config=False)))
        self.addCleanup(engine.dispose)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / "exposures.csv.gz"
            run.add_venue(engine, native.fees(), account=account)
            engine.add_instrument(run.with_margins(native.INSTRUMENT, ("0.10", "0.05")))
            engine.add_strategy(strategy_cls())
            observer = run.capital_observer((str(native.INSTRUMENT_ID),), path)
            engine.add_actor(observer)
            engine.add_data(data)
            engine.run()
            observer.finish(engine.cache)
            rows = list(csv.DictReader(io.StringIO(gzip.decompress(path.read_bytes()).decode())))
            acct, positions, fills = self._read_reports(engine, Venue(account["venue"]), root)
        return observer, rows, acct, positions, fills

    def test_quotes_intraminute_close_keeps_bar_t_exposure_and_mark_drawdown(self):
        """#3652: a position open at T with a mark drawdown that closes on a quote in (T, T+60s)
        must still appear on T's exposure row valued at T's mark."""
        from decimal import Decimal
        from nautilus_trader.model import Bar, MarkPriceUpdate, OrderSide, Price, Quantity, QuoteTick, StrategyId
        from nautilus_trader.trading import Strategy, StrategyConfig
        from ledger import metrics
        from tests.engine import test_fill_model as native

        class ExitIntraminute(Strategy):
            def __init__(self):
                super().__init__(StrategyConfig(strategy_id=StrategyId("R1-AAA")))
                self.n = 0

            def on_start(self):
                self.subscribe_bars(native.BAR_TYPE)

            def on_bar(self, bar):
                self.n += 1
                if self.n == 1:
                    self.submit_order(self.order_factory.market(native.INSTRUMENT_ID, OrderSide.BUY,
                                                                 Quantity.from_str("500.000")))
                elif self.n == 2:
                    pos = self.cache.positions_open(strategy_id=self.strategy_id)[0]
                    self.submit_order(self.order_factory.limit(native.INSTRUMENT_ID, OrderSide.SELL,
                                                                Quantity.from_str("500.000"), Price.from_str("100.50"),
                                                                reduce_only=True), position_id=pos.id)

        base, bar_ns, qty = native.START, native.BAR_NS, Quantity.from_str("100000.000")
        t0, t1, t2 = (base + (i + 1) * bar_ns - 1_000_000 for i in range(3))
        q_mid = t1 + 30 * 10**9
        p100, p90, p101 = Price.from_str("100.00"), Price.from_str("90.00"), Price.from_str("101.00")
        data = [
            MarkPriceUpdate(native.INSTRUMENT_ID, p100, t0, t0),
            QuoteTick(native.INSTRUMENT_ID, p100, p100, qty, qty, t0, t0),
            Bar(native.BAR_TYPE, p100, p100, p100, p100, qty, t0, t0),
            MarkPriceUpdate(native.INSTRUMENT_ID, p90, t1, t1),
            QuoteTick(native.INSTRUMENT_ID, p90, p90, qty, qty, t1, t1),
            Bar(native.BAR_TYPE, p90, p90, p90, p90, qty, t1, t1),
            QuoteTick(native.INSTRUMENT_ID, p101, p101, qty, qty, q_mid, q_mid),
            MarkPriceUpdate(native.INSTRUMENT_ID, p100, t2, t2),
            QuoteTick(native.INSTRUMENT_ID, p100, p100, qty, qty, t2, t2),
            Bar(native.BAR_TYPE, p100, p100, p100, p100, qty, t2, t2),
        ]
        observer, rows, account, positions, fills = self._run_quotes(ExitIntraminute, data)
        self.assertEqual(observer.findings, [])
        by_ts = {int(row["ts_event_ns"]): row for row in rows}
        self.assertIn(t0, by_ts)
        self.assertIn(t1, by_ts, "position open at T1 and closed at T1+30s must be valued at T1")
        self.assertNotIn(t2, by_ts, "position already closed before T2 must not appear at T2")
        self.assertEqual(Decimal(by_ts[t1]["notional_value"].split()[0]), Decimal("45000.00000000"))
        self.assertEqual(Decimal(by_ts[t1]["unrealized_pnl"].split()[0]), Decimal("-5000.00000000"))
        summary = {"starting_balance_usdt": "100000", "data_interval_minutes": 1,
                   "period_start_utc": "2026-01-01T00:00:00Z", "period_end_utc": "2026-01-01T00:03:00Z"}
        path = metrics.equity_path(summary, account, rows)
        drawn = metrics.mark_drawdown(summary, path)
        self.assertGreater(drawn["max_drawdown"], 0.05)
        found = metrics.cycles(positions, fills)
        section = metrics._drawdown_section(drawn, path, found, positions, metrics._typed_exposures(rows), Decimal("100000"))
        self.assertIsNone(section["top_instrument"]["null_reason"])
        self.assertEqual(section["top_instrument"]["value"], str(native.INSTRUMENT_ID))

    def test_quotes_intraminute_entry_does_not_leak_into_prior_bar(self):
        """#3652: a position opened on a quote in (T, T+60s) must not leak into T's exposure row."""
        from decimal import Decimal
        from nautilus_trader.model import Bar, MarkPriceUpdate, OrderSide, Price, Quantity, QuoteTick, StrategyId
        from nautilus_trader.trading import Strategy, StrategyConfig
        from ledger import metrics
        from tests.engine import test_fill_model as native

        class EnterIntraminute(Strategy):
            def __init__(self):
                super().__init__(StrategyConfig(strategy_id=StrategyId("R1-AAA")))
                self.n = 0

            def on_start(self):
                self.subscribe_bars(native.BAR_TYPE)

            def on_bar(self, bar):
                self.n += 1
                if self.n == 1:
                    self.submit_order(self.order_factory.limit(native.INSTRUMENT_ID, OrderSide.BUY,
                                                                Quantity.from_str("500.000"), Price.from_str("89.00")))

        base, bar_ns, qty = native.START, native.BAR_NS, Quantity.from_str("100000.000")
        t0, t1, t2 = (base + (i + 1) * bar_ns - 1_000_000 for i in range(3))
        q_mid = t1 + 30 * 10**9
        p100, p95, p88, p85 = (Price.from_str(v) for v in ("100.00", "95.00", "88.00", "85.00"))
        data = [
            MarkPriceUpdate(native.INSTRUMENT_ID, p100, t0, t0),
            QuoteTick(native.INSTRUMENT_ID, p100, p100, qty, qty, t0, t0),
            Bar(native.BAR_TYPE, p100, p100, p100, p100, qty, t0, t0),
            MarkPriceUpdate(native.INSTRUMENT_ID, p95, t1, t1),
            QuoteTick(native.INSTRUMENT_ID, p95, p95, qty, qty, t1, t1),
            Bar(native.BAR_TYPE, p95, p95, p95, p95, qty, t1, t1),
            QuoteTick(native.INSTRUMENT_ID, p88, p88, qty, qty, q_mid, q_mid),
            MarkPriceUpdate(native.INSTRUMENT_ID, p85, t2, t2),
            QuoteTick(native.INSTRUMENT_ID, p85, p85, qty, qty, t2, t2),
            Bar(native.BAR_TYPE, p85, p85, p85, p85, qty, t2, t2),
        ]
        observer, rows, account, positions, fills = self._run_quotes(EnterIntraminute, data)
        self.assertEqual(observer.findings, [])
        by_ts = {int(row["ts_event_ns"]): row for row in rows}
        self.assertNotIn(t0, by_ts)
        self.assertNotIn(t1, by_ts, "position opened at T1+30s must not leak into T1")
        self.assertIn(t2, by_ts)
        self.assertEqual(Decimal(by_ts[t2]["unrealized_pnl"].split()[0]), Decimal("-2000.00000000"))
        summary = {"starting_balance_usdt": "100000", "data_interval_minutes": 1,
                   "period_start_utc": "2026-01-01T00:00:00Z", "period_end_utc": "2026-01-01T00:03:00Z"}
        path = metrics.equity_path(summary, account, rows)
        drawn = metrics.mark_drawdown(summary, path)
        found = metrics.cycles(positions, fills)
        section = metrics._drawdown_section(drawn, path, found, positions, metrics._typed_exposures(rows), Decimal("100000"))
        self.assertIsNone(section["top_instrument"]["null_reason"])

    def test_quotes_intraminute_partial_exit_and_same_minute_open_close(self):
        """#3652: a position partially reduced in (T1, T2) keeps its T1 quantity at T1, and a position
        opened at T1 and closed in (T1, T2) is still valued at T1."""
        from decimal import Decimal
        from nautilus_trader.model import Bar, MarkPriceUpdate, OrderSide, Price, Quantity, QuoteTick, StrategyId
        from nautilus_trader.trading import Strategy, StrategyConfig
        from tests.engine import test_fill_model as native

        class PartialAndQuick(Strategy):
            def __init__(self):
                super().__init__(StrategyConfig(strategy_id=StrategyId("R1-AAA")))
                self.n = 0
                self.first_id = None

            def on_start(self):
                self.subscribe_bars(native.BAR_TYPE)

            def on_bar(self, bar):
                self.n += 1
                if self.n == 1:
                    self.submit_order(self.order_factory.market(native.INSTRUMENT_ID, OrderSide.BUY,
                                                                 Quantity.from_str("2.000")))
                elif self.n == 2:
                    self.first_id = self.cache.positions_open(strategy_id=self.strategy_id)[0].id
                    self.submit_order(self.order_factory.limit(native.INSTRUMENT_ID, OrderSide.SELL,
                                                                Quantity.from_str("1.000"), Price.from_str("95.00"),
                                                                reduce_only=True), position_id=self.first_id)
                    self.submit_order(self.order_factory.market(native.INSTRUMENT_ID, OrderSide.BUY,
                                                                 Quantity.from_str("1.000")))

            def on_position_opened(self, event):
                if self.n == 2 and event.position_id != self.first_id:
                    self.submit_order(self.order_factory.limit(native.INSTRUMENT_ID, OrderSide.SELL,
                                                                Quantity.from_str("1.000"), Price.from_str("95.00"),
                                                                reduce_only=True), position_id=event.position_id)

        base, bar_ns, qty = native.START, native.BAR_NS, Quantity.from_str("100000.000")
        t0, t1, t2 = (base + (i + 1) * bar_ns - 1_000_000 for i in range(3))
        q_mid = t1 + 30 * 10**9
        p100, p90, p96 = Price.from_str("100.00"), Price.from_str("90.00"), Price.from_str("96.00")
        data = [
            MarkPriceUpdate(native.INSTRUMENT_ID, p100, t0, t0),
            QuoteTick(native.INSTRUMENT_ID, p100, p100, qty, qty, t0, t0),
            Bar(native.BAR_TYPE, p100, p100, p100, p100, qty, t0, t0),
            MarkPriceUpdate(native.INSTRUMENT_ID, p90, t1, t1),
            QuoteTick(native.INSTRUMENT_ID, p90, p90, qty, qty, t1, t1),
            Bar(native.BAR_TYPE, p90, p90, p90, p90, qty, t1, t1),
            QuoteTick(native.INSTRUMENT_ID, p96, p96, qty, qty, q_mid, q_mid),
            MarkPriceUpdate(native.INSTRUMENT_ID, p96, t2, t2),
            QuoteTick(native.INSTRUMENT_ID, p96, p96, qty, qty, t2, t2),
            Bar(native.BAR_TYPE, p96, p96, p96, p96, qty, t2, t2),
        ]
        observer, rows, _, _, _ = self._run_quotes(PartialAndQuick, data)
        self.assertEqual(observer.findings, [])
        t1_rows = [row for row in rows if int(row["ts_event_ns"]) == t1]
        t2_rows = [row for row in rows if int(row["ts_event_ns"]) == t2]
        self.assertEqual(len(t1_rows), 2, "both the partially-reduced and same-minute-closed positions were open at T1")
        self.assertEqual(sum(Decimal(row["notional_value"].split()[0]) for row in t1_rows), Decimal("270.00000000"))
        self.assertEqual(len(t2_rows), 1, "only the remaining 1.000 of the first position is open at T2")
        self.assertEqual(Decimal(t2_rows[0]["notional_value"].split()[0]), Decimal("96.00000000"))

    def test_bars_funding_after_bar_t_does_not_leak_into_bar_t_realized_pnl(self):
        """A funding settlement stamped at T1+1ms (HH:00:00.000) belongs to T2, not T1, matching account(<= T1)."""
        from decimal import Decimal
        from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
        from nautilus_trader.common import LoggerConfig, LogLevel
        from nautilus_trader.model import (Bar, FundingRateUpdate, MarkPriceUpdate, OrderSide, Price, Quantity,
                                           StrategyId, TraderId, Venue)
        from nautilus_trader.trading import Strategy, StrategyConfig
        from engine import run
        from ledger import metrics
        from tests.engine import test_fill_model as native

        class HoldAcrossFunding(Strategy):
            def __init__(self):
                super().__init__(StrategyConfig(strategy_id=StrategyId("R1-AAA")))
                self.n = 0

            def on_start(self):
                self.subscribe_bars(native.BAR_TYPE)

            def on_bar(self, bar):
                self.n += 1
                if self.n == 1:
                    self.submit_order(self.order_factory.market(native.INSTRUMENT_ID, OrderSide.BUY,
                                                                 Quantity.from_str("2.000")))

        engine = BacktestEngine(BacktestEngineConfig(trader_id=TraderId(run.ACCOUNT_CONTRACT["trader_id"]),
                  logging=LoggerConfig(stdout_level=LogLevel.OFF, print_config=False)))
        self.addCleanup(engine.dispose)
        base, bar_ns = native.START, native.BAR_NS
        t0, t1, t2 = (base + (i + 1) * bar_ns - 1_000_000 for i in range(3))
        f_ts = t1 + 1_000_000
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / "exposures.csv.gz"
            run.add_venue(engine, native.fees())
            engine.add_instrument(native.INSTRUMENT)
            engine.add_strategy(HoldAcrossFunding())
            observer = run.capital_observer((str(native.INSTRUMENT_ID),), path)
            engine.add_actor(observer)
            data = []
            for ts, px in ((t0, "100.00"), (t1, "90.00"), (t2, "95.00")):
                p = Price.from_str(px)
                data += [MarkPriceUpdate(native.INSTRUMENT_ID, p, ts, ts),
                         Bar(native.BAR_TYPE, p, p, p, p, Quantity.from_str("1000.000"), ts, ts)]
                if ts == t1:
                    data.append(FundingRateUpdate(native.INSTRUMENT_ID, Decimal("0.01"), f_ts, f_ts, None, f_ts))
            engine.add_data(data)
            engine.run()
            observer.finish(engine.cache)
            rows = list(csv.DictReader(io.StringIO(gzip.decompress(path.read_bytes()).decode())))
            account, positions, fills = self._read_reports(engine, Venue(run.ACCOUNT_CONTRACT["venue"]), root)
        self.assertEqual(observer.findings, [])
        by_ts = {int(row["ts_event_ns"]): row for row in rows}
        self.assertEqual(Decimal(by_ts[t1]["realized_pnl"].split()[0]), Decimal("-0.10000000"),
                         "T1 excludes funding stamped at T1+1ms")
        self.assertEqual(Decimal(by_ts[t2]["realized_pnl"].split()[0]), Decimal("-1.90000000"),
                         "T2 includes funding stamped at T1+1ms")
        summary = {"starting_balance_usdt": "100000", "data_interval_minutes": 1,
                   "period_start_utc": "2026-01-01T00:00:00Z", "period_end_utc": "2026-01-01T00:03:00Z"}
        path = metrics.equity_path(summary, account, rows)
        drawn = metrics.mark_drawdown(summary, path)
        found = metrics.cycles(positions, fills)
        section = metrics._drawdown_section(drawn, path, found, positions, metrics._typed_exposures(rows), Decimal("100000"))
        self.assertIsNone(section["top_instrument"]["null_reason"])

    def test_out_of_order_bar_before_mark_still_emits_capital_valuation_gap(self):
        """A fill at T2 arriving before MARK(T2) still triggers CAPITAL_VALUATION_GAP."""
        from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
        from nautilus_trader.common import LoggerConfig, LogLevel
        from nautilus_trader.model import Bar, MarkPriceUpdate, OrderSide, Price, Quantity, StrategyId, TraderId
        from nautilus_trader.trading import Strategy, StrategyConfig
        from engine import run
        from tests.engine import test_fill_model as native

        class EnterOnSecondBar(Strategy):
            def __init__(self):
                super().__init__(StrategyConfig(strategy_id=StrategyId("R1-AAA")))
                self.n = 0

            def on_start(self):
                self.subscribe_bars(native.BAR_TYPE)

            def on_bar(self, bar):
                self.n += 1
                if self.n == 2:
                    self.submit_order(self.order_factory.market(native.INSTRUMENT_ID, OrderSide.BUY,
                                                                 Quantity.from_str("1.000")))

        engine = BacktestEngine(BacktestEngineConfig(trader_id=TraderId(run.ACCOUNT_CONTRACT["trader_id"]),
                  logging=LoggerConfig(stdout_level=LogLevel.OFF, print_config=False)))
        self.addCleanup(engine.dispose)
        base, bar_ns = native.START, native.BAR_NS
        t0, t1 = base + bar_ns - 1_000_000, base + 2 * bar_ns - 1_000_000
        p100 = Price.from_str("100.00")
        qty = Quantity.from_str("1000.000")
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "exposures.csv.gz"
            run.add_venue(engine, native.fees())
            engine.add_instrument(native.INSTRUMENT)
            engine.add_strategy(EnterOnSecondBar())
            observer = run.capital_observer((str(native.INSTRUMENT_ID),), path)
            engine.add_actor(observer)
            # Deliberately put Bar(t1) BEFORE MarkPriceUpdate(t1)
            engine.add_data([
                MarkPriceUpdate(native.INSTRUMENT_ID, p100, t0, t0),
                Bar(native.BAR_TYPE, p100, p100, p100, p100, qty, t0, t0),
                Bar(native.BAR_TYPE, p100, p100, p100, p100, qty, t1, t1),
                MarkPriceUpdate(native.INSTRUMENT_ID, p100, t1, t1),
            ])
            engine.run()
            observer.finish(engine.cache)
        self.assertTrue(any("CAPITAL_VALUATION_GAP" in f and "changed before the next timestamp" in f
                            for f in observer.findings), observer.findings)

    def test_multicontract_mark_carry_hole_and_out_of_order_detection(self):
        """#3652 hardening: a valid 1-minute MARK carry hole on contract 0 when contract 1 has MARK at T1
        must not emit a false CAPITAL_VALUATION_GAP (whether contract 0 opens or modifies/closes at T1),
        while a genuinely out-of-order Bar(AAA, T1) -> MARK(BBB, T1) -> MARK(AAA, T1) still emits one."""
        from decimal import Decimal
        from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
        from nautilus_trader.common import LoggerConfig, LogLevel
        from nautilus_trader.model import (Bar, BarType, CryptoPerpetual, Currency, InstrumentId, MarkPriceUpdate,
                                           OrderSide, Price, Quantity, StrategyId, Symbol, TraderId)
        from nautilus_trader.trading import Strategy, StrategyConfig
        from engine import run
        from tests.engine import test_fill_model as native

        inst_b = CryptoPerpetual(
            instrument_id=InstrumentId.from_str("BBBUSDT-PERP.BINANCE"), raw_symbol=Symbol("BBBUSDT"),
            base_currency=Currency.from_str("BBB"), quote_currency=Currency.from_str("USDT"),
            settlement_currency=Currency.from_str("USDT"), is_inverse=False, price_precision=2, size_precision=3,
            price_increment=Price.from_str("0.01"), size_increment=Quantity.from_str("0.001"),
            ts_event=0, ts_init=0, margin_init=Decimal("0.10"), margin_maint=Decimal("0.05"),
        )
        bar_type_b = BarType.from_str("BBBUSDT-PERP.BINANCE-1-MINUTE-LAST-EXTERNAL")
        base, bar_ns, qty = native.START, native.BAR_NS, Quantity.from_str("1000.000")
        t0, t1, t2 = (base + (i + 1) * bar_ns - 1_000_000 for i in range(3))
        p100, p95 = Price.from_str("100.00"), Price.from_str("95.00")

        def run_case(strategy_cls, data):
            engine = BacktestEngine(BacktestEngineConfig(trader_id=TraderId(run.ACCOUNT_CONTRACT["trader_id"]),
                                    logging=LoggerConfig(stdout_level=LogLevel.OFF, print_config=False)))
            self.addCleanup(engine.dispose)
            with tempfile.TemporaryDirectory() as temp:
                path = Path(temp) / "exposures.csv.gz"
                run.add_venue(engine, native.fees())
                engine.add_instrument(native.INSTRUMENT)
                engine.add_instrument(inst_b)
                engine.add_strategy(strategy_cls())
                observer = run.capital_observer((str(native.INSTRUMENT_ID), str(inst_b.id)), path)
                engine.add_actor(observer)
                engine.add_data(data)
                engine.run()
                observer.finish(engine.cache)
                rows = list(csv.DictReader(io.StringIO(gzip.decompress(path.read_bytes()).decode())))
            return observer, rows

        # 1. Valid carry hole at t1 on AAA: Bar(AAA, t1) opens position before MARK(BBB, t1).
        class OpenOnT1(Strategy):
            def __init__(self):
                super().__init__(StrategyConfig(strategy_id=StrategyId("R1-AAA")))
                self.n = 0

            def on_start(self):
                self.subscribe_bars(native.BAR_TYPE)

            def on_bar(self, bar):
                self.n += 1
                if self.n == 2:
                    self.submit_order(self.order_factory.market(native.INSTRUMENT_ID, OrderSide.BUY,
                                                                 Quantity.from_str("1.000")))

        hole_data = [
            MarkPriceUpdate(native.INSTRUMENT_ID, p100, t0, t0),
            Bar(native.BAR_TYPE, p100, p100, p100, p100, qty, t0, t0),
            MarkPriceUpdate(inst_b.id, p100, t0, t0),
            Bar(bar_type_b, p100, p100, p100, p100, qty, t0, t0),
            Bar(native.BAR_TYPE, p100, p100, p100, p100, qty, t1, t1),
            MarkPriceUpdate(inst_b.id, p100, t1, t1),
            Bar(bar_type_b, p100, p100, p100, p100, qty, t1, t1),
            MarkPriceUpdate(native.INSTRUMENT_ID, p100, t2, t2),
            Bar(native.BAR_TYPE, p100, p100, p100, p100, qty, t2, t2),
            MarkPriceUpdate(inst_b.id, p100, t2, t2),
            Bar(bar_type_b, p100, p100, p100, p100, qty, t2, t2),
        ]
        obs1, rows1 = run_case(OpenOnT1, hole_data)
        self.assertEqual(obs1.findings, [])
        self.assertEqual([int(r["ts_event_ns"]) for r in rows1], [t1, t2])
        self.assertEqual(len(obs1.carried), 1)
        self.assertEqual(obs1.carried[0]["from_ns"], t1)

        # 2. Valid carry hole at t1 on AAA: position open at t0 and closed on Bar(AAA, t1) before MARK(BBB, t1).
        class OpenT0CloseT1(Strategy):
            def __init__(self):
                super().__init__(StrategyConfig(strategy_id=StrategyId("R1-AAA")))
                self.n = 0

            def on_start(self):
                self.subscribe_bars(native.BAR_TYPE)

            def on_bar(self, bar):
                self.n += 1
                if self.n == 1:
                    self.submit_order(self.order_factory.market(native.INSTRUMENT_ID, OrderSide.BUY,
                                                                 Quantity.from_str("2.000")))
                elif self.n == 2:
                    pos = self.cache.positions_open(strategy_id=self.strategy_id)[0]
                    self.submit_order(self.order_factory.market(native.INSTRUMENT_ID, OrderSide.SELL,
                                                                 Quantity.from_str("2.000"), reduce_only=True),
                                      position_id=pos.id)

        obs2, rows2 = run_case(OpenT0CloseT1, hole_data)
        self.assertEqual(obs2.findings, [])
        self.assertEqual([int(r["ts_event_ns"]) for r in rows2], [t0])
        self.assertEqual(Decimal(rows2[0]["notional_value"].split()[0]), Decimal("200.00000000"))

        # 3. True out-of-order: Bar(AAA, t1) -> MARK(BBB, t1) -> MARK(AAA, t1) must still emit CAPITAL_VALUATION_GAP.
        ooo_data = [
            MarkPriceUpdate(native.INSTRUMENT_ID, p100, t0, t0),
            Bar(native.BAR_TYPE, p100, p100, p100, p100, qty, t0, t0),
            MarkPriceUpdate(inst_b.id, p100, t0, t0),
            Bar(bar_type_b, p100, p100, p100, p100, qty, t0, t0),
            Bar(native.BAR_TYPE, p95, p95, p95, p95, qty, t1, t1),
            MarkPriceUpdate(inst_b.id, p100, t1, t1),
            MarkPriceUpdate(native.INSTRUMENT_ID, p95, t1, t1),
            Bar(bar_type_b, p100, p100, p100, p100, qty, t1, t1),
        ]
        obs3, _ = run_case(OpenOnT1, ooo_data)
        self.assertTrue(any("CAPITAL_VALUATION_GAP" in f and "changed before MARK" in f for f in obs3.findings),
                        obs3.findings)

        # 4. Single-contract 1m MARK hole at t1 -> next MARK at t2 (strictly ordered; must keep t0 exposure row).
        obs4, rows4 = run_case(OpenT0CloseT1, [
            MarkPriceUpdate(native.INSTRUMENT_ID, p100, t0, t0),
            Bar(native.BAR_TYPE, p100, p100, p100, p100, qty, t0, t0),
            Bar(native.BAR_TYPE, p100, p100, p100, p100, qty, t1, t1),
            MarkPriceUpdate(native.INSTRUMENT_ID, p100, t2, t2),
            Bar(native.BAR_TYPE, p100, p100, p100, p100, qty, t2, t2),
        ])
        self.assertEqual(obs4.findings, [])
        self.assertEqual([int(r["ts_event_ns"]) for r in rows4], [t0])

        # 5. Simultaneous multi-contract 1m MARK hole at t1; MARK(BBB, t2) before MARK(AAA, t2).
        obs5, rows5 = run_case(OpenT0CloseT1, [
            MarkPriceUpdate(native.INSTRUMENT_ID, p100, t0, t0),
            Bar(native.BAR_TYPE, p100, p100, p100, p100, qty, t0, t0),
            MarkPriceUpdate(inst_b.id, p100, t0, t0),
            Bar(bar_type_b, p100, p100, p100, p100, qty, t0, t0),
            Bar(native.BAR_TYPE, p100, p100, p100, p100, qty, t1, t1),
            Bar(bar_type_b, p100, p100, p100, p100, qty, t1, t1),
            MarkPriceUpdate(inst_b.id, p100, t2, t2),
            MarkPriceUpdate(native.INSTRUMENT_ID, p100, t2, t2),
            Bar(native.BAR_TYPE, p100, p100, p100, p100, qty, t2, t2),
            Bar(bar_type_b, p100, p100, p100, p100, qty, t2, t2),
        ])
        self.assertEqual(obs5.findings, [])
        self.assertEqual([int(r["ts_event_ns"]) for r in rows5], [t0])

        # 6. Final-bar MARK hole at t1 valued in finish() (next_ts=None).
        obs6, rows6 = run_case(OpenT0CloseT1, [
            MarkPriceUpdate(native.INSTRUMENT_ID, p100, t0, t0),
            Bar(native.BAR_TYPE, p100, p100, p100, p100, qty, t0, t0),
            Bar(native.BAR_TYPE, p100, p100, p100, p100, qty, t1, t1),
        ])
        self.assertEqual(obs6.findings, [])
        self.assertEqual([int(r["ts_event_ns"]) for r in rows6], [t0])
