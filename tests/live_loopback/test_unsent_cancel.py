"""Live on the loopback venue when the source cancels an entry that still waits for its account check (issue #3541): the
run and its protected position go on, and neither reconciliation nor a later start acts on the local CANCELED order."""

from decimal import Decimal
import time
import unittest

from live import compare
from replay import comparison
from tests.live_loopback.harness import MEMORY_CACHE, SYMBOL, TERMS, Loopback


class UnsentCancelTests(unittest.TestCase):
    def entered_and_canceled(self, run) -> str:
        """A protected position, then an entry cancelled in its own callback; its client order ID."""
        run.start()
        run.enter()
        self.posted = run.venue.requested("POST", "/fapi/v1/order")
        run.venue.bar(SYMBOL, TERMS["price"], volume=6)
        [canceled] = run.wait(lambda: run.native("OrderCanceled"), what="the unsent entry's native end")
        return canceled["client_order_id"]

    def reads_canceled(self, run, identity):
        self.assertEqual([found["type"] for found in run.native("OrderInitialized") + run.native("OrderCanceled")
                          if found["client_order_id"] == identity], ["OrderInitialized", "OrderCanceled"])
        # What live compare reads: a canceled, unfilled order of the source's own terms, not one the gate changed.
        [order] = [found for found in comparison.orders([row["native"] for row in run.named("order")])
                   if found["order"] == identity]
        self.assertEqual((order["status"], order["filled"], order["side"], str(order["qty"])),
                         ("canceled", None, "BUY", "0.002"))
        self.assertNotIn(identity, sum(compare.gate(run.events()).values(), []))

    def test_the_run_and_its_protected_position_go_on(self):
        with Loopback(wallet="1000") as run:
            identity = self.entered_and_canceled(run)
            settled = time.monotonic() + 75  # two native position checks and seven open-order checks
            run.wait(lambda: run.named("stopping") or time.monotonic() > settled, what="a stop or none")
            self.assertEqual(run.named("stopping"), [])
            self.assertEqual(run.venue.requested("POST", "/fapi/v1/order"), self.posted)
            self.assertEqual((run.venue.position(SYMBOL, "LONG") > 0, len(run.venue.open_algos())), (True, 1))
            self.reads_canceled(run, identity)
            run.stop()
            self.assertEqual(run.wait_exit(), 0)
            self.assertEqual(run.events()[-1]["event"], "clean_stop")
            self.assertEqual(run.venue.errors, [])

    @unittest.skipIf(MEMORY_CACHE, "a start again needs the runtime image's Redis")
    def test_the_canceled_order_survives_a_start_again(self):
        with Loopback(wallet="1000") as run:
            identity = self.entered_and_canceled(run)
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
            self.reads_canceled(run, identity)

    @unittest.skipIf(MEMORY_CACHE, "a start again needs the runtime image's Redis")
    def test_a_kill_inside_a_later_stop_is_finished_by_the_next_start(self):
        # The finishing start (#3521) has no execution algorithm; the reloaded CANCELED order names one.
        with Loopback(wallet="1000") as run:
            identity = self.entered_and_canceled(run)
            with run.venue.lock:
                run.venue.wallet -= 200
            run.wait(lambda: run.named("stopping"), what="the drawdown stop")
            run.process.kill()
            run.process.wait()
            time.sleep(3)  # its Redis child goes with it
            self.assertEqual(run.venue.position(SYMBOL, "LONG"), Decimal("0.002"))
            run.start()
            self.assertEqual(run.wait_exit(180), 0, run.log()[-3000:])
            self.assertEqual((run.venue.position(SYMBOL, "LONG"), run.venue.open_algos(), run.venue.open_orders()),
                             (Decimal(0), [], []))
            self.assertEqual((run.events()[-1]["event"], run.named("unresolved")), ("clean_stop", []))
            self.reads_canceled(run, identity)


if __name__ == "__main__":
    unittest.main()
