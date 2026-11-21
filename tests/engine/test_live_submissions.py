"""An order whose submission Binance's answer did not settle (engine.live_session.follow_submissions), without a node.

The loopback runs (tests.live_loopback.test_unknown_submit) show it against the rc7 adapter."""

import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

from nautilus_trader.model import OrderStatus

from engine import live, live_session
from engine.live_records import strategy_ids
from tests.engine.test_live_gate import SYMBOL, manifest


class SubmissionTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.output = Path(temp.name)
        self.session = live.Session(manifest("binding"), self.output, "run", account_verified=True)
        self.source = mock.Mock()
        self.session.sources = {SYMBOL: self.source}
        self.order = SimpleNamespace(client_order_id="O-1", status=OrderStatus.SUBMITTED, is_closed=False,
                                     strategy_id=strategy_ids(self.session.manifest)[SYMBOL])
        self.cache = SimpleNamespace(orders=lambda strategy_id=None: [self.order])
        query = mock.patch.object(live_session.Strategy, "query_order")
        self.query = query.start()
        self.addCleanup(query.stop)

    def follow(self, now):
        self.session.follow_submissions(self.cache, now)

    def events(self, name):
        path = self.output / "events.jsonl"
        rows = [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []
        return [row for row in rows if row["event"] == name]

    def test_a_submitted_order_is_queried_natively_every_interval(self):
        self.follow(1000.0)
        self.follow(1000.0 + live_session.SUBMISSION_QUERY_SECONDS - 1)
        self.query.assert_not_called()
        self.follow(1000.0 + live_session.SUBMISSION_QUERY_SECONDS)
        self.follow(1000.0 + live_session.SUBMISSION_QUERY_SECONDS + 1)
        self.assertEqual(self.query.call_args_list, [mock.call(self.source, self.order)])
        self.assertIn("unverified", self.session.connection.closed)  # no further entry until the venue agrees
        self.assertEqual(self.events("entries_closed")[0]["client_order_id"], "O-1")
        self.follow(1000.0 + 2 * live_session.SUBMISSION_QUERY_SECONDS)
        self.assertEqual(self.query.call_count, 2)
        self.assertFalse(self.session.stopping)

    def test_one_still_unsettled_after_the_bound_takes_the_stop_path_failed(self):
        self.follow(1000.0)
        self.follow(1000.0 + live_session.SUBMISSION_UNRESOLVED_SECONDS - 1)
        self.assertFalse(self.session.stopping)
        self.follow(1000.0 + live_session.SUBMISSION_UNRESOLVED_SECONDS)
        self.assertTrue(self.session.stopping and self.session.failed)
        [row] = self.events("submission_unresolved")
        self.assertEqual((row["client_order_id"], row["seconds"]), ("O-1", live_session.SUBMISSION_UNRESOLVED_SECONDS))
        self.follow(1000.0 + live_session.SUBMISSION_UNRESOLVED_SECONDS + 1)
        self.assertEqual(len(self.events("submission_unresolved")), 1)

    def test_a_settled_order_is_no_longer_followed(self):
        self.follow(1000.0)
        self.order.status = OrderStatus.ACCEPTED
        self.follow(1000.0 + live_session.SUBMISSION_UNRESOLVED_SECONDS)
        self.query.assert_not_called()
        self.assertEqual((self.session.submitted, self.session.stopping), ({}, False))


if __name__ == "__main__":
    unittest.main()
