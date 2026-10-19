"""The runner streams the exported events in BacktestNode's order without loading the window whole."""

import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

import numpy as np
from nautilus_trader.model import Bar, InstrumentId, MarkPriceUpdate
from nautilus_trader.persistence import ParquetDataCatalog

from engine import run
from market import export


MINUTE = 60_000
START = 1_767_225_600_000  # 2026-01-01T00:00:00Z, ms
TERMS = {"price_increment": "0.01", "size_increment": "0.001", "max_quantity": None, "min_quantity": None,
         "min_notional": None, "max_price": None, "min_price": None}


def catalog(root: Path, symbol: str, minutes: np.ndarray, funding: list[int]) -> dict:
    path = root / symbol
    path.mkdir()
    store = ParquetDataCatalog(str(path))
    store.write_instruments([export.build_instrument(symbol, TERMS, 2)])
    bars = {"ts_open": START + minutes * MINUTE}
    for name in ("open", "high", "low", "close"):
        bars[name] = (100 + minutes).astype(np.int64) * 10**8
    bars["volume"] = np.full(len(minutes), 10**4, dtype=np.int64)
    iid = InstrumentId.from_str(export.instrument_id(symbol))
    export.write_bars(store, f"{iid}-1-MINUTE-LAST-EXTERNAL", bars, MINUTE, 2, 3, 8, 4)
    export.write_marks(store, iid, bars, MINUTE, 8)
    export.write_funding(path, str(iid), [(at, Decimal("0.0001")) for at in funding])
    return {"symbol": symbol, "instrument_id": iid, "catalog_path": path}


class StreamTests(unittest.TestCase):
    def test_events_come_in_the_node_order_across_session_windows(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            # Two contracts sharing minute timestamps, one with a gap of more than a session window;
            # a funding settlement stamped exactly at a bar close of the second contract.
            first = np.concatenate([np.arange(0, 30), np.arange(11 * 1440, 11 * 1440 + 30)])
            second = np.arange(0, 20)
            rows = [catalog(root, "AAAUSDT", first, [START + 5 * MINUTE + 7]),
                    catalog(root, "BBBUSDT", second, [START + 10 * MINUTE - 1])]
            streamed = list(run.market_events(rows, START * 10**6, (START + 12 * 1440 * MINUTE) * 10**6))
            # The node's order: every configuration whole (contract by contract MARK, funding, bars),
            # then one stable sort by ts_init.
            node = []
            for row in rows:
                store = ParquetDataCatalog(str(row["catalog_path"]))
                node += store.query_mark_price_updates([str(row["instrument_id"])])
                node += run._small_events(row, "FundingRateUpdate")
                node += store.query_bars([f"{row['instrument_id']}-1-MINUTE-LAST-EXTERNAL"])
            node.sort(key=lambda event: event.ts_init)
        self.assertEqual(len(streamed), 2 * (60 + 20) + 2)
        self.assertEqual([(type(event).__name__, str(getattr(event, "bar_type", getattr(event, "instrument_id", ""))),
                           event.ts_init) for event in streamed],
                         [(type(event).__name__, str(getattr(event, "bar_type", getattr(event, "instrument_id", ""))),
                           event.ts_init) for event in node])
        tie = [type(event).__name__ for event in streamed if event.ts_init == (START + 10 * MINUTE - 1) * 10**6]
        self.assertEqual(tie, ["MarkPriceUpdate", "Bar", "MarkPriceUpdate", "FundingRateUpdate", "Bar"])
        self.assertTrue(all(isinstance(event, (Bar, MarkPriceUpdate)) or type(event).__name__ == "FundingRateUpdate"
                            for event in streamed))

    def test_chunks_end_on_a_timestamp_boundary_and_the_last_runs_to_the_end(self):
        class Engine:
            def __init__(self):
                self.calls, self.ended = [], False

            def add_data(self, data, client_id, validate, sort):
                self.calls.append(("add", [event.ts_init for event in data], validate, sort))

            def run(self, start, end, run_id, streaming):
                self.calls.append(("run", start, end, streaming))

            def clear_data(self):
                self.calls.append(("clear",))

            def end(self):
                self.ended = True

        class Event:
            def __init__(self, ts_init):
                self.ts_init = ts_init
        engine = Engine()
        self.assertEqual(run.stream(engine, [Event(at) for at in (1, 2, 2, 2, 3, 4)], 2), 6)
        self.assertEqual(engine.calls, [("add", [1, 2, 2, 2], False, True), ("run", None, 2, True), ("clear",),
                                        ("add", [3, 4], False, True), ("run", 2, None, True), ("clear",)])
        self.assertTrue(engine.ended)


if __name__ == "__main__":
    unittest.main()
