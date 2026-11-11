"""Live and Paper load without the replay runner."""

import subprocess
import sys
import unittest


class StrategyRuntimeTests(unittest.TestCase):
    def test_live_and_paper_do_not_load_the_replay_runner(self):
        # A clean interpreter is needed: this test suite also imports Replay itself.
        for module in ("engine.live", "engine.paper", "engine.paper_session"):
            with self.subTest(module=module):
                subprocess.run([sys.executable, "-B", "-c",
                                f"import {module}; import sys; assert 'engine.run' not in sys.modules"],
                               check=True, capture_output=True, text=True)
