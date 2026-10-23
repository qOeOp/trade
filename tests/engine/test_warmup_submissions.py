"""Native submission clocks, including dormant orders, and independent warm-up audit boundaries."""

import copy
import unittest

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.model import Bar, MarkPriceUpdate, OrderSide, Price, Quantity, StrategyId, TraderId, TriggerType
from nautilus_trader.trading import Strategy, StrategyConfig

from engine.audit import submission_findings
from engine.config import ACCOUNT_CONTRACT, utc_text
from engine.run import add_venue
from tests.engine.test_fill_model import BAR_NS, BAR_TYPE, FLAT, INSTRUMENT, INSTRUMENT_ID, START


TRADE_START = START + 2 * BAR_NS
SUMMARY = {"input_start_utc": utc_text(START), "period_start_utc": utc_text(TRADE_START),
           "period_end_utc": utc_text(START + 6 * BAR_NS), "trade_start_by_strategy": {"R1-AAA": TRADE_START}}


class SubmissionProbe(Strategy):
    def __init__(self, case):
        super().__init__(StrategyConfig(strategy_id=StrategyId("R1-AAA")))
        self.case, self.n, self.prepared = case, 0, None

    def make_order(self):
        return self.order_factory.limit(INSTRUMENT_ID, OrderSide.BUY, Quantity.from_str("0.500"),
                                        Price.from_str("90.00"))

    def on_start(self):
        self.subscribe_bars(BAR_TYPE)
        if self.case == "on_start":
            self.submit_order(self.make_order())
        if self.case == "timer":
            self.clock.set_time_alert_ns("early", START + BAR_NS + 1, self.on_timer)

    def on_timer(self, _):
        self.submit_order(self.make_order())

    def on_bar(self, _):
        self.n += 1
        if self.n == 1 and self.case in {"prepare_only", "prepare_then_submit", "prepare_bracket"}:
            self.prepared = (self.order_factory.bracket(
                INSTRUMENT_ID, OrderSide.BUY, Quantity.from_str("0.500"), sl_trigger_price=Price.from_str("95.00"),
                tp_price=Price.from_str("105.00")) if self.case == "prepare_bracket" else self.make_order())
        later = self.case in {"at_start", "prepare_then_submit", "prepare_bracket"}
        if self.n != (3 if later else 1) or self.case in {"prepare_only", "on_start", "timer"}:
            return
        if self.case in {"bracket", "prepare_bracket"}:
            bracket = self.prepared if self.case == "prepare_bracket" else self.order_factory.bracket(
                INSTRUMENT_ID, OrderSide.BUY, Quantity.from_str("0.500"), sl_trigger_price=Price.from_str("95.00"),
                tp_price=Price.from_str("105.00"))
            self.submit_order_list(bracket)
        elif self.case == "market":
            self.submit_order(self.order_factory.market(INSTRUMENT_ID, OrderSide.BUY, Quantity.from_str("0.500")))
        elif self.case == "emulated":
            self.submit_order(self.order_factory.limit(INSTRUMENT_ID, OrderSide.BUY, Quantity.from_str("0.500"),
                                                       Price.from_str("90.00"), emulation_trigger=TriggerType.DEFAULT))
        else:
            self.submit_order(self.prepared if self.case == "prepare_then_submit" else self.make_order())


def native_events(case):
    engine = BacktestEngine(BacktestEngineConfig(trader_id=TraderId(ACCOUNT_CONTRACT["trader_id"]),
                                                logging=LoggerConfig(stdout_level=LogLevel.ERROR)))
    try:
        add_venue(engine)
        engine.add_instrument(INSTRUMENT)
        engine.add_strategy(SubmissionProbe(case))
        data = []
        for index in range(6):
            ts = START + index * BAR_NS
            prices = [Price.from_str(value) for value in FLAT]
            data += [MarkPriceUpdate(INSTRUMENT_ID, prices[-1], ts, ts),
                     Bar(BAR_TYPE, *prices, Quantity.from_str("40.000"), ts, ts)]
        engine.add_data(data)
        engine.run()
        return [event.to_dict() for order in engine.cache.orders() for event in order.events()]
    finally:
        engine.dispose()


