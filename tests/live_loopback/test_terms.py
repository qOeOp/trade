"""Live on the loopback venue when Binance changes a contract's tick mid-run to one with other decimals."""

import re
import unittest

from tests.live_loopback.harness import SYMBOL, TERMS, Loopback


class TickChangeTests(unittest.TestCase):
    def test_an_entry_after_a_tick_change_is_refused_and_the_source_keeps_the_start_tick(self):
        with Loopback() as run:
            run.start()
            run.ready()
            run.venue.set_symbol(SYMBOL, tick="0.01")  # 0.10 -> 0.01: the new tick has another decimal
            run.venue.bar(SYMBOL, TERMS["price"], volume=2)
            run.wait(lambda: run.named("stopping"), what="the run stopping")
            self.assertEqual(run.wait_exit(), 1)
            refused = run.named("entry_refused")
            self.assertEqual([row["code"] for row in refused], ["TERMS_CHANGED"])
            self.assertIn("price_increment: market 0.10, exchange 0.01", refused[0]["detail"])
            seen = re.findall(r"^probe bar \d+ 2 \S+ (\S+)$", run.log(), re.MULTILINE)
            self.assertEqual(seen, ["0.10"])  # the instrument Nautilus loaded at the start, not reloaded
            self.assertEqual(run.venue.requested("POST", "/fapi/v1/order"), 0)


if __name__ == "__main__":
    unittest.main()
