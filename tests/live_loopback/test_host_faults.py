"""Live on the loopback venue when the host fails it: the disk fills, the host sleeps."""

import signal
import time
import unittest

from tests.live_loopback.harness import SYMBOL, TERMS, Loopback


class HostFaultTests(unittest.TestCase):
    def test_a_full_disk_stops_the_run_flat_with_no_ending_event_and_a_torn_journal(self):
        with Loopback() as run:
            run.start(file_size_limit=6000)  # the journal fills while the entry is journaled
            run.ready()
            run.venue.bar(SYMBOL, TERMS["price"], volume=2)
            self.assertEqual(run.wait_exit(240), 2)
            self.assertIn("LIVE_JOURNAL_UNAVAILABLE", run.log())
            data = (run.output / "events.jsonl").read_bytes()
            self.assertEqual(len(data), 6000)
            self.assertFalse(data.endswith(b"\n"))  # live.state.events refuses it: kept for reconciliation
            self.assertFalse(any(f'"event": "{end}"'.encode() in data for end in ("clean_stop", "unresolved")))
            self.assertEqual((run.venue.position(SYMBOL, "LONG"), run.venue.open_algos()), (0, []))

    def asleep(self, run, seconds):
        run.process.send_signal(signal.SIGSTOP)  # the venue runs on, as Binance does while a host sleeps
        time.sleep(seconds)
        run.venue.clear_faults()
        run.process.send_signal(signal.SIGCONT)

    def stopped(self, run):
        run.wait(lambda: run.named("stopping"), what="the run stopping")
        self.assertEqual(run.wait_exit(), 1)
        self.assertEqual((run.venue.position(SYMBOL, "LONG"), run.venue.open_algos()), (0, []))
        return run.named("stopping")[0]["reason"]

    def test_a_host_asleep_for_over_a_minute_stops_the_run(self):
        with Loopback() as run:
            run.start()
            run.enter()
            self.asleep(run, 70)
            # Mark and equity are both over a minute old, and the first check to see it stops the run: the mark's comes
            # first, unless a tick had not yet seen the position or a new mark arrives before the first tick.
            reason = self.stopped(run)
            self.assertIn(reason, ("mark_missing", "drawdown_unverified"))
            self.assertEqual(len(run.named(reason)), 1)

    def test_a_host_asleep_for_longer_than_the_brake_reads_stops_the_run_unverified(self):
        with Loopback() as run:
            run.start()
            run.enter()
            # The equity, unread since before the sleep, is over a minute old at the wake; the marks, which went on
            # until it, are not. Neither the failed reads nor the sleep is long enough alone.
            run.venue.fail("GET", "/fapi/v1/accountConfig", 503, times=10_000)  # read by the product alone, not by Nautilus
            time.sleep(25)
            self.assertEqual(run.named("stopping"), [])
            self.asleep(run, 45)
            self.assertEqual(self.stopped(run), "drawdown_unverified")
            self.assertEqual(run.named("mark_missing"), [])


if __name__ == "__main__":
    unittest.main()
