"""Live on the loopback venue when the source cancels an entry that still waits for its account check (issue #3541): the
run and its protected position go on, and neither reconciliation nor a start again acts on the local CANCELED order."""

import time
import unittest

from live import compare
from replay import comparison
from tests.live_loopback.harness import SYMBOL, TERMS, Loopback


class UnsentCancelTests(unittest.TestCase):
    def test_the_run_goes_on_and_the_canceled_order_survives_reconciliation_and_a_start_again(self):
        with Loopback(wallet="1000") as run:
            run.start()
            run.enter()
            posted = run.venue.requested("POST", "/fapi/v1/order")
            run.venue.bar(SYMBOL, TERMS["price"], volume=6)
            [canceled] = run.wait(lambda: run.native("OrderCanceled"), what="the unsent entry's native end")
            settled = time.monotonic() + 75  # two native position checks and seven open-order checks
            run.wait(lambda: run.named("stopping") or time.monotonic() > settled, what="a stop or none")
            self.assertEqual(run.named("stopping"), [])
            self.assertEqual(run.venue.requested("POST", "/fapi/v1/order"), posted)
            self.assertEqual((run.venue.position(SYMBOL, "LONG") > 0, len(run.venue.open_algos())), (True, 1))
            run.venue.bar(SYMBOL, "76100", volume=3)
            run.wait(lambda: run.venue.position(SYMBOL, "LONG") == 0 and not run.venue.open_algos(), what="flat")
            run.wait(lambda: run.native("PositionClosed"), what="flat in the native cache")
            run.interrupt()
            self.assertEqual(run.wait_exit(), 3)  # interrupted
            run.start()  # the native cache is reloaded and reconciled with the canceled order in it
            run.wait(lambda: len(run.named("warmup")) == 2, what="the second start's warm-up")
            run.stop()
            self.assertEqual(run.wait_exit(), 0)
            self.assertEqual(run.events()[-1]["event"], "clean_stop")
            self.assertEqual(run.venue.errors, [])
            identity = canceled["client_order_id"]
            self.assertEqual([found["type"] for found in run.native("OrderInitialized") + run.native("OrderCanceled")
                              if found["client_order_id"] == identity], ["OrderInitialized", "OrderCanceled"])
            # What live compare reads: a canceled, unfilled order of the source's own terms, not one the gate changed.
            [order] = [found for found in comparison.orders(
                [row["native"] for row in run.named("order")]) if found["order"] == identity]
            self.assertEqual((order["status"], order["filled"], order["side"], str(order["qty"])),
                             ("canceled", None, "BUY", "0.002"))
            self.assertNotIn(identity, sum(compare.gate(run.events()).values(), []))


if __name__ == "__main__":
    unittest.main()
