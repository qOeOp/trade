"""Regression coverage for the shared process-local source evidence boundary."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from engine import run, strategy


class StrategyRuntimeTests(unittest.TestCase):
    def test_live_and_paper_do_not_load_the_replay_runner(self):
        # A clean interpreter is needed: this test suite also imports Replay itself.
        for module in ("engine.live", "engine.paper", "engine.paper_session"):
            with self.subTest(module=module):
                subprocess.run([sys.executable, "-B", "-c",
                                f"import {module}; import sys; assert 'engine.run' not in sys.modules"],
                               check=True, capture_output=True, text=True)

    def test_sequential_receipts_follow_the_shared_owner_and_current_source(self):
        strategy.clear_failures()
        self.addCleanup(strategy.clear_failures)
        with tempfile.TemporaryDirectory() as temp, patch.object(strategy, "FAILURE_PATH", None), \
                patch.dict(strategy.STRATEGIES, clear=True):
            previous = None
            for number in range(2):
                strategy.clear_failures()
                strategy.STRATEGIES.clear()
                source = SimpleNamespace()
                instrument = f"SOURCE-{number}"
                strategy.STRATEGIES[instrument] = source
                path = Path(temp) / str(number) / "runtime_failures.jsonl"
                strategy.FAILURE_PATH = path

                def fail(_source):
                    raise ValueError("native callback failed")

                with self.assertRaisesRegex(ValueError, "native callback failed"):
                    strategy.guard_callback("on_bar", fail)(source)
                # Legacy replay function entry points write to the same owner.
                run.execution_failure("on_stop", RuntimeError("stop failed"), source)
                run.write_failures()
                rows = [json.loads(line) for line in path.read_text().splitlines()]
                self.assertEqual([(r["stage"], r["instrument_id"], r["count"]) for r in rows],
                                 [("on_bar", instrument, 1), ("on_stop", instrument, 1)])
                self.assertEqual(rows, strategy.FAILURES)
                if previous:
                    old_path, old_bytes = previous
                    self.assertEqual(old_path.read_bytes(), old_bytes)
                previous = path, path.read_bytes()

    def test_shared_cache_refusal_reaches_the_same_failure_receipt(self):
        strategy.clear_failures()
        self.addCleanup(strategy.clear_failures)
        source = SimpleNamespace(cache=strategy.ReadOnlyCache(object()))
        with patch.object(strategy, "FAILURE_PATH", None):
            def mutate(instance):
                instance.cache.reset()

            with self.assertRaisesRegex(Exception, "cache.reset"):
                strategy.guard_callback("on_start", mutate)(source)
            self.assertEqual([(row["stage"], row["code"]) for row in strategy.FAILURES],
                             [("on_start", "CACHE_WRITE")])
