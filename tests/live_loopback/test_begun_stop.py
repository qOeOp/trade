"""Live killed inside a stop that was to end the run: the next start finishes that stop and never trades (#3521)."""

from decimal import Decimal
import json
import time
import unittest

from tests.live_loopback.harness import MEMORY_CACHE, SYMBOL, Loopback

CLOSE = ("POST", "/fapi/v1/order")


@unittest.skipIf(MEMORY_CACHE, "a start again needs the runtime image's Redis")
class BegunStopTests(unittest.TestCase):
    def kill(self, run):
        run.process.kill()
        run.process.wait()
        time.sleep(3)  # its Redis child goes with it

    def killed_in_a_drawdown_stop(self, run, *, sent: bool = False):
        with run.venue.lock:
            run.venue.wallet -= 20  # equity 20% below its peak
        run.wait(lambda: run.named("stopping"), what="the drawdown stop")  # its close goes out a second later
        if sent:
            run.wait(lambda: any(found[:2] == CLOSE for found in run.venue.requests[self.before:]), what="the close")
        self.kill(run)
        run.venue.clear_faults()
        with run.venue.lock:
            run.venue.wallet += 10  # 10% below: the brake itself would not stop a new start
        self.assertEqual(run.named("stopping")[0]["reason"], "drawdown")

    def entered(self, run):
        run.start()
        run.enter()
        self.before = len(run.venue.requests)

    def finished(self, run, code=0):
        run.start()
        self.assertEqual(run.wait_exit(180), code, run.log()[-3000:])
        self.assertEqual((run.venue.position(SYMBOL, "LONG"), run.venue.open_algos(), run.venue.open_orders()),
                         (Decimal(0), [], []))
        self.assertEqual(len(run.named("warmup")), 1)  # no source after the first start
        self.assertIn(run.events()[-1]["event"], ("clean_stop", "venue_flat", "stopping"))
        self.assertEqual(run.named("unresolved"), [])
        run.start()  # over: refused
        self.assertEqual(run.wait_exit(), 2)

    def test_an_open_position_is_closed_by_the_next_start(self):
        with Loopback() as run:
            self.entered(run)
            self.killed_in_a_drawdown_stop(run)
            self.assertEqual(run.venue.position(SYMBOL, "LONG"), Decimal("0.002"))
            self.finished(run)
            self.assertEqual(run.events()[-1]["event"], "clean_stop")

    def test_a_kill_while_the_next_start_finishes_is_finished_by_the_one_after(self):
        with Loopback() as run:
            self.entered(run)
            self.killed_in_a_drawdown_stop(run)
            run.start()
            run.wait(lambda: len(run.named("stopping")) > 1, what="the begun stop taken up again")
            self.kill(run)
            self.assertEqual(run.venue.position(SYMBOL, "LONG"), Decimal("0.002"))
            self.finished(run)

    def test_a_close_whose_answer_was_lost_is_not_sent_twice(self):
        with Loopback() as run:
            self.entered(run)
            run.venue.lose(*CLOSE, times=20)
            run.venue.mute_user_streams()
            self.killed_in_a_drawdown_stop(run, sent=True)
            run.venue.mute_user_streams(False)
            self.assertEqual(run.venue.position(SYMBOL, "LONG"), Decimal(0))
            self.finished(run)

    def test_a_close_that_may_have_arrived_is_not_sent_again_and_its_position_keeps_its_stop(self):
        with Loopback() as run:
            self.entered(run)
            run.venue.fail(*CLOSE, 503, {"code": -1007, "msg": "Send status unknown; execution status unknown."},
                           times=20)
            self.killed_in_a_drawdown_stop(run, sent=True)
            run.start()
            self.assertEqual(run.wait_exit(180), 1)  # as in the stop's own process: unresolved, and the user is told
            self.assertEqual([row["reason"] for row in run.named("unresolved") if "reason" in row],
                             ["native_exit_timeout"])
            self.assertEqual((run.venue.position(SYMBOL, "LONG"), len(run.venue.open_algos())), (Decimal("0.002"), 1))
            self.assertEqual(sum(found[:2] == CLOSE for found in run.venue.requests[self.before:]), 1)

    def test_a_flat_run_starts_again_only_to_end(self):
        with Loopback() as run:
            run.start()
            run.ready()
            time.sleep(2)
            # As a kill inside a flat drawdown stop leaves it: the stop journalled, no ending event.
            self.kill(run)
            stop = dict(run.named("warmup")[0], event="stopping", reason="drawdown", observed_ns=time.time_ns())
            with (run.output / "events.jsonl").open("a") as stream:
                stream.write(json.dumps(stop) + "\n")
            self.finished(run)
            self.assertEqual(run.events()[-1]["event"], "clean_stop")


if __name__ == "__main__":
    unittest.main()
