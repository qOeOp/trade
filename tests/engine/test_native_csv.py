"""Native consumers accept complete long position cells in fresh runtime processes."""

import subprocess
import sys
import unittest
from pathlib import Path


# These consumers normally run in different containers. In-process tests can hide a default
# CSV limit when an earlier ledger read has already raised the process-global setting.
PROBE = r'''
import ast
import csv
import gzip
import io
import sys
import tempfile
from pathlib import Path

payload = "x" * 131073
mode = sys.argv[1]
if mode == "audit":
    from tests.engine.test_native_audit import NativeAuditTests, reports
    case = NativeAuditTests()
    case.setUp()
    try:
        values = reports()
        adjustments = ast.literal_eval(values["positions"][0]["adjustments"])
        adjustments[0]["note"] = payload
        values["positions"][0]["adjustments"] = repr(adjustments)
        result = case.check(values)
        assert result["passed"], result["findings"]
    finally:
        case.doCleanups()
elif mode == "fingerprint":
    from engine.compare import report_fingerprint
    from tests.engine.test_fingerprint import write_reports, fresh_ids
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp) / "reports"
        write_reports(root, fresh_ids())
        path = root / "positions.csv"
        with path.open(newline="") as stream:
            row = next(csv.DictReader(stream))
        row["adjustments"] = repr([{"note": payload}])
        def write():
            with path.open("w", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=list(row))
                writer.writeheader()
                writer.writerow(row)
        write()
        first = report_fingerprint(root)
        row["adjustments"] = row["adjustments"].replace("x", "y", 1)
        write()
        second = report_fingerprint(root)
        assert first["positions"] != second["positions"], "long cells must not be truncated"
elif mode == "fingerprint-gzip":
    from engine.compare import _csv_rows
    with tempfile.TemporaryDirectory() as temp:
        path = Path(temp) / "exposures.csv.gz"
        with gzip.open(path, "wt", newline="") as stream:
            writer = csv.writer(stream)
            writer.writerow(["payload"])
            writer.writerow([payload])
        assert _csv_rows(path) == [{"payload": payload}]
elif mode == "parity":
    from engine.compare_reports import compare_reports
    from tests.engine.test_compare import _replay
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        left, right = _replay(root / "a", None), _replay(root / "b", None)
        for directory in (left, right):
            with (directory / "positions.csv").open("w", newline="") as stream:
                writer = csv.writer(stream)
                writer.writerow(["opening_order_id", "closing_order_id", "ts_opened", "adjustments"])
                writer.writerow(["O-1", "O-2", "2026-01-01", repr([{"note": payload}])])
        assert compare_reports(left, right)["passed"]
elif mode == "ledger":
    from ledger.metrics import _csv, ExposureRows
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(["payload"])
    writer.writerow([payload])
    data = stream.getvalue().encode()
    assert _csv(data) == [{"payload": payload}]
    assert list(ExposureRows(gzip.compress(data))) == [{"payload": payload}]
else:
    raise AssertionError(mode)
'''


class NativeCsvTests(unittest.TestCase):
    def test_long_cells_reach_each_original_consumer_in_a_fresh_process(self):
        for mode in ("audit", "fingerprint", "fingerprint-gzip", "parity", "ledger"):
            with self.subTest(mode=mode):
                found = subprocess.run([sys.executable, "-c", PROBE, mode], capture_output=True, text=True,
                                       cwd=Path(__file__).resolve().parents[2], timeout=30)
                self.assertEqual(found.returncode, 0, found.stdout + found.stderr)


if __name__ == "__main__":
    unittest.main()
