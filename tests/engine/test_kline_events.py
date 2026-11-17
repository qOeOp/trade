import json
import struct
import unittest
from unittest import mock

from engine import kline_events

CLOSE_MS = 1_794_931_919_999


def message(symbol="BTCUSDT", closed=True, interval="1m", sent_ms=CLOSE_MS + 6) -> dict:
    """A combined-stream kline message as Binance sends it."""
    return {"stream": f"{symbol.lower()}@kline_{interval}",
            "data": {"e": "kline", "E": sent_ms, "s": symbol,
                     "k": {"t": CLOSE_MS - 59_999, "T": CLOSE_MS, "s": symbol, "i": interval, "x": closed}}}


class Messages(unittest.TestCase):
    def test_a_closed_minute_gives_its_close_as_nautilus_stamps_the_bar_and_binances_time(self):
        self.assertEqual(kline_events.closed(message()), ("BTCUSDT", CLOSE_MS * 10**6, (CLOSE_MS + 6) * 10**6))
        for other in (message(closed=False), message(interval="5m"), {"result": None, "id": 1}):
            self.assertIsNone(kline_events.closed(other))

    def test_the_first_message_of_a_close_stands_and_other_contracts_are_ignored(self):
        events = kline_events.KlineEvents(["BTCUSDT"], None)
        for found in (message(), message(sent_ms=CLOSE_MS + 900), message("ETHUSDT")):
            events.take(found)
        self.assertEqual(events.drain(), [("BTCUSDT-PERP.BINANCE", CLOSE_MS * 10**6, (CLOSE_MS + 6) * 10**6)])
        self.assertEqual(events.drain(), [])


class Received(unittest.TestCase):
    def test_late_is_the_runs_own_delay_after_binance_sent_the_bar(self):
        close = CLOSE_MS * 10**6
        iid = "BTCUSDT-PERP.BINANCE"
        sent = close + 10**6 + 3 * 10**9  # Binance sent it 3 s after the close
        bars = [{"instrument_id": iid, "ts_event": close, "ts_init": sent + kline_events.LATE_NS},
                {"instrument_id": iid, "ts_event": close + 60 * 10**9, "ts_init": close + 60 * 10**9 + 10**6 + 10**7}]
        events = [{"instrument_id": iid, "ts_event": close, "event_ns": sent}]
        self.assertEqual(kline_events.received(bars, events),
                         {iid: {"late": [], "unknown": [close + 60 * 10**9], "side_down": {},
                                "sent": {close: 3 * 10**9}}})
        bars[0]["ts_init"] += 1
        self.assertEqual(kline_events.received(bars, events)[iid]["late"], [close])


    def test_a_bar_with_no_event_time_while_the_side_connection_was_down_says_why(self):
        """A bar with no kline_event counts as the side connection's gap when the connection was not up at some
        moment from its close to LATE_NS after the run received it; before a process's first up it was starting."""
        iid, minute = "BTCUSDT-PERP.BINANCE", 60 * 10**9
        close = CLOSE_MS * 10**6
        bars = [{"instrument_id": iid, "ts_event": close + i * minute, "ts_init": close + i * minute + 10**8}
                for i in range(6)]
        sockets = [{"state": "up", "at_ns": close + 2 * 10**9},  # the process's first up, after bar 0's window
                   # the last frame came after bar 2's receipt, still inside its LATE_NS
                   {"state": "down", "at_ns": close + 2 * minute + 10**8 + 10**7, "reason": "silent"},
                   {"state": "up", "at_ns": close + 3 * minute + 10**9},
                   {"state": "down", "at_ns": close + 4 * minute + 10**9, "reason": "closed"},
                   {"state": "down", "at_ns": close + 5 * minute - 10**8, "reason": "refused"}]
        found = kline_events.received(bars, [], sockets, starts=[close - minute])[iid]
        self.assertEqual(found["unknown"], [close + minute])
        self.assertEqual(found["side_down"], {close: "starting", close + 2 * minute: "silent",
                                              close + 3 * minute: "silent", close + 4 * minute: "closed",
                                              close + 5 * minute: "refused"})
        # With no state recorded, a bar with no event time stays unknown, as before.
        self.assertEqual(kline_events.received(bars, [])[iid]["side_down"], {})


class Connection(unittest.TestCase):
    def test_each_state_change_is_kept_with_when_the_link_was_last_alive_and_why_it_went(self):
        text = json.dumps(message()).encode()
        plans = iter([kline_events.Refused("403"), kline_events.Refused("403"), [text, TimeoutError()], [text],
                      [ConnectionError("the connection closed")], [ValueError("bad")], TimeoutError()])
        events = kline_events.KlineEvents(["BTCUSDT"], None)
        clock = iter(range(1, 1000))

        def opener(*_):
            plan = next(plans, None)
            if plan is None:  # the run stops: a failure while stopping is no gap
                events.stop()
                plan = ConnectionError("stopped")
            if isinstance(plan, BaseException):
                raise plan
            return mock.Mock(items=plan)

        def frames(stream):
            for item in stream.items:
                if isinstance(item, BaseException):
                    raise item
                yield item

        events._open = opener
        with mock.patch.object(kline_events, "frames", frames), \
                mock.patch.object(kline_events.time, "time_ns", lambda: next(clock)), \
                mock.patch.object(events._stop, "wait"):
            events._run()
        states = events.drain_states()
        # never up in this process; the second refusal says nothing new. The timeout before an up at the end is not
        # silence, and the same reason as the down before it, so it is not repeated.
        self.assertEqual([(state, reason) for state, _, reason in states], [
            ("down", "refused"),
            ("up", None), ("down", "silent"),
            ("up", None), ("down", "closed"),  # the server's close frame
            ("up", None), ("down", "closed"),  # the stream ended
            ("up", None), ("down", "error")])
        at = [at for _, at, _ in states]
        self.assertEqual(at, sorted(at))
        self.assertEqual(at[2] - at[1], 1)  # silent: when the last frame came, not when the timeout was seen
        self.assertEqual(events.drain_states(), [])


class FakeSocket:
    def __init__(self, data: bytes):
        self.data, self.sent = data, b""

    def recv(self, size: int) -> bytes:
        chunk, self.data = self.data[:size], self.data[size:]
        return chunk

    def sendall(self, data: bytes) -> None:
        self.sent += data


def frame(opcode: int, payload: bytes, fin: bool = True) -> bytes:
    size = len(payload)
    head = bytes([(0x80 if fin else 0) | opcode])
    return head + (bytes([size]) if size < 126 else bytes([126]) + struct.pack(">H", size)) + payload


class Frames(unittest.TestCase):
    def test_text_is_joined_across_fragments_a_ping_is_answered_and_a_close_ends(self):
        text = json.dumps(message()).encode()
        stream = FakeSocket(frame(0x9, b"hi") + frame(0x1, text[:10], fin=False) + frame(0x0, text[10:])
                            + frame(0x8, b""))
        self.assertEqual(list(kline_events.frames(stream)), [text])
        mask = stream.sent[2:6]
        self.assertEqual((stream.sent[0], stream.sent[1], bytes(b ^ mask[i % 4] for i, b in enumerate(stream.sent[6:]))),
                         (0x8A, 0x82, b"hi"))  # a masked pong with the ping's payload


if __name__ == "__main__":
    unittest.main()
