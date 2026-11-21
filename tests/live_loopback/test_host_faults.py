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

    def test_a_host_asleep_for_longer_than_the_brake_reads_stops_the_run_unverified(self):
        with Loopback() as run:
            run.start()
            run.enter()
            run.process.send_signal(signal.SIGSTOP)  # the venue runs on, as Binance does while a host sleeps
            time.sleep(70)
            run.process.send_signal(signal.SIGCONT)
            run.wait(lambda: run.named("stopping"), what="the run stopping")
            self.assertEqual(run.named("stopping")[0]["reason"], "drawdown_unverified")
            self.assertEqual(run.wait_exit(), 1)
            self.assertEqual((run.venue.position(SYMBOL, "LONG"), run.venue.open_algos()), (0, []))


if __name__ == "__main__":
    unittest.main()