class WarmupSubmissionTests(unittest.TestCase):
    def test_native_early_submissions_fail_even_without_a_fill(self):
        for case, count in (("market", 1), ("limit", 1), ("bracket", 3), ("on_start", 1), ("timer", 1), ("emulated", 1)):
            with self.subTest(case=case):
                events = native_events(case)
                found = submission_findings(events, SUMMARY)
                self.assertEqual(len(found), count, found)
                self.assertTrue(all(item.startswith("ORDER_BEFORE_TRADE_START:") for item in found), found)
                if case in {"limit", "on_start", "timer", "emulated"}:
                    self.assertFalse(any(event["type"] == "OrderFilled" for event in events))
                if case == "emulated":
                    self.assertFalse(any(event["type"] == "OrderSubmitted" for event in events))

    def test_native_preparation_and_submission_exactly_at_start_pass(self):
        for case in ("prepare_only", "prepare_then_submit", "prepare_bracket", "at_start"):
            with self.subTest(case=case):
                events = native_events(case)
                self.assertEqual(submission_findings(events, SUMMARY), [])
                if case == "prepare_only":
                    self.assertEqual(events, [])
                else:
                    submitted = [event for event in events if event["type"] == "OrderSubmitted"]
                    self.assertTrue(submitted)
                    self.assertTrue(all(event["ts_event"] == TRADE_START for event in submitted))
                    if case.startswith("prepare_"):
                        self.assertTrue(any(event["type"] == "OrderInitialized" and event["ts_event"] < TRADE_START
                                            for event in events))

    def test_each_submitting_instance_uses_its_own_start_even_on_another_instrument(self):
        summary = copy.deepcopy(SUMMARY)
        summary["trade_start_by_strategy"]["R1-LATE"] = TRADE_START + BAR_NS
        event = {"type": "OrderSubmitted", "strategy_id": "R1-LATE", "instrument_id": str(INSTRUMENT_ID),
                 "client_order_id": "cross-instrument", "ts_event": TRADE_START}
        self.assertTrue(submission_findings([event], summary)[0].startswith("ORDER_BEFORE_TRADE_START:"))
        event["ts_event"] = TRADE_START + BAR_NS
        self.assertEqual(submission_findings([event], summary), [])

    def test_missing_invalid_and_unknown_instance_starts_never_pass(self):
        events = native_events("at_start")
        for starts in (None, {}, [], {"R1-AAA": True}, {"R1-AAA": str(TRADE_START)},
                       {"R1-AAA": TRADE_START - 1}, {"R1-AAA": START + 6 * BAR_NS}, {"R1-OTHER": TRADE_START}):
            with self.subTest(starts=starts):
                found = submission_findings(events, {**SUMMARY, "trade_start_by_strategy": starts})
                self.assertTrue(found and all(item.startswith("TRADE_START_INVALID:") for item in found), found)

    def test_receipt_window_identity_and_listing_bound_instance_starts(self):
        receipt = {"effective_config": {"start": utc_text(START), "trade_start": utc_text(TRADE_START),
                                        "end": utc_text(START + 6 * BAR_NS)},
                   "export_receipts": {"AAAUSDT": {"pieces": [{"index": None, "episode": {"start_ns": START}}]}}}
        events = native_events("at_start")
        self.assertEqual(submission_findings(events, SUMMARY, receipt), [])
        for change in (lambda x: x["effective_config"].update(trade_start=utc_text(START)),
                       lambda x: x["export_receipts"]["AAAUSDT"]["pieces"][0]["episode"].update(start_ns=TRADE_START + 1),
                       lambda x: x["export_receipts"]["AAAUSDT"]["pieces"][0].update(index=1)):
            changed = copy.deepcopy(receipt)
            change(changed)
            self.assertTrue(submission_findings(events, SUMMARY, changed)[0].startswith("TRADE_START_INVALID:"))
