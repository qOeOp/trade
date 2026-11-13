"""A running Paper reads each new month's membership from the host's month file once the month has begun: a contract
that stays a member keeps entering, one that left (or whose month file is not there yet) only reduces (coverage U9)."""

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.model import Bar, MarkPriceUpdate, OrderSide, Price, Quantity, TraderId

from engine import order_rules, paper, run
from engine import strategy as strategy_runtime
from engine.load import load_strategy
from tests.engine import test_fill_model as fixture
from tests.helpers import refused

JAN = int(datetime(2026, 1, 10, tzinfo=UTC).timestamp() * 1e9)
FEB = int(datetime(2026, 2, 1, tzinfo=UTC).timestamp() * 1e9)
MAR = int(datetime(2026, 3, 1, tzinfo=UTC).timestamp() * 1e9)
MINUTE = 60_000_000_000
SOURCE = '''from nautilus_trader.trading import Strategy

class Source(Strategy):
    def __init__(self, instrument_id, bar_type, universe_membership, **kwargs):
        super().__init__()
        self.universe_membership = universe_membership

    def replay_diagnostics(self):
        return {}

    def replay_integrity_findings(self, orders_denied_or_rejected=False):
        return []
'''


class Clocked(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.months = self.root / "membership"
        self.months.mkdir()
        self.now = JAN
        self.lines: list[tuple[str, dict]] = []
        for name, value in (("NOW", lambda: self.now), ("journal", lambda kind, **fields: self.lines.append((kind, fields)))):
            patcher = mock.patch.object(paper, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def month(self, members: list[str]) -> bytes:
        data = json.dumps({"members": members}).encode()
        (self.months / "2026-02.json").write_bytes(data)
        return data


class MembershipTests(Clocked):
    def test_the_plan_takes_the_universe_file_through_the_input_start_month_only(self):
        planned = paper.plan(["AAAUSDT"], {"AAAUSDT": [[JAN - MINUTE, MAR]]}, JAN, JAN, self.months)
        self.assertEqual(list(planned[0].universe_membership), [(JAN, FEB)])

    def test_each_month_comes_from_its_file_once_begun_and_a_missing_file_reduces_only(self):
        stays = paper.Membership("AAAUSDT", [(JAN, FEB)], FEB, self.months)
        leaves = paper.Membership("BBBUSDT", [(JAN, FEB)], FEB, self.months)
        self.month(["AAAUSDT", "BBBUSDT"])  # written early: not read before February begins
        copied = tuple(stays)
        self.assertEqual((list(stays), self.lines), ([(JAN, FEB)], []))
        (self.months / "2026-02.json").unlink()
        self.now = FEB + 30 * MINUTE
        self.assertFalse(stays.member_at(self.now) or stays.member_at(self.now))  # read twice, journaled once
        self.assertEqual(self.lines, [("membership_stale", {"code": "PAPER_MEMBERSHIP_STALE", "symbol": "AAAUSDT",
                                                            "month": "2026-02"})])
        data = self.month(["AAAUSDT"])
        self.assertEqual((list(stays), list(leaves)), ([(JAN, MAR)], [(JAN, FEB)]))
        self.assertEqual((stays.member_at(self.now), leaves.member_at(self.now), copied), (True, False, ((JAN, FEB),)))
        self.assertEqual(self.lines[1:], [("membership", {"symbol": symbol, "month": "2026-02", "member": member,
                                                          "sha256": hashlib.sha256(data).hexdigest()})
                                          for symbol, member in (("AAAUSDT", True), ("BBBUSDT", False))])

    def test_a_malformed_month_file_is_refused(self):
        stays = paper.Membership("AAAUSDT", [(JAN, FEB)], FEB, self.months)
        (self.months / "2026-02.json").write_text('{"members": "AAAUSDT"}')
        self.now = FEB
        self.assertEqual(refused(list, stays, error=paper.Refusal).code, "UNIVERSE_FILE_INVALID")


class RunningPaperTests(Clocked):
    """The Paper strategy class in a native engine across the month boundary."""

    def test_after_the_month_a_contract_that_left_only_reduces_and_one_that_stays_enters_again(self):
        path = self.root / "source.py"
        path.write_text(SOURCE)
        loaded = load_strategy(path, "Source", hashlib.sha256(SOURCE.encode()).hexdigest())
        for registry in (order_rules.WARMING, strategy_runtime.DECLARED, strategy_runtime.BREACHES):
            registry.clear()
            self.addCleanup(registry.clear)
        membership = paper.Membership("AAAUSDT", [(JAN, FEB)], FEB, self.months)
        inputs = paper.PaperInputs(str(fixture.INSTRUMENT_ID), JAN, JAN, "SOURCE-001", membership, JAN)
        engine = BacktestEngine(BacktestEngineConfig(trader_id=TraderId(run.ACCOUNT_CONTRACT["trader_id"]),
                                                     logging=LoggerConfig(stdout_level=LogLevel.ERROR)))
        self.addCleanup(engine.dispose)
        run.add_venue(engine, fixture.fees())
        engine.add_instrument(fixture.INSTRUMENT)
        source = run.configure_strategy(loaded, inputs, paper.paper_class)
        engine.add_strategy(source)
        order_rules.WARMING.discard("SOURCE-001")  # the runner's warm-up has ended
        self.now = FEB - 10 * MINUTE
        self.assertIs(source.universe_membership, membership)

        def feed(until: int) -> None:
            stamps = range(self.now + MINUTE - 1_000_000, until, MINUTE)
            price = Price.from_str("100.00")
            engine.add_data([item for ts in stamps for item in (
                Bar(fixture.BAR_TYPE, price, Price.from_str("101.00"), Price.from_str("99.00"), price,
                    Quantity.from_str("40.000"), ts, ts), MarkPriceUpdate(fixture.INSTRUMENT_ID, price, ts, ts))])
            engine.run(None, until, None, True)
            engine.clear_data()
            self.now = until

        def entry():
            order = source.order_factory.limit(fixture.INSTRUMENT_ID, OrderSide.BUY, Quantity.from_str("0.010"),
                                               Price.from_str("100.50"))
            source.submit_order(order)
            return engine.cache.order(order.client_order_id)

        feed(FEB - 5 * MINUTE)
        self.assertIsNotNone(entry())  # January: a member
        feed(FEB + 5 * MINUTE)
        [position] = engine.cache.positions_open()
        self.assertIsNone(entry())  # February, no month file yet: not sent
        exit_ = source.order_factory.market(fixture.INSTRUMENT_ID, OrderSide.SELL, Quantity.from_str("0.005"),
                                            reduce_only=True)
        source.submit_order(exit_, position_id=position.id)  # an exit still goes
        feed(FEB + 7 * MINUTE)
        self.assertEqual(engine.cache.order(exit_.client_order_id).status.name, "FILLED")
        self.month(["AAAUSDT"])
        self.assertIsNotNone(entry())  # February's file holds it: it enters again
        self.assertEqual([kind for kind, _ in self.lines if kind in ("entry_not_sent", "membership_stale", "membership")],
                         ["membership_stale", "entry_not_sent", "membership"])
        self.assertEqual(strategy_runtime.BREACHES, [])
