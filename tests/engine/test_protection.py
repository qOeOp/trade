"""engine.protection: one stop-coverage judgment, and Paper and Live apply it to the native cache; Live's source sees
MARK and funding at the replay's cadence and is refused at once outside the contract."""

import gc
import hashlib
from decimal import Decimal
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock
from unittest.mock import Mock

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.model import FundingRateUpdate, MarkPriceUpdate, Price, TraderId

from engine import live, live_source as live_source_runtime, paper, strategy as strategy_runtime
from engine.protection import ALLOWANCE_NS, Gaps, Order, stop_quantity
from engine.run import ACCOUNT_CONTRACT, add_venue
from tests.engine import test_fill_model as fixture
from tests.engine.test_order_rules import Probe

MINUTE_NS = 60_000_000_000


def stop(side="SELL", kind="STOP_MARKET", reduce_only=True, status="ACCEPTED", leaves="1"):
    return Order(side, kind, reduce_only, status, Decimal(leaves))


class JudgmentTests(unittest.TestCase):
    def test_only_resting_reduce_only_stops_on_the_closing_side_count(self):
        self.assertEqual(stop_quantity(Decimal(1), [stop(), stop(kind="TRAILING_STOP_LIMIT")]), Decimal(2))
        for name, order in {"triggered": stop(status="TRIGGERED"), "partly filled": stop(status="PARTIALLY_FILLED"),
                            "pending cancel": stop(status="PENDING_CANCEL"), "opening side": stop(side="BUY"),
                            "not reduce-only": stop(reduce_only=False), "limit": stop(kind="LIMIT")}.items():
            with self.subTest(name=name):
                self.assertEqual(stop_quantity(Decimal(1), [order]), 0)
        self.assertEqual(stop_quantity(Decimal(-1), [stop(side="BUY", leaves="0.4")]), Decimal("0.4"))
        self.assertEqual(stop_quantity(Decimal(0), [stop()]), 0)

    def test_a_gap_is_reported_once_after_the_allowance(self):
        gaps = Gaps()
        self.assertEqual(gaps.update(0, ["P"]), [])
        self.assertEqual(gaps.update(ALLOWANCE_NS, ["P"]), [])
        self.assertEqual(gaps.update(ALLOWANCE_NS + 1, ["P"]), ["P"])
        self.assertEqual(gaps.update(2 * ALLOWANCE_NS, ["P"]), [])
        self.assertEqual(gaps.update(3 * ALLOWANCE_NS, []), [])  # covered: the next gap starts afresh
        self.assertEqual(gaps.update(4 * ALLOWANCE_NS, ["P"]), [])
        self.assertEqual(gaps.update(5 * ALLOWANCE_NS + 1, ["P"]), ["P"])


class PaperProtectionTests(unittest.TestCase):
    def test_paper_journals_an_unprotected_position_once_by_event_time(self):
        engine = BacktestEngine(BacktestEngineConfig(trader_id=TraderId(ACCOUNT_CONTRACT["trader_id"]),
                                                     logging=LoggerConfig(stdout_level=LogLevel.ERROR)))
        try:
            add_venue(engine, fixture.fees())
            engine.add_instrument(fixture.INSTRUMENT)
            engine.add_strategy(Probe({2: lambda s: s.submit_order(s.limit(price="99.50"))}))
            ts = [fixture.START + (index + 1) * MINUTE_NS - 1_000_000 for index in range(4)]
            engine.add_data([fixture.Bar(fixture.BAR_TYPE, *[Price.from_str(v) for v in fixture.FLAT],
                                         fixture.Quantity.from_str("40.000"), at, at) for at in ts])
            engine.run()
            now = [0]
            recorder = SimpleNamespace(cache=engine.cache, gaps=Gaps(),
                                       clock=SimpleNamespace(timestamp_ns=lambda: now[0]))
            journalled = []
            with mock.patch.object(paper, "journal", lambda kind, **fields: journalled.append((kind, fields))):
                for now[0] in (0, ALLOWANCE_NS, ALLOWANCE_NS + 1, 3 * ALLOWANCE_NS):
                    paper.Recorder._protection(recorder)
            self.assertEqual([(kind, fields["position"], fields["stop_quantity"], fields["since_ns"])
                              for kind, fields in journalled], [("protection_gap", "0.500", "0", 0)])
        finally:
            engine.dispose()


class LiveContractTests(unittest.TestCase):
    SOURCE = '''from nautilus_trader.trading import Strategy
class Source(Strategy):
    def __init__(self, instrument_id, bar_type, **kwargs):
        super().__init__()
        self.observed = []
    def on_mark_price(self, update):
        self.observed.append(("mark", update.ts_event))
    def on_funding_rate(self, update):
        self.observed.append(("funding", update.ts_event))
    def replay_diagnostics(self):
        return {}
    def replay_integrity_findings(self, orders_denied_or_rejected=False):
        return []
'''

    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.output = Path(temp.name)
        live.strategy_runtime.clear_failures()
        path, universe = self.output / "source.py", self.output / "universe.json"
        path.write_text(self.SOURCE)
        universe.write_text('{"membership":{"AAAUSDT":[[0,9999999999999999999]]}}')
        manifest = dict(run_id="contract", symbols=["AAAUSDT"], strategy_file=str(path), account_id="BINANCE-001",
                        universe_file=str(universe), universe_sha256=hashlib.sha256(universe.read_bytes()).hexdigest(),
                        source=dict(entry_class="Source", source_sha256=hashlib.sha256(self.SOURCE.encode()).hexdigest()),
                        config=dict(duration_seconds=3600, budget_usdt="100",
                                    max_loss_usdt="10"))
        self.session = live.Session(manifest, self.output, "run", account_verified=True)
        self.session.node = Mock()
        self.source = live_source_runtime.live_source(live.source_for_run(manifest), self.session)
        self.session.source = self.source

    def tearDown(self):
        self.session.source = self.session.node = self.source = None
        gc.collect()
        live.strategy_runtime.clear_failures()

    def test_the_source_sees_the_first_mark_of_each_minute_and_one_update_per_settlement(self):
        iid, minute = fixture.INSTRUMENT_ID, (live.time.time_ns() // MINUTE_NS + 2) * MINUTE_NS
        for at in (minute, minute + 1, minute + MINUTE_NS):
            self.source.on_mark_price(MarkPriceUpdate(iid, Price.from_str("100.00"), at, at))
        settlement = minute + 8 * 60 * MINUTE_NS
        for at, following in ((minute, settlement), (minute + 1, settlement),
                              (settlement + 1, settlement + 8 * 60 * MINUTE_NS)):
            self.source.on_funding_rate(FundingRateUpdate(iid, Decimal("0.0001"), at, at, None, following))
        self.assertEqual(self.source.observed, [("mark", minute), ("mark", minute + MINUTE_NS),
                                                ("funding", settlement)])

    def test_a_subscription_outside_the_contract_raises_at_once(self):
        with self.assertRaisesRegex(Exception, "SUBSCRIPTION_OUTSIDE_CONTRACT"):
            self.source.subscribe_quotes(fixture.INSTRUMENT_ID)
        self.assertEqual(strategy_runtime.BREACHES, [])


if __name__ == "__main__":
    unittest.main()
