"""A demo Live run (Binance Demo Trading, D-102) on the loopback venue: it trades on the demo environment's hosts alone,
and the other environment's key is refused at its first account read."""

from decimal import Decimal
import unittest

from tests.live_loopback.harness import SYMBOL, Loopback


class DemoEnvironmentTests(unittest.TestCase):
    def test_a_demo_run_trades_on_the_demo_hosts_alone(self):
        # The runner puts the fake venue on the demo hosts and every live host on a closed port (runner.patches).
        with Loopback(environment="demo") as run:
            run.start()
            run.enter()
            self.assertEqual(run.venue.position(SYMBOL, "LONG"), Decimal("0.002"))
            run.venue.bar(SYMBOL, "76100", volume=3)
            run.wait(lambda: run.venue.position(SYMBOL, "LONG") == 0 and not run.venue.open_algos(),
                     what="flat with no stop left")
            run.stop()
            self.assertEqual(run.wait_exit(), 0)
            self.assertEqual(run.events()[-1]["event"], "clean_stop")
            self.assertEqual([found for found in run.venue.requests if found[2] >= 400], [])
            self.assertEqual(run.venue.errors, [])

    def test_a_key_of_the_other_environment_is_refused_at_the_first_account_read(self):
        with Loopback(environment="demo", venue_key=("demo-account-key", "demo-account-secret")) as run:
            run.start("preflight")
            self.assertNotEqual(run.wait_exit(), 0)
            self.assertIn("LIVE_ACCOUNT_UNAVAILABLE", (run.root / "runner-preflight.out").read_text())
            self.assertFalse([found for found in run.venue.requests if found[2] < 400 and found[1] != "/fapi/v1/time"])


if __name__ == "__main__":
    unittest.main()
