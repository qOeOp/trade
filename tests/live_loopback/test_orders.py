"""Live on the loopback venue when Binance answers an entry with an error: how the run ends."""

import unittest

from tests.live_loopback.harness import SYMBOL, TERMS, Loopback


class EntryTests(unittest.TestCase):
    def test_an_entry_answered_429_is_rejected_and_the_run_stops_flat(self):
        with Loopback() as run:
            run.start()
            run.ready()
            run.venue.fail("POST", "/fapi/v1/order", 429)
            run.venue.bar(SYMBOL, TERMS["price"], volume=2)
            run.wait(lambda: run.named("stopping"), what="the run stopping")
            self.assertEqual(run.wait_exit(), 1)
            self.assertEqual(run.named("stopping")[0]["reason"], "native_order_failure")
            self.assertEqual(len(run.native("OrderRejected")), 1)
            self.assertEqual(run.events()[-1]["event"], "clean_stop")
            self.assertEqual((run.venue.position(SYMBOL, "LONG"), run.venue.open_algos()), (0, []))


if __name__ == "__main__":
    unittest.main()
