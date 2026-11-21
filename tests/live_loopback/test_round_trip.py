"""A Live run end to end through the rc7 Binance adapter on the loopback venue: entry, its exchange stop, exit, stop."""

from decimal import Decimal
import unittest

from tests.live_loopback.harness import SYMBOL, Loopback


class RoundTripTests(unittest.TestCase):
    def test_an_entry_gets_its_algo_stop_on_the_hedge_leg_and_a_stop_ends_flat_and_clean(self):
        with Loopback() as run:
            run.start()
            run.enter()
            [stop] = run.venue.open_algos()
            # Hedge mode: the adapter names the leg and sends no reduceOnly; the stop is an Algo Service order.
            self.assertEqual((stop.type, stop.side, stop.position_side, stop.reduce_only),
                             ("STOP_MARKET", "SELL", "LONG", False))
            self.assertEqual(run.venue.position(SYMBOL, "LONG"), Decimal("0.002"))
            run.venue.bar(SYMBOL, "76100", volume=3)  # the probe closes and cancels its stop
            run.wait(lambda: run.venue.position(SYMBOL, "LONG") == 0 and not run.venue.open_algos(),
                     what="flat with no stop left")
            run.stop()
            self.assertEqual(run.wait_exit(), 0)
            self.assertEqual(run.events()[-1]["event"], "clean_stop")
            self.assertEqual([found for found in run.venue.requests if found[2] >= 400], [])  # every signature held
            self.assertEqual(run.venue.errors, [])


if __name__ == "__main__":
    unittest.main()
