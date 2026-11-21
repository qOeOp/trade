"""A kept read is read once across concurrent requests, what is kept stays under its byte limit, least recently used
dropped first, and a failure does not poison it."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sys
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ide"))
from research_graph.pinned import Pinned


class PinnedTests(unittest.TestCase):
    def test_concurrent_reads_share_one_product_call(self):
        entered, release = threading.Event(), threading.Event()
        calls = []

        def read(commit):
            calls.append(commit)
            entered.set()
            release.wait(5)
            return {"ledger_commit": commit, "lines": []}

        index = Pinned(1024)
        with ThreadPoolExecutor(4) as pool:
            results = [pool.submit(index.get, ("lines", "a"), lambda: read("a")) for _ in range(4)]
            self.assertTrue(entered.wait(5))
            release.set()
            self.assertEqual([json.loads(item.result())["ledger_commit"] for item in results], ["a"] * 4)
        self.assertEqual(calls, ["a"])

    def test_keys_stay_exact_and_the_kept_bytes_stay_under_the_limit(self):
        calls = []

        def read(commit):
            calls.append(commit)
            return {"ledger_commit": commit}

        index = Pinned(2 * len(b'{"ledger_commit": "a"}'))
        for commit in ("a", "b", "a", "c", "a", "b"):
            self.assertEqual(json.loads(index.get(("lines", commit), lambda: read(commit)))["ledger_commit"], commit)
        self.assertEqual(calls, ["a", "b", "c", "b"])
        self.assertEqual((list(index.values), index.size), ([("lines", "a"), ("lines", "b")], index.limit))

    def test_a_failed_read_can_be_retried(self):
        calls = []

        def read(commit):
            calls.append(commit)
            if len(calls) == 1:
                raise RuntimeError("temporarily unavailable")
            return {"ledger_commit": commit}

        index = Pinned(1024)
        with self.assertRaisesRegex(RuntimeError, "temporarily"):
            index.get(("lines", "a"), lambda: read("a"))
        self.assertEqual(index.get(("lines", "a"), lambda: read("a")), b'{"ledger_commit": "a"}')
        self.assertEqual(calls, ["a", "a"])
