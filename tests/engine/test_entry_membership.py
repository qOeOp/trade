"""Only-reduce boundaries on native orders, including resting and partially filled entries."""

import copy
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.model import (
    InstrumentClose, InstrumentCloseType, InstrumentStatus, MarketStatusAction, OrderSide, OrderType, Price,
    Quantity, StrategyId, TimeInForce, TraderId, TriggerType,
)
from nautilus_trader.trading import Strategy, StrategyConfig

from engine.audit import audit, entry_findings
from engine.config import parse_window, utc_text
from engine.load import entry_windows
from engine.report import write_native_reports
from engine.run import ACCOUNT_CONTRACT, Replay, add_venue
from tests.engine.test_fill_model import BAR_NS, BAR_TYPE, INSTRUMENT, INSTRUMENT_ID, START, Bar, MarkPriceUpdate
from tests.engine.test_partial_entry_protection import TieredEntry


CUTOFF, END = START + 3 * BAR_NS - 1_000_000, START + 8 * BAR_NS
PARTIAL = {"partial", "partial_cancel", "partial_expire", "partial_bracket", "partial_bracket_bare", "partial_bracket_cover"}
RESTING = PARTIAL | {"resting", "unfilled", "cancel", "cancel_late", "expire", "resting_rejoin", "emulated",
                     "expiry_between_bars", "fill_at_cut"}
SEED = {"increase", "reduce", "unmarked_exit", "held", "stop", "target", "settlement"}


class EntryProbe(Strategy):
    cover_filled_entry = TieredEntry.cover_filled_entry

    def __init__(self, case, cutoff=CUTOFF):
        super().__init__(StrategyConfig(strategy_id=StrategyId("R1-AAA")))
        self.case, self.n, self.entry, self.lifecycle = case, 0, None, []
        self.cutoff = cutoff

    def market(self, side, reduce=False):
        self.submit_order(self.order_factory.market(INSTRUMENT_ID, side, Quantity.from_str("0.500"), reduce_only=reduce))

    def on_start(self):
        self.subscribe_bars(BAR_TYPE)
        self.subscribe_instrument_status(INSTRUMENT_ID)
        self.subscribe_instrument_close(INSTRUMENT_ID)
        at = self.cutoff if self.case in {"cancel", "partial_cancel", "partial_bracket_bare", "partial_bracket_cover"} else self.cutoff + 1
        if self.case == "rejoin":
            at = self.cutoff + 2 * BAR_NS
        self.clock.set_time_alert_ns("boundary", at, self.at_boundary)

    def on_instrument_status(self, event):
        self.lifecycle.append(event.to_dict())

    def on_instrument_close(self, event):
        self.lifecycle.append(event.to_dict())

    def on_bar(self, _):
        self.n += 1
        if self.n != 1:
            return
        if self.case in SEED:
            self.market(OrderSide.BUY)
            if self.case in {"stop", "target"}:
                order = (self.order_factory.stop_market(INSTRUMENT_ID, OrderSide.SELL, Quantity.from_str("0.500"),
                                                        Price.from_str("90.00"), reduce_only=True)
                         if self.case == "stop" else self.order_factory.limit(
                             INSTRUMENT_ID, OrderSide.SELL, Quantity.from_str("0.500"), Price.from_str("110.00"),
                             reduce_only=True))
                self.submit_order(order)
        elif self.case in RESTING:
            kwargs = ({"time_in_force": TimeInForce.GTD, "expire_time": self.cutoff}
                      if self.case in {"expire", "partial_expire", "expiry_between_bars"} else {})
            if self.case == "emulated":
                kwargs["emulation_trigger"] = TriggerType.DEFAULT
            if self.case.startswith("partial_bracket"):
                bracket = self.order_factory.bracket(
                    INSTRUMENT_ID, OrderSide.BUY, Quantity.from_str("1.000"), entry_order_type=OrderType.LIMIT,
                    entry_price=Price.from_str("95.00"), sl_trigger_price=Price.from_str("90.00"),
                    tp_price=Price.from_str("110.00"), entry_tags=["plan:cut"], sl_tags=["plan:cut"], tp_tags=["plan:cut"])
                self.entry = bracket[0]
                self.submit_order_list(bracket)
            else:
                self.entry = self.order_factory.limit(INSTRUMENT_ID, OrderSide.BUY, Quantity.from_str("1.000"),
                                                       Price.from_str("95.00"), **kwargs)
                self.submit_order(self.entry)

    def at_boundary(self, _):
        if self.case in {"cancel", "cancel_late", "partial_cancel", "partial_bracket_bare", "partial_bracket_cover"}:
            self.cancel_order(self.entry.client_order_id)
        elif self.case in {"open", "increase", "rejoin", "closed"}:
            self.market(OrderSide.BUY)
        elif self.case in {"reduce", "unmarked_exit"}:
            self.market(OrderSide.SELL, self.case == "reduce")

    def on_order_canceled(self, event):
        if self.case == "partial_bracket_cover":
            self.cover_filled_entry(event.client_order_id)

    def replay_diagnostics(self):
        return {}

    def replay_integrity_findings(self, failed=False):
        return []


