"""The precheck's identity probe (`engine.run --describe`) reads the exported inputs it is given before a trial
opens, so an image that cannot read them is refused then (doctor 20261028-11); Live's probe mounts no market."""

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from engine import run
from engine.config import utc_text
from tests.engine.test_stream import END, START, contract


class DescribeTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.temp = Path(temp.name)

    def market(self, name: str) -> Path:
        root = self.temp / name
        contract(root, "AAAUSDT", np.arange(2 * 1440), [START + hour * 3_600_000 for hour in range(0, 48, 8)])
        return root

    def describe(self, root: Path) -> dict:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            run.main(["--describe", "--market-root", str(root), "--market-commit", "c" * 32, "--symbols", "AAAUSDT",
                      "--start", utc_text(START * 10**6), "--end", utc_text(END * 10**6)])
        return json.loads(out.getvalue())

    def test_the_probe_reads_the_mounted_catalog_and_fails_on_one_it_cannot_read(self):
        self.assertIn("effective_config_sha256", self.describe(self.market("readable")))
        self.assertIn("effective_config_sha256", self.describe(Path("/unused")))  # Live: no market mounted
        for kind in ("crypto_perpetual", "bars"):  # the instrument, the bars
            with self.subTest(unreadable=kind):
                root = self.market(kind)
                spoiled = [path for path in root.rglob("*.parquet") if kind in str(path.relative_to(root))]
                self.assertTrue(spoiled)
                for path in spoiled:
                    path.write_bytes(b"not parquet")
                with self.assertRaises((OSError, ValueError)):  # Nautilus's reader, pyarrow
                    self.describe(root)

if __name__ == "__main__":
    unittest.main()
