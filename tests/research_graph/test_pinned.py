"""A pinned read (the navigation index) is read once across concurrent requests; failures do not poison it."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ide"))
from research_graph.pinned import Pinned  # noqa: E402


class PinnedTests(unittest.TestCase):
    def test_concurrent_reads_share_one_product_call(self):
        entered, release = threading.Event(), threading.Event()
        calls = []

        def read(commit):
            calls.append(commit)
            entered.set()
            release.wait(5)
            return {"ledger_commit": commit, "lines": []}

        index = Pinned(read)
        with ThreadPoolExecutor(4) as pool:
            results = [pool.submit(index.get, "a") for _ in range(4)]
            self.assertTrue(entered.wait(5))
            release.set()
            self.assertEqual([item.result()["ledger_commit"] for item in results], ["a"] * 4)
        self.assertEqual(calls, ["a"])

    def test_commit_keys_stay_exact_and_the_cache_stays_bounded(self):
        calls = []

        def read(commit):
            calls.append(commit)
            return {"ledger_commit": commit}

        index = Pinned(read, capacity=2)
        for commit in ("a", "b", "a", "c", "a", "b"):
            self.assertEqual(index.get(commit)["ledger_commit"], commit)
        self.assertEqual(calls, ["a", "b", "c", "b"])
        self.assertLessEqual(len(index.values), 2)

    def test_a_failed_read_can_be_retried(self):
        calls = []

        def read(commit):
            calls.append(commit)
            if len(calls) == 1:
                raise RuntimeError("temporarily unavailable")
            return {"ledger_commit": commit}

        index = Pinned(read)
        with self.assertRaisesRegex(RuntimeError, "temporarily"):
            index.get("a")
        self.assertEqual(index.get("a"), {"ledger_commit": "a"})
        self.assertEqual(calls, ["a", "a"])
