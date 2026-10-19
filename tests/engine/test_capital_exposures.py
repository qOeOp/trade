"""The runner seals the observed exposure rows reproducibly and refuses an incomplete observation."""

import csv
import gzip
import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from engine.report import EXPOSURE_COLUMNS, ExposureWriter
from engine.run import capital_findings


ROWS = [(1_767_225_899_999_000_000, "AAAUSDT-PERP.BINANCE-R1-AAA", "100.00000000 USDT", "-1.00000000 USDT")]


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

    def test_missed_timestamps_and_unvalued_positions_fail_the_run(self):
        complete = SimpleNamespace(timestamps=3, findings=[])
        self.assertEqual(capital_findings(complete, 3), [])
        missed = SimpleNamespace(timestamps=2, findings=["capital observation cannot value X at 1", "capital observation cannot value X at 1"])
        self.assertEqual(capital_findings(missed, 3), [
            "capital observation cannot value X at 1",
            "CAPITAL_TIMESTAMP_COUNT_MISMATCH: capital observation valued 2 of 3 input timestamps"])


if __name__ == "__main__":
    unittest.main()
