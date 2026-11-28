"""The Paper runner's entry turns transparent huge pages off for its process (engine.pages, #3782)."""

import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# The runner's own entry (`python -m engine.paper`), stopped by its argument parser; then the process's THP flag.
ENTRY = """
import runpy, sys
sys.argv = ["engine.paper"]
try:
    runpy.run_module("engine.paper", run_name="__main__")
except SystemExit:
    pass
print(next(line.split()[1] for line in open("/proc/self/status") if line.startswith("THP_enabled:")))
"""


LINUX = sys.platform == "linux" and "THP_enabled:" in Path("/proc/self/status").read_text()


@unittest.skipUnless(LINUX, "the THP flag is a Linux process status")
class BasePagesTests(unittest.TestCase):
    def test_the_paper_entry_runs_without_transparent_huge_pages(self):
        found = subprocess.run([sys.executable, "-c", ENTRY], cwd=ROOT, capture_output=True, text=True, timeout=120)
        self.assertEqual(found.stdout.strip(), "0", found.stderr[-2000:])


if __name__ == "__main__":
    unittest.main()
