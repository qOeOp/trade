"""Live on the loopback venue when the leg is closed by a fill that is not the run's own (doctor 20261114-25)."""

import time
import unittest

from tests.live_loopback.harness import SYMBOL, Loopback


class ExternalCloseTests(unittest.TestCase):
    def test_a_stop_after_the_leg_was_closed_outside_the_run_leaves_the_venue_clean(self):
        for client_id in ("web_manual", "autoclose-loopback"):  # a manual close; a liquidation
            with self.subTest(client_id=client_id), Loopback() as run:
                run.start()
                run.enter()
                run.venue.external_fill(SYMBOL, "SELL", "LONG", "0.002", client_id=client_id)
                time.sleep(5)
                run.stop()
                run.wait_exit(180)
                self.assertEqual(run.named("unresolved"), [])
                self.assertEqual((run.venue.position(SYMBOL, "LONG"), run.venue.open_algos()), (0, []))
                self.assertEqual([found for found in run.venue.requests if found[2] >= 400], [])


if __name__ == "__main__":
    unittest.main()
