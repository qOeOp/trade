"""Paper and Live read metrics from Binance's public REST at a replay's stamps (engine.metrics)."""
from __future__ import annotations

import unittest
from decimal import Decimal
from types import SimpleNamespace

from nautilus_trader.model import InstrumentId

from engine import metrics, strategy as strategy_runtime
from engine.config import MINUTE_NS

IID = "BTCUSDT-PERP.BINANCE"
NOON = 1_794_657_600 * 10**9  # 2026-11-15 12:00 UTC
SHOWN = {"sum_open_interest": Decimal("97897.565"), "count_toptrader_long_short_ratio": Decimal("3.6904"),
         "sum_toptrader_long_short_ratio": Decimal("1.8441"), "count_long_short_ratio": Decimal("3.09")}


class Host(metrics.Feed, strategy_runtime.Subscriptions):
    """A source's runner class around a clock the test sets."""
    strategy_id = "R1-BTCUSDT"

    def __init__(self, now: int, reader):
        self.now, self.timers, self.delivered, self.warnings = now, set(), [], []
        self._replay_input_start_ns = now
        self.log = SimpleNamespace(warning=self.warnings.append)
        self._metrics_setup(reader)

    def _metrics_clock(self):
        return self

    def timestamp_ns(self):
        return self.now

    def timer_names(self):
        return sorted(self.timers)

    def set_timer(self, name, interval, callback=None):
        self.timers.add(name)

    def cancel_timer(self, name):
        self.timers.discard(name)

    def on_data(self, data):
        self.delivered.append(data)

    def at(self, now: int) -> None:
        """Ticks at `now`, each read finished before the next tick, until a tick changes nothing."""
        self.now = now
        while True:
            before = [state["thread"] for state in self._metrics_followed.values()]
            self._metrics_tick()
            after = [state["thread"] for state in self._metrics_followed.values()]
            for thread in after:
                if thread is not None:
                    thread.join()
            if after == before:
                return