def native_case(root, case, mode="preclose"):
    engine = BacktestEngine(BacktestEngineConfig(trader_id=TraderId(ACCOUNT_CONTRACT["trader_id"]),
                                                logging=LoggerConfig(stdout_level=LogLevel.ERROR)))
    try:
        add_venue(engine)
        engine.add_instrument(INSTRUMENT)
        cutoff = CUTOFF + 10_000_000_000 if case == "expiry_between_bars" else CUTOFF
        source = EntryProbe(case)
        source.cutoff = cutoff
        engine.add_strategy(source)
        data = []
        for index in range(7):
            at = START + (index + 1) * BAR_NS - 1_000_000
            low = "94.00" if ((case in PARTIAL and index >= 1)
                               or (case in {"resting", "cancel", "cancel_late", "expire"} and at > CUTOFF)
                               or (case == "resting_rejoin" and at > cutoff + BAR_NS)
                               or (case == "fill_at_cut" and at >= cutoff)) else "99.00"
            if at == cutoff and case in {"partial_cancel", "partial_bracket_bare", "partial_bracket_cover"}:
                low = "99.00"  # the cancel at this timestamp has no concurrent entry fill
            prices = [Price.from_str(value) for value in ("100.00", "101.00", low, "100.00")]
            volume = "1.000" if case in PARTIAL and index == 1 else "40.000"
            data.extend([MarkPriceUpdate(INSTRUMENT_ID, prices[-1], at, at),
                         Bar(BAR_TYPE, *prices, Quantity.from_str(volume), at, at)])
        lifecycle = []
        if mode == "preclose":
            lifecycle.append(InstrumentStatus(INSTRUMENT_ID, MarketStatusAction.CLOSE if case == "closed" else
                                              MarketStatusAction.PRE_CLOSE, cutoff, cutoff))
        if case == "settlement":
            at = CUTOFF + BAR_NS
            lifecycle.append(InstrumentClose(INSTRUMENT_ID, Price.from_str("105.00"), InstrumentCloseType.CONTRACT_EXPIRED, at, at))
        data.extend(lifecycle)
        engine.add_data(data)
        engine.run()
        if len(source.lifecycle) != len(lifecycle):
            raise AssertionError("native lifecycle callbacks did not consume the probe inputs")
        counts = {"instrument_status": sum(isinstance(event, InstrumentStatus) for event in lifecycle),
                  "instrument_close": sum(isinstance(event, InstrumentClose) for event in lifecycle)}
        observer = SimpleNamespace(timestamps=7, findings=[], lifecycle={str(INSTRUMENT_ID): counts})
        replay = Replay(engine, engine.get_result(), observer, {"R1-AAA": START})
        window = parse_window(utc_text(START), None, utc_text(END))
        output = root / "reports"
        summary, _ = write_native_reports(
            output, replay, {"AAA": source}, [{"coin": "AAA", "instrument_id": INSTRUMENT_ID, "counts": {}}],
            {"strategy_uses_stop_loss": case.startswith("partial_bracket") or case == "stop", "market_commit": "c" * 32},
            window, ACCOUNT_CONTRACT, [], 7)
        intervals = [[START, END]] if mode == "preclose" else [[START, cutoff]]
        if case in {"rejoin", "resting_rejoin"}:
            intervals.append([CUTOFF + BAR_NS, END])
        episode = {"start_ns": START, "instrument_id": str(INSTRUMENT_ID), "events": source.lifecycle} if lifecycle else None
        receipt = {"format": "execution-input-coverage-v1", "input_identity": {"market_commit": "c" * 32,
                    **({"lifecycle_bundle": "lifecycle-probe"} if lifecycle else {})},
                   "effective_config": {"start": window.start, "trade_start": window.trade_start, "end": window.end},
                   "membership": {"commit": "c" * 32, "membership": {"AAAUSDT": intervals}},
                   "export_receipts": {"AAAUSDT": {"pieces": [{"index": None, "instrument_id": str(INSTRUMENT_ID),
                       "last_bar_ns": START + 7 * BAR_NS - 1_000_000, "counts": counts, "episode": episode}]}}}
        (root / "input-coverage.json").write_text(json.dumps(receipt))
        events = [event.to_dict() for order in engine.cache.orders() for event in order.events()]
        return audit(output), events, receipt, summary
    finally:
        engine.dispose()


class EntryMembershipTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)

    def test_new_entries_unmarked_exits_and_old_orders_fail_in_both_scopes(self):
        for mode in ("preclose", "membership"):
            for case in ("open", "increase", "unmarked_exit", "unfilled", "resting", "cancel_late", "partial", "partial_bracket",
                         "emulated", "expiry_between_bars", "fill_at_cut"):
                with self.subTest(mode=mode, case=case):
                    result, events, _, _ = native_case(self.root, case, mode)
                    found = [item for item in result["findings"] if item.startswith("ENTRY_ORDER_OUTSIDE_MEMBERSHIP:")]
                    self.assertEqual(len(found), 1, result["findings"])
                    if case in PARTIAL:
                        self.assertIn("0.750 unfilled", found[0])
                        self.assertTrue(any(event["type"] == "OrderFilled" and event["ts_event"] < CUTOFF
                                            and event["last_qty"] == "0.250" for event in events))
                    if case == "unfilled":
                        self.assertFalse(any(event["type"] == "OrderFilled" for event in events))

    def test_cancellation_expiry_and_reduce_only_orders_pass_without_forcing_flat(self):
        for mode in ("preclose", "membership"):
            for case in ("cancel", "expire", "partial_cancel", "partial_expire", "reduce", "held", "stop", "target", "partial_bracket_cover"):
                with self.subTest(mode=mode, case=case):
                    result, events, _, summary = native_case(self.root, case, mode)
                    self.assertTrue(result["passed"], result["findings"])
                    if case in {"partial_cancel", "partial_expire", "partial_bracket_cover"}:
                        self.assertTrue(any(event["type"] in {"OrderCanceled", "OrderExpired"}
                                            and event["ts_event"] == CUTOFF for event in events))
                    if case == "reduce":
                        self.assertEqual(sum(event["type"] == "OrderFilled" for event in events), 2)
                    if case == "held":
                        self.assertEqual(summary["closed_trades"], 0)

    def test_canceling_partial_bracket_still_requires_reprotection(self):
        result, _, _, _ = native_case(self.root, "partial_bracket_bare")
        self.assertEqual({item.split(":", 1)[0] for item in result["findings"]}, {"UNPROTECTED_POSITION"})

    def test_reentry_is_allowed_but_resting_entry_cannot_survive_the_membership_gap(self):
        result, _, _, _ = native_case(self.root, "rejoin", "membership")
        self.assertTrue(result["passed"], result["findings"])
        result, _, _, _ = native_case(self.root, "resting_rejoin", "membership")
        self.assertTrue(any(item.startswith("ENTRY_ORDER_OUTSIDE_MEMBERSHIP:") for item in result["findings"]))

    def test_native_settlement_is_reduce_only_and_close_is_not_preclose(self):
        result, events, _, _ = native_case(self.root, "settlement")
        self.assertTrue(result["passed"], result["findings"])
        self.assertTrue(any(event["type"] == "OrderInitialized" and event["client_order_id"].startswith("EXPIRATION-")
                            and event["reduce_only"] is True for event in events))
        result, _, _, _ = native_case(self.root, "closed")
        self.assertTrue(any(item.startswith("INTEGRITY_REPORTED_FAILED:") for item in result["findings"]))

    def test_missing_invalid_and_cross_instrument_scope_cannot_pass(self):
        _, events, receipt, summary = native_case(self.root, "held")
        for change in (lambda x: x.pop("membership"), lambda x: x.update(format="unknown"),
                       lambda x: x["membership"].update(commit="other"),
                       lambda x: x["membership"]["membership"].update(AAAUSDT=[[True, END]]),
                       lambda x: x["export_receipts"]["AAAUSDT"]["pieces"][0].update(instrument_id="OTHER.BINANCE")):
            changed = copy.deepcopy(receipt)
            change(changed)
            self.assertTrue(entry_findings(events, summary, changed)[0].startswith("ENTRY_SCOPE_INVALID:"))
        self.assertTrue(entry_findings(events, summary, None)[0].startswith("ENTRY_SCOPE_INVALID:"))
        bad = copy.deepcopy(events)
        bad[0]["reduce_only"] = "True"
        self.assertTrue(entry_findings(bad, summary, receipt)[0].startswith("ENTRY_SCOPE_INVALID:"))
        receipt["membership"]["membership"]["AAAUSDT"] = [[START, CUTOFF], [CUTOFF, END]]
        self.assertEqual(entry_windows(receipt, summary)[str(INSTRUMENT_ID)], ((START, CUTOFF),))  # PRE_CLOSE still wins
