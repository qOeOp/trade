"""Native readback is checked after the FIFO marker, including adapter error and representation cases."""
import copy
import json
from types import SimpleNamespace
import unittest
from unittest import mock

from engine import paper_checkpoint as checkpoint
from engine.paper_redis import NativeCache


def account(events, flag=True, total="100 USDT", margin="4 USDT"):
    return SimpleNamespace(to_dict=lambda: copy.deepcopy({"calculate_account_state": flag, "events": events}),
                           last_event=SimpleNamespace(to_dict=lambda: copy.deepcopy(events[-1])),
                           balance_total=lambda _: total, balance_free=lambda _: "96 USDT",
                           balance_locked=lambda _: "4 USDT", margins=lambda: {"BTC": margin},
                           account_margins=lambda: {})


class NativeReadbackTests(unittest.TestCase):
    def test_only_adjacent_identical_native_account_events_are_compressed(self):
        a, b = {"event_id": "a", "balance": "100"}, {"event_id": "b", "balance": "101"}
        before = NativeCache._native([account([a, b])])
        self.assertEqual(before, NativeCache._native([account([a, a, b], flag=False)]))
        self.assertNotEqual(before, NativeCache._native([account([a, b, a])]))
        self.assertNotEqual(before, NativeCache._native([account([a, b], total="99 USDT")]))
        self.assertNotEqual(before, NativeCache._native([account([a, b], margin="5 USDT")]))
        self.assertEqual(json.loads(before[0])["last_event"], b)

    def test_an_unfilled_orders_liquidity_side_is_not_compared_and_a_filled_ones_is(self):
        # rc7's Sandbox sets MAKER on a resting limit order without an event; Redis rebuilds it from its events.
        def order(filled, side, status="EXPIRED"):
            return SimpleNamespace(to_dict=lambda: {"client_order_id": "O-1", "filled_qty": filled,
                                                    "liquidity_side": side, "status": status})
        self.assertEqual(NativeCache._native([order("0.000", "MAKER")]),
                         NativeCache._native([order("0.000", "NO_LIQUIDITY_SIDE")]))
        self.assertNotEqual(NativeCache._native([order("0.002", "MAKER", "FILLED")]),
                            NativeCache._native([order("0.002", "TAKER", "FILLED")]))
        self.assertNotEqual(NativeCache._native([order("0.000", "MAKER")]),
                            NativeCache._native([order("0.000", "MAKER", "CANCELED")]))

    def test_same_event_uuid_with_changed_payload_refuses(self):
        a, changed = {"event_id": "a", "balance": "100"}, {"event_id": "a", "balance": "99"}
        with self.assertRaises(checkpoint.Refusal):
            NativeCache._native([account([a, changed])])

    def test_successful_marker_does_not_hide_a_failed_earlier_native_write(self):
        backend = NativeCache.__new__(NativeCache)
        marker = b'unique marker'
        backend.reader = SimpleNamespace(read=lambda _: [marker], load_all=lambda: {
            "accounts": {}, "orders": {}, "positions": {}})
        backend.port = 12345
        with mock.patch("engine.redis_child.command") as save, \
                mock.patch.object(checkpoint, "publish") as publish:
            with self.assertRaisesRegex(checkpoint.Refusal, "readback differs"):
                backend._freeze(marker, {"accounts": ['{"a":"native owner state"}'], "orders": [], "positions": []})
        save.assert_not_called()
        publish.assert_not_called()