class FeedTests(unittest.TestCase):
    def setUp(self):
        for value in (strategy_runtime.SERVED["Metrics"], strategy_runtime.BREACHES):
            self.addCleanup(value.clear)
        strategy_runtime.SERVED["Metrics"].add(IID)

    def test_a_served_row_reaches_on_data_at_its_replay_stamps_with_exact_values(self):
        asked = []
        host = Host(NOON + 30 * 10**9, lambda iid, ts, wanted: asked.append((ts, list(wanted))) or
                    {name: value.quantize(metrics.EXACT) for name, value in SHOWN.items() if name in wanted})
        host.subscribe_data(metrics.metrics_data_type(IID))
        self.assertEqual(host.timer_names(), ["runner-metrics"])
        host.at(NOON + 10 * MINUTE_NS - 1)  # the first row stamped after the start, 12:05, is due at 12:10
        self.assertEqual((asked, host.delivered), ([], []))
        host.at(NOON + 10 * MINUTE_NS)
        data, = host.delivered
        self.assertEqual((data.data_type.type_name, data.data_type.metadata), ("Metrics", {"instrument_id": IID}))
        # The replay's row: decimal128(38, 16) values, ts_event REST's timestamp, ts_init 5 minutes later.
        self.assertEqual(data.data, strategy_runtime.Metrics(InstrumentId.from_str(IID), Decimal("97897.5650000000000000"),
                                                    Decimal("3.6904000000000000"), Decimal("1.8441000000000000"),
                                                    Decimal("3.0900000000000000"), NOON + 5 * MINUTE_NS,
                                                    NOON + 10 * MINUTE_NS))
        self.assertEqual(asked, [(NOON + 5 * MINUTE_NS, list(metrics.ENDPOINTS))])
        host.unsubscribe_data(metrics.metrics_data_type(IID))
        self.assertEqual(host.timer_names(), [])

    def test_a_late_row_is_read_again_for_what_is_missing_until_the_next_is_due(self):
        published, asked = {"sum_open_interest", "sum_toptrader_long_short_ratio"}, []

        def reader(iid, ts, wanted):
            asked.append(list(wanted))
            return {name: SHOWN[name] for name in wanted if name in published}
        host = Host(NOON, reader)
        host.subscribe_data(metrics.metrics_data_type(IID))  # 12:00 is the input start: its row is due 12:05
        host.at(NOON + 5 * MINUTE_NS)
        published.add("count_long_short_ratio")
        host.at(NOON + 5 * MINUTE_NS + metrics.RETRY_NS - 1)
        host.at(NOON + 5 * MINUTE_NS + metrics.RETRY_NS)
        self.assertEqual(asked[1], ["count_toptrader_long_short_ratio", "count_long_short_ratio"])
        self.assertEqual(host.delivered, [])
        host.at(NOON + 10 * MINUTE_NS - metrics.RETRY_NS)  # the last read before the next row is due
        row = host.delivered[0].data
        self.assertEqual((row.count_toptrader_long_short_ratio, row.count_long_short_ratio, row.ts_event),
                         (None, SHOWN["count_long_short_ratio"], NOON))

    def test_a_row_without_open_interest_by_the_next_due_time_is_skipped(self):
        host = Host(NOON, lambda iid, ts, wanted: {})
        host.subscribe_data(metrics.metrics_data_type(IID))
        host.at(NOON + 5 * MINUTE_NS)
        host.at(NOON + 10 * MINUTE_NS - metrics.RETRY_NS)
        self.assertEqual(host.delivered, [])
        self.assertEqual(len(host.warnings), 1)
        self.assertEqual(host._metrics_followed[IID]["ts_event"], NOON + 5 * MINUTE_NS)

    def test_no_row_reaches_the_source_once_it_unsubscribed_even_from_a_rows_on_data(self):
        other = "ETHUSDT-PERP.BINANCE"
        strategy_runtime.SERVED["Metrics"].add(other)
        host = Host(NOON, lambda iid, ts, wanted: {name: SHOWN[name] for name in wanted})
        host.on_data = lambda data: (host.delivered.append(data),
                                     host.unsubscribe_data(metrics.metrics_data_type(other)))
        host.subscribe_data(metrics.metrics_data_type(IID))
        host.subscribe_data(metrics.metrics_data_type(other))
        host.at(NOON + 5 * MINUTE_NS)  # both rows are read; the first delivered unsubscribes the other
        self.assertEqual([str(data.data.instrument_id) for data in host.delivered], [IID])

    def test_metrics_of_a_contract_outside_the_run_are_refused(self):
        host = Host(NOON, lambda iid, ts, wanted: {})
        host.subscribe_data(metrics.metrics_data_type("ETHUSDT-PERP.BINANCE"))
        self.assertEqual(strategy_runtime.breaches(), ("METRICS_NOT_SERVED", [
            "R1-BTCUSDT: subscribe_data Metrics for ETHUSDT-PERP.BINANCE, which this run does not stream"]))
        self.assertEqual((host._metrics_followed, host.timer_names()), ({}, []))


class ReadTests(unittest.TestCase):
    def test_only_the_row_stamped_ts_event_counts(self):
        stamp = NOON // 10**6
        answers = {"openInterestHist": [{"timestamp": stamp, "sumOpenInterest": "97897.56500000"}],
                   "topLongShortAccountRatio": [{"timestamp": stamp + 300_000, "longShortRatio": "3.6904"}],
                   "topLongShortPositionRatio": [],
                   "globalLongShortAccountRatio": [{"timestamp": stamp, "longShortRatio": "3.0900"}]}
        urls = []

        def get(url, proxy_url):
            urls.append(url)
            return answers[url.split("/futures/data/")[1].split("?")[0]]
        found = metrics.read(IID, NOON, list(metrics.ENDPOINTS), "http://proxy", get)
        self.assertEqual(found, {"sum_open_interest": Decimal("97897.5650000000000000"),
                                 "count_long_short_ratio": Decimal("3.0900000000000000")})
        self.assertIn(f"symbol=BTCUSDT&period=5m&startTime={stamp}&endTime={stamp}&limit=1", urls[0])


if __name__ == "__main__":
    unittest.main()
