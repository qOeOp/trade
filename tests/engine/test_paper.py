"""engine.paper without a network: the credential refusal, the replay cadence of the live feed, the strategy's
data callbacks held until the fills their data caused are applied, the daily warm-up from public klines, the
instances a run plans and the event fields the live view draws from."""

import unittest
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest import mock

from nautilus_trader.model import FundingRateUpdate, InstrumentId, MarkPriceUpdate, Price

from engine import paper
from engine.config import MINUTE_NS, Refusal
from engine.load import DAY_NS, WARMUP_DAYS

IID = InstrumentId.from_str("BTCUSDT-PERP.BINANCE")
DAY = int(datetime(2026, 10, 25, tzinfo=UTC).timestamp() * 1e9)


def mark(ts: int) -> MarkPriceUpdate:
    return MarkPriceUpdate(IID, Price.from_str("100.0"), ts, ts)


def estimate(ts: int, next_funding_ns: int, rate: str = "0.0001") -> FundingRateUpdate:
    return FundingRateUpdate(IID, Decimal(rate), ts, ts, None, next_funding_ns)


def klines(start_ns: int, days: int) -> list[list]:
    """Binance daily kline rows (open time, OHLC, volume, close time in ms) for the days before `start_ns`."""
    rows = []
    for back in range(days, 0, -1):
        open_ms = (start_ns - back * DAY_NS) // 1_000_000
        rows.append([open_ms, "100.1", "101.2", "99.3", "100.4", "12.345", open_ms + 86_400_000 - 1])
    return rows


class HoldTests(unittest.TestCase):
    def test_data_callbacks_run_later_in_their_order_and_one_that_raises_stops_none(self):
        alerts, seen = [], []
        clock = SimpleNamespace(timestamp_ns=lambda: DAY,
                                set_time_alert_ns=lambda name, at, callback: alerts.append((name, at, callback)))

        class Source:
            def on_bar(self, bar):
                seen.append(("bar", bar))
                if bar == 2:
                    raise ValueError("recorded by its guard")

            def on_mark_price(self, update):
                seen.append(("mark", update))

        held = type("Held", (), {**paper.paper_callbacks(Source), "clock": None})
        instance = held()
        instance._paper_held, instance._paper_cadence = [], mock.Mock(**{"mark.return_value": True})
        with mock.patch.object(paper.Strategy, "clock", SimpleNamespace(__get__=lambda *_: clock)), \
                mock.patch.object(paper.run, "execution_failure"):
            instance.on_bar(1)
            instance.on_mark_price("m")
            instance.on_bar(2)
            instance.on_bar(3)
            self.assertEqual(seen, [])
            self.assertEqual([(name, at) for name, at, _ in alerts], [(f"paper-hold-{id(instance)}", DAY + paper.HOLD_NS)])
            alerts[0][2](None)
        self.assertEqual(seen, [("bar", 1), ("mark", "m"), ("bar", 2), ("bar", 3)])
        self.assertEqual(instance._paper_held, [])


class TradeSubscriptionTests(unittest.TestCase):
    def test_a_trade_subscription_stops_the_run_since_paper_streams_no_trades(self):
        self.assertTrue(issubclass(paper._PaperConfigured, paper.run._TradeSubscriptions))
        recorder = paper.Recorder(paper.RecorderConfig([str(IID)], False))
        self.addCleanup(paper.STOP.clear)
        self.addCleanup(paper.STOP_REASON.clear)
        self.addCleanup(paper.FINDINGS.clear)
        self.addCleanup(paper.run.UNSERVED_TRADES.clear)
        with mock.patch.object(paper, "journal") as journal:
            recorder.on_stop_timer(None)
            self.assertFalse(paper.STOP.is_set())
            paper.run.UNSERVED_TRADES.append("R1-BTCUSDT: subscribe_trades BTCUSDT-PERP.BINANCE")
            recorder.on_stop_timer(None)
        self.assertEqual(paper.STOP_REASON, ["TRADES_NOT_SERVED"])
        self.assertEqual(recorder.findings, ["TRADES_NOT_SERVED: R1-BTCUSDT: subscribe_trades BTCUSDT-PERP.BINANCE"])
        journal.assert_called_once_with("refusal", code="TRADES_NOT_SERVED",
                                        subscriptions=["R1-BTCUSDT: subscribe_trades BTCUSDT-PERP.BINANCE"])


class CredentialTests(unittest.TestCase):
    def test_credential_names_are_found_by_name(self):
        environ = {"BINANCE_API_KEY": "x", "OKX_SECRET": "x", "MY_API_SECRET": "x", "PATH": "/bin", "HOME": "/h"}
        self.assertEqual(paper.credential_names(environ), ["BINANCE_API_KEY", "MY_API_SECRET", "OKX_SECRET"])

    def test_the_runner_refuses_to_start_with_a_credential_in_its_environment(self):
        with mock.patch.dict("os.environ", {"BINANCE_API_SECRET": "never-read"}), \
                mock.patch.object(paper, "parse", side_effect=AssertionError("parsed")):
            with self.assertRaises(Refusal) as raised:
                paper.main([])
        self.assertEqual(raised.exception.code, "PAPER_CREDENTIALS_PRESENT")
        self.assertNotIn("never-read", str(raised.exception))


