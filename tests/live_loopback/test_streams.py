"""Live on the loopback venue when its streams misbehave: the user stream drops, a closed kline arrives twice."""

import time
import unittest

from tests.live_loopback.harness import SYMBOL, TERMS, Loopback


class UserStreamTests(unittest.TestCase):
    def test_a_dropped_user_stream_closes_entries_and_a_stop_filled_meanwhile_is_taken_up(self):
        with Loopback() as run:
            run.start()
            run.enter()
            run.venue.drop_user_streams()
            run.wait(lambda: run.named("entries_closed"), what="entries closed")
            run.venue.bar(SYMBOL, "75000", low="74000")  # the stop triggers at the venue
            run.wait(lambda: run.named("entries_opened"), what="entries opened again")
            run.wait(lambda: run.native("PositionClosed"), what="the stop's fill in the native cache")
            self.assertEqual(run.venue.position(SYMBOL, "LONG"), 0)
            run.stop()
            self.assertEqual(run.wait_exit(), 0)
            self.assertEqual(run.events()[-1]["event"], "clean_stop")


class DuplicateKlineTests(unittest.TestCase):
    @unittest.expectedFailure  # re-judge C-067: a repeated closed kline reaches the source twice (2026-11-21)
    def test_a_closed_kline_pushed_twice_reaches_the_source_once(self):
        with Loopback() as run:
            run.start()
            run.ready()
            run.venue.repeat_next_kline()
            run.venue.bar(SYMBOL, TERMS["price"], volume=2)
            run.wait(lambda: run.venue.open_algos(), what="the entry's stop")
            settled = time.monotonic() + 20  # a second entry from the repeated kline would follow within seconds
            run.wait(lambda: run.named("entry_refused") or len(run.named("entry_verified")) > 1
                     or time.monotonic() > settled, what="a second entry or none")
            self.assertEqual(run.named("entry_refused"), [])
            self.assertEqual(len(run.named("entry_verified")), 1)


if __name__ == "__main__":
    unittest.main()
