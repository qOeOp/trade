"""The runner seals the observed exposure rows reproducibly and refuses an incomplete observation."""

import csv
import gzip
import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from backtest.r1.native_node import BAR_INTERVAL_NS
from backtest.r1.run_portfolio import EXPOSURE_COLUMNS, _capital_findings, _write_exposures


ROWS = [(1_767_225_899_999_000_000, "AAAUSDT-PERP.BINANCE-R1-AAA", "100.00000000 USDT", "-1.00000000 USDT")]


class CapitalExposureTests(unittest.TestCase):
    def test_exposure_report_bytes_repeat_and_read_back(self):
        with tempfile.TemporaryDirectory() as temp:
            first, second = Path(temp) / "a.csv.gz", Path(temp) / "b.csv.gz"
            _write_exposures(ROWS, first)
            _write_exposures(ROWS, second)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            rows = list(csv.reader(io.StringIO(gzip.decompress(first.read_bytes()).decode())))
        self.assertEqual(rows, [list(EXPOSURE_COLUMNS), [str(value) for value in ROWS[0]]])

    def test_missed_timestamps_and_unvalued_positions_fail_the_run(self):
        start = 1_767_225_600_000_000_000
        end = start + 3 * BAR_INTERVAL_NS
        complete = SimpleNamespace(timestamps=3, findings=[])
        self.assertEqual(_capital_findings(complete, start, end), [])
        missed = SimpleNamespace(timestamps=2, findings=["capital observation cannot value X at 1", "capital observation cannot value X at 1"])
        self.assertEqual(_capital_findings(missed, start, end), [
            "capital observation cannot value X at 1", "capital observation valued 2 of 3 input timestamps"])


if __name__ == "__main__":
    unittest.main()
