"""Every refusal and finding code the runtime package raises is catalogued; the loader, warm-up and
MARK-count refusals behave as their codes say."""

import re
import tempfile
import unittest
from pathlib import Path

import numpy as np
from nautilus_trader.model import InstrumentId
from nautilus_trader.persistence import ParquetDataCatalog

from engine import audit, config, load, report, run
from market import export, instrument


ENGINE = Path(__file__).resolve().parents[2] / "engine"
MINUTE, DAY = 60_000, 86_400_000
START = 1_767_225_600_000  # 2026-01-01T00:00:00Z, ms
TERMS = {"price_increment": "0.01", "size_increment": "0.001", "max_quantity": None, "min_quantity": None,
         "min_notional": None, "max_price": None, "min_price": None, "terms_source": "inferred", "observed_at": 0}


class CatalogueTests(unittest.TestCase):
    def raised(self, pattern: str) -> set[str]:
        found = set()
        for path in ENGINE.glob("*.py"):
            found |= set(re.findall(pattern, path.read_text()))
        return found

    def test_every_code_raised_or_reported_is_catalogued(self):
        refusals = self.raised(r'(?:Refusal|_refusal)\(\s*"([A-Z_]+)"')
        self.assertTrue(refusals)
        self.assertLessEqual(refusals, set(config.REFUSALS))
        findings = self.raised(r'finding\(\s*"([A-Z_]+)"')
        self.assertTrue(findings)
        self.assertLessEqual(findings, set(audit.FINDINGS))
        integrity = self.raised(r'(?:findings\.append|findings\.insert\(0,|coded =)\s*\(?f?"([A-Z_]+): ')
        self.assertTrue(integrity)
        self.assertLessEqual(integrity, set(config.INTEGRITY_CODES))
        outcomes = self.raised(r'outcome\(\s*"([A-Z_]+)"')
        self.assertEqual(outcomes, set(audit.AUDIT_REFUSALS))
        # the lifecycle refusals the auditor turns into findings keep their codes there
        self.assertLessEqual({code for code in config.REFUSALS if code.startswith("LIFECYCLE_")}, set(audit.FINDINGS))
        with self.assertRaises(KeyError):
            config.Refusal("NOT_A_CODE", "uncatalogued")
        with self.assertRaises(KeyError):
            audit.finding("NOT_A_CODE", "uncatalogued")


def catalog(root: Path, minutes: np.ndarray, days: int = 0, symbol="AAAUSDT") -> dict:
    path = root / symbol
    path.mkdir()
    store = ParquetDataCatalog(str(path))
    native = export.native_symbol(symbol)["instrument_id"]
    store.write_instruments([instrument.build_instrument(symbol, TERMS, 2, native)[0]])
    iid = InstrumentId.from_str(native)
    bars = {"ts_open": START + minutes * MINUTE}
    for name in ("open", "high", "low", "close"):
        bars[name] = np.full(len(minutes), 100 * 10**8, dtype=np.int64)
    bars["volume"] = np.full(len(minutes), 10**4, dtype=np.int64)
    export.write_marks(store, iid, bars, MINUTE, 8, 8)
    if days:
        daily = {name: np.resize(values[:1], days) for name, values in bars.items()}
        daily["ts_open"] = START - DAY * days + DAY * np.arange(days)
        export.write_bars(store, f"{iid}-1-DAY-LAST-EXTERNAL", daily, DAY, 2, 3, 8, 4)
    return {"symbol": symbol, "catalog_path": path, "instrument_id": iid, "counts": {"mark": len(minutes)}}


class LoadRefusalTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def code(self, call, *args):
        with self.assertRaises(config.Refusal) as caught:
            call(*args)
        return caught.exception.code

    def test_the_daily_warm_up_holds_or_says_why_and_when_it_first_holds(self):
        row = catalog(self.root, np.arange(3), days=250)
        start_ns = START * 10**6
        self.assertEqual(len(load.warmup_daily_bars(row["catalog_path"], row["instrument_id"], start_ns)), 250)
        self.assertEqual(self.code(load.warmup_daily_bars, row["catalog_path"], row["instrument_id"],
                                   start_ns + MINUTE * 10**6), "WARMUP_NOT_ADJACENT")
        self.assertEqual(self.code(load.warmup_daily_bars, row["catalog_path"], row["instrument_id"],
                                   start_ns - 60 * DAY * 10**6), "WARMUP_INSUFFICIENT")
        # 250 days end at START: the 200th of them closes 50 days earlier, the first instant the warm-up holds
        first = load.warmup_start(row["catalog_path"], row["instrument_id"], 0, start_ns + 1)
        self.assertEqual(first, start_ns - 50 * DAY * 10**6)
        self.assertEqual(load.warmup_start(row["catalog_path"], row["instrument_id"], start_ns, start_ns + DAY * 10**6),
                         start_ns)
        self.assertIsNone(load.warmup_start(row["catalog_path"], row["instrument_id"], start_ns + 1,
                                            start_ns + DAY * 10**6))

    def test_a_contract_starts_when_its_warm_up_first_holds_and_none_starts_without_it(self):
        from types import SimpleNamespace
        window = config.parse_window(config.utc_text(START * 10**6), None, config.utc_text((START + 30 * DAY) * 10**6))
        ready = {**catalog(self.root, np.arange(3), days=250, symbol="AAAUSDT"), "episode": None}
        later = {**catalog(self.root, np.arange(3), days=180, symbol="BBBUSDT"), "episode": None}
        later_daily = {name: np.full(30, 100 * 10**8 if name != "volume" else 10**4, dtype=np.int64)
                       for name in ("open", "high", "low", "close", "volume")}
        later_daily["ts_open"] = START + DAY * np.arange(30)
        export.write_bars(ParquetDataCatalog(str(later["catalog_path"])), f"{later['instrument_id']}-1-DAY-LAST-EXTERNAL",
                          later_daily, DAY, 2, 3, 8, 4)
        never = {**catalog(self.root, np.arange(3), symbol="CCCUSDT"), "episode": None}
        warm = SimpleNamespace(daily_warmup=True)
        planned, limitations = run.plan_instances([ready, later, never], window, warm)
        self.assertEqual([(row["symbol"], start) for row, start, _ in planned],
                         [("AAAUSDT", START * 10**6), ("BBBUSDT", (START + 20 * DAY) * 10**6)])
        self.assertEqual(planned[1][2], (START + 20 * DAY) * 10**6)  # it trades from its own start
        self.assertEqual(len(limitations), 2)
        self.assertIn("BBBUSDT: its daily warm-up first holds at 2026-01-21T00:00:00Z", limitations[0])
        self.assertIn("CCCUSDT", limitations[1])
        self.assertEqual(self.code(run.plan_instances, [never], window, warm), "WARMUP_INSUFFICIENT")
        self.assertEqual(run.plan_instances([never], window, SimpleNamespace(daily_warmup=False))[1], [])

    def test_mark_timestamps_count_distinct_stamps_and_refuse_a_missing_file(self):
        rows = [catalog(self.root, np.arange(0, 30)), catalog(self.root, np.arange(20, 50), symbol="BBBUSDT")]
        self.assertEqual(run.mark_timestamps(rows), 50)
        self.assertEqual(run.mark_timestamps([]), 0)
        empty = self.root / "CCCUSDT"
        empty.mkdir()
        self.assertEqual(self.code(run.mark_timestamps, [{"symbol": "CCCUSDT", "catalog_path": empty,
                                                           "counts": {"mark": 3}}]), "EXPORT_MARKS_UNREADABLE")
        broken = next((rows[0]["catalog_path"] / "data" / "mark_prices").rglob("*.parquet"))
        broken.write_bytes(b"not parquet")
        self.assertEqual(self.code(run.mark_timestamps, rows), "EXPORT_MARKS_UNREADABLE")

    def test_diagnostics_are_a_json_dict_apart_from_the_native_facts(self):
        class Source:
            def __init__(self, value):
                self.value = value

            def replay_diagnostics(self):
                return self.value
        self.assertEqual(load.diagnostics(Source({"signals": 3})), {"signals": 3})
        for value, code in (([], "DIAGNOSTICS_NOT_DICT"), ({"positions": 1}, "DIAGNOSTICS_RESERVED_KEY"),
                            ({"when": object()}, "DIAGNOSTICS_NOT_JSON")):
            with self.subTest(code=code):
                self.assertEqual(self.code(load.diagnostics, Source(value)), code)


class ReportRefusalTests(unittest.TestCase):
    def code(self, call, *args):
        with self.assertRaises(config.Refusal) as caught:
            call(*args)
        return caught.exception.code

    def test_order_events_and_statistics_refuse_what_they_cannot_hold(self):
        from decimal import Decimal
        from types import SimpleNamespace

        def order(identity, *values):
            return SimpleNamespace(client_order_id=identity,
                                   events=lambda: [SimpleNamespace(to_dict=lambda value=value: value) for value in values])
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "order_events.jsonl.gz"
            self.assertEqual(self.code(report.write_order_events, [order("O-2", {"a": 1}), order("O-1")], path),
                             "ORDER_WITHOUT_EVENTS")
            self.assertEqual(self.code(report.write_order_events, [order("O-1", {"px": float("nan")})], path),
                             "NON_FINITE_EVENT_FIELD")
        day = 86_400 * 10**9
        self.assertEqual(self.code(report.summary_statistics, {}, day, day, Decimal(100000), Decimal(100000)),
                         "TRADING_WINDOW_EMPTY")
        self.assertEqual(self.code(report.summary_statistics, {}, 0, day, Decimal(0), Decimal(100000)),
                         "STARTING_BALANCE_NOT_POSITIVE")


if __name__ == "__main__":
    unittest.main()
