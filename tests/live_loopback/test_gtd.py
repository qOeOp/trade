"""Live on the loopback venue with a GTD entry the rc7 adapter cannot send: refused before anything reaches Binance."""

import unittest

from tests.live_loopback.harness import SYMBOL, TERMS, Loopback


class GtdEntryTests(unittest.TestCase):
    def test_a_gtd_entry_live_cannot_send_is_refused_by_the_order_rules_before_binance(self):
        for command in (4, 5):  # a fractional-second expiry; a GTD STOP_MARKET entry
            with self.subTest(command=command), Loopback() as run:
                run.start()
                run.ready()
                run.venue.bar(SYMBOL, TERMS["price"], volume=command)
                run.wait(lambda: run.named("stopping"), what="the run stopping")
                self.assertEqual(run.wait_exit(), 1)
                self.assertEqual([row["code"] for row in run.named("entry_refused")], ["ORDER_RULE"])
                self.assertEqual(run.named("stopping")[0]["reason"], "entry_admission_failed")
                self.assertEqual(run.events()[-1]["event"], "clean_stop")
                self.assertEqual(run.venue.requested("POST", "/fapi/v1/order")
                                 + run.venue.requested("POST", "/fapi/v1/algoOrder"), 0)


if __name__ == "__main__":
    unittest.main()