class CadenceTests(unittest.TestCase):
    def test_the_strategy_gets_the_first_mark_of_each_minute(self):
        cadence = paper.Cadence()
        stamps = [DAY + 1_000_000, DAY + 2_000_000_000, DAY + MINUTE_NS, DAY + MINUTE_NS + 5, DAY + 3 * MINUTE_NS]
        self.assertEqual([cadence.mark(mark(ts)) for ts in stamps], [True, False, True, False, True])

    def test_one_funding_update_per_settlement_stamped_at_the_settlement(self):
        cadence = paper.Cadence()
        settlement, following = DAY + 8 * 3600 * 10**9, DAY + 16 * 3600 * 10**9
        self.assertIsNone(cadence.funding(estimate(DAY + 1, settlement)))
        self.assertIsNone(cadence.funding(estimate(DAY + 2, settlement)))
        settled = cadence.funding(estimate(settlement + 3, following, "0.0002"))
        self.assertIsNone(cadence.funding(estimate(settlement + 4, following)))
        assert settled is not None
        self.assertEqual((settled.ts_event, settled.ts_init, settled.next_funding_ns, settled.rate),
                         (settlement, settlement + 3, settlement, Decimal("0.0002")))


class WarmupTests(unittest.TestCase):
    def fetch(self, rows):
        return lambda url, proxy: rows

    def test_the_warmup_ends_one_millisecond_before_the_input_start(self):
        bars = paper.daily_warmup("BTCUSDT", DAY, (1, 3), None, self.fetch(klines(DAY, WARMUP_DAYS + 3)))
        self.assertEqual(len(bars), WARMUP_DAYS + 3)
        self.assertEqual(bars[-1].ts_event, DAY - 1_000_000)
        self.assertEqual(str(bars[-1].bar_type), "BTCUSDT-PERP.BINANCE-1-DAY-LAST-EXTERNAL")
        self.assertEqual((str(bars[-1].close), str(bars[-1].volume)), ("100.4", "12.345"))

    def test_a_gap_keeps_only_the_unbroken_run_and_too_short_a_run_is_refused(self):
        rows = klines(DAY, WARMUP_DAYS + 3)
        del rows[5]
        with self.assertRaises(Refusal) as raised:
            paper.daily_warmup("BTCUSDT", DAY, (1, 3), None, self.fetch(rows))
        self.assertEqual(raised.exception.code, "WARMUP_INSUFFICIENT")

    def test_a_warmup_not_ending_at_the_input_start_is_refused(self):
        with self.assertRaises(Refusal) as raised:
            paper.daily_warmup("BTCUSDT", DAY + DAY_NS, (1, 3), None, self.fetch(klines(DAY, WARMUP_DAYS)))
        self.assertEqual(raised.exception.code, "WARMUP_NOT_ADJACENT")

    def test_terms_come_from_tick_and_step_sizes_and_an_unknown_contract_is_refused(self):
        info = {"symbols": [{"symbol": "BTCUSDT", "filters": [{"filterType": "PRICE_FILTER", "tickSize": "0.10"},
                                                               {"filterType": "LOT_SIZE", "stepSize": "0.001"}]}]}
        self.assertEqual(paper.rest_terms(["BTCUSDT"], None, self.fetch(info)), {"BTCUSDT": (1, 3)})
        with self.assertRaises(Refusal) as raised:
            paper.rest_terms(["BTCUSDT", "NOPEUSDT"], None, self.fetch(info))
        self.assertEqual(raised.exception.code, "PAPER_INSTRUMENT_UNKNOWN")


class PlanTests(unittest.TestCase):
    def test_the_input_start_is_the_next_minute_or_the_next_day(self):
        now = DAY + 5 * MINUTE_NS + 7
        self.assertEqual(paper.input_start(now, False), DAY + 6 * MINUTE_NS)
        self.assertEqual(paper.input_start(now, True), DAY + DAY_NS)

    def test_instances_keep_membership_from_the_input_start_and_a_non_member_is_refused(self):
        membership = {"BTCUSDT": [[DAY - DAY_NS, DAY + 2 * DAY_NS]], "ETHUSDT": [[DAY - 3 * DAY_NS, DAY - DAY_NS]]}
        with mock.patch.object(paper, "episode_membership", side_effect=lambda intervals, _: intervals):
            planned = paper.plan(["BTCUSDT"], membership, DAY, {})
            self.assertEqual(planned[0].universe_membership, [[DAY, DAY + 2 * DAY_NS]])
            self.assertEqual((planned[0].instrument_id, planned[0].trade_start_ns), ("BTCUSDT-PERP.BINANCE", DAY))
            with self.assertRaises(Refusal) as raised:
                paper.plan(["ETHUSDT"], membership, DAY, {})
        self.assertEqual(raised.exception.code, "PAPER_NOT_IN_UNIVERSE")


if __name__ == "__main__":
    unittest.main()


class OrderFilled:
    """The attributes of a Nautilus fill the journal reads (a stand-in: the class name is what it records)."""
    instrument_id = IID
    client_order_id = "O-1"
    order_side = "BUY"
    order_type = "STOP_MARKET"
    last_px = Price.from_str("100.5")
    last_qty = Decimal("0.010")
    reduce_only = True
    linked_order_ids = ("O-2", "O-3")
    trigger_price = None
    ts_event = DAY


class EventFieldTests(unittest.TestCase):
    def test_an_event_keeps_its_side_price_quantity_and_ids_as_fields(self):
        found = paper._event_fields(OrderFilled())
        self.assertEqual({key: found[key] for key in ("type", "instrument_id", "client_order_id", "order_side",
                                                      "order_type", "last_px", "last_qty", "reduce_only",
                                                      "linked_order_ids", "ts_event")},
                         {"type": "OrderFilled", "instrument_id": str(IID), "client_order_id": "O-1",
                          "order_side": "BUY", "order_type": "STOP_MARKET", "last_px": "100.5", "last_qty": "0.010",
                          "reduce_only": True, "linked_order_ids": ["O-2", "O-3"], "ts_event": DAY})
        self.assertNotIn("trigger_price", found)
