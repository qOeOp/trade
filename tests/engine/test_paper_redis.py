"""Native readback is checked after the FIFO marker, including adapter error and representation cases."""
import copy
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

from engine import paper_checkpoint as checkpoint, paper_redis
from engine.paper_redis import NativeCache


def account(events, flag=True, total="100 USDT", margin="4 USDT"):
    return SimpleNamespace(to_dict=lambda: copy.deepcopy({"calculate_account_state": flag, "events": events}),
                           last_event=SimpleNamespace(to_dict=lambda: copy.deepcopy(events[-1])),
                           balance_total=lambda _: total, balance_free=lambda _: "96 USDT",
                           balance_locked=lambda _: "4 USDT", margins=lambda: {"BTC": margin},
                           account_margins=dict)


class NativeReadbackTests(unittest.TestCase):
    def test_only_adjacent_identical_native_account_events_are_compressed(self):
        a, b = {"event_id": "a", "balance": "100"}, {"event_id": "b", "balance": "101"}
        before = NativeCache._native([account([a, b])])
        self.assertEqual(before, NativeCache._native([account([a, a, b], flag=False)]))
        self.assertNotEqual(before, NativeCache._native([account([a, b, a])]))
        self.assertEqual(json.loads(before[0])["last_event"], b)

    def test_margins_with_no_event_behind_them_are_not_compared(self):
        # rc7's initialize_positions sets an open position's maintenance margin in memory only, so after a resume
        # the owner's margins and locked balance differ from the account Redis rebuilds (finding 20261115-03).
        a, b = {"event_id": "a", "balance": "100"}, {"event_id": "b", "balance": "101", "margins": []}
        self.assertEqual(NativeCache._native([account([a, b])]),
                         NativeCache._native([account([a, b], total="99 USDT", margin="5 USDT")]))
        self.assertNotEqual(NativeCache._native([account([a, b])]),
                            NativeCache._native([account([a, dict(b, margins=["5 USDT"])])]))

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


class NativeHealthTests(unittest.TestCase):
    def cache(self, poll=None, returncode=None):
        backend = NativeCache.__new__(NativeCache)
        backend.port = 12345
        backend.process = SimpleNamespace(poll=lambda: poll, returncode=returncode)
        backend.unanswered = None
        return backend

    def test_a_child_that_answers_is_healthy(self):
        with mock.patch("engine.redis_child.command", return_value=b"PONG") as ping:
            self.cache().health()
        ping.assert_called_once_with(12345, "PING", timeout=2.0)

    def test_an_exited_child_or_one_that_does_not_answer_is_unavailable(self):
        with mock.patch("engine.redis_child.command") as ping:
            with self.assertRaisesRegex(paper_redis.CacheUnavailable, "exited with -9"):
                self.cache(poll=-9, returncode=-9).health()
            ping.assert_not_called()
        for failure in ({"side_effect": ConnectionRefusedError("refused")}, {"side_effect": TimeoutError("timed out")},
                        {"return_value": b"LOADING"}, {"side_effect": OSError("native cache rejected the command")}):
            with self.subTest(failure=failure), mock.patch("engine.redis_child.command", **failure), \
                    mock.patch("time.monotonic", side_effect=[0.0, 10.0, 20.0, 30.0, 40.0]):
                backend = self.cache()
                for _ in range(4):
                    backend.health()
                with self.assertRaisesRegex(paper_redis.CacheUnavailable, "5 in a row over 40 s"):
                    backend.health()

    def test_a_host_stall_that_ends_within_the_window_does_not_end_the_run(self):
        """Release host runs 3 and 4 ended together on 2026-11-20 when the VM stalled and one PING went unanswered."""
        backend = self.cache()
        answers = [TimeoutError("timed out")] * 6 + [b"PONG"] + [TimeoutError("timed out")] * 4
        with mock.patch("engine.redis_child.command", side_effect=answers), \
                mock.patch("time.monotonic", side_effect=[float(t) for t in range(0, 100, 5)]):
            for _ in answers:
                backend.health()
        self.assertEqual(backend.unanswered[1], 4)

    def test_many_quick_misses_alone_and_one_late_miss_alone_do_not_end_the_run(self):
        for clock, misses in (([0.0, 1.0, 2.0, 3.0, 4.0, 5.0], 6), ([0.0, 60.0], 2)):
            with self.subTest(misses=misses), mock.patch("engine.redis_child.command", side_effect=TimeoutError()), \
                    mock.patch("time.monotonic", side_effect=clock):
                backend = self.cache()
                for _ in range(misses):
                    backend.health()

    def test_both_sides_fail_fast_on_a_dead_cache(self):
        """rc7's defaults retry for minutes and `node.dispose()` then never returns (measured 2026-11-15: 92 s)."""
        process = SimpleNamespace(poll=lambda: None)
        opened = []
        with tempfile.TemporaryDirectory() as name, \
                mock.patch("engine.redis_child.start", return_value=(process, 4242)), \
                mock.patch("engine.redis_child.ready", return_value=True), \
                mock.patch.object(paper_redis, "RedisCacheDatabase", side_effect=lambda *args: opened.append(args)):
            backend = NativeCache(Path(name), "identity", "TRADER-001")
            backend.working.cleanup()
        fast = {"connection_timeout": 1, "response_timeout": 1, "number_of_retries": 0, "max_delay": 1}
        self.assertEqual({key: getattr(backend.config, key) for key in fast}, fast)
        self.assertEqual(json.loads(opened[0][3]), {"host": "127.0.0.1", "port": 4242, **fast})
