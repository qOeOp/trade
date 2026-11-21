"""Live on the loopback venue when Binance's answer to an entry is lost: the order's outcome is unknown to the run.

rc7 keeps such an order SUBMITTED (engine.live_node: RETAIN_UNRESOLVED) instead of judging it rejected after its
in-flight check, and the run asks the venue for it (engine.live_session.follow_submissions)."""

import time
import unittest

from engine import live_session
from tests.live_loopback.harness import SYMBOL, TERMS, Loopback

UNKNOWN = {"code": -1007, "msg": "Timeout waiting for response from backend server. Send status unknown; "
                                 "execution status unknown."}


class UnknownSubmitTests(unittest.TestCase):
    def test_an_entry_binance_filled_with_every_answer_lost_settles_to_its_fill_and_gets_its_stop(self):
        with Loopback() as run:
            run.start()
            run.ready()
            # The order is placed and filled, but its answer, its user-stream events and every query for it are lost
            # for longer than rc7's own in-flight check (about 30 s): judged locally, it would read as rejected.
            run.venue.lose("POST", "/fapi/v1/order")
            run.venue.mute_user_streams()
            run.venue.fail("GET", "/fapi/v1/order", 503, UNKNOWN, times=10_000)
            run.venue.bar(SYMBOL, TERMS["price"], volume=2)
            run.wait(lambda: run.venue.position(SYMBOL, "LONG"), what="the entry filled at the venue")
            closed = run.wait_event("entries_closed", reason="unverified")
            time.sleep(45)
            [submitted] = run.native("OrderSubmitted")
            self.assertEqual(closed["client_order_id"], submitted["client_order_id"])
            self.assertEqual([found["type"] for found in run.native("OrderRejected")], [])
            run.venue.clear_faults()
            run.venue.mute_user_streams(False)
            fill = run.wait(lambda: next((found for found in run.native("OrderFilled")
                                          if found["client_order_id"] == submitted["client_order_id"]), None),
                            timeout=2 * live_session.SUBMISSION_QUERY_SECONDS, what="the entry's own fill")
            self.assertEqual((fill["strategy_id"], fill["last_qty"]), (str(run.strategy_id), "0.002"))
            run.wait(lambda: run.venue.open_algos(), what="the entry's stop at the venue")
            self.assertEqual(run.named("submission_unresolved"), [])
            run.stop()
            run.wait_exit()
            self.assertEqual((run.venue.position(SYMBOL, "LONG"), run.venue.open_algos()), (0, []))

    def test_an_entry_that_never_reached_binance_ends_the_run_within_the_bound(self):
        with Loopback() as run:
            run.start()
            run.ready()
            # Not placed; the answer says nothing either way. rc7 takes a 429 on an order the same way (ambiguous).
            run.venue.fail("POST", "/fapi/v1/order", 503, UNKNOWN)
            run.venue.bar(SYMBOL, TERMS["price"], volume=2)
            run.wait_event("entries_closed", reason="unverified")  # the bar closes up to a minute from now
            row = run.wait_event("submission_unresolved", timeout=live_session.SUBMISSION_UNRESOLVED_SECONDS + 60)
            self.assertLess(row["seconds"], live_session.SUBMISSION_UNRESOLVED_SECONDS + 5)
            self.assertEqual(run.named("stopping")[0]["reason"], "submission_unresolved")
            self.assertEqual(run.wait_exit(timeout=live_session.STOP_GRACE_SECONDS + 60), 1)
            self.assertEqual(run.events()[-1]["event"], "unresolved")  # the order's outcome is left to the venue's reading
            self.assertEqual((run.venue.position(SYMBOL, "LONG"), run.venue.open_orders(), run.venue.open_algos()),
                             (0, [], []))


if __name__ == "__main__":
    unittest.main()
