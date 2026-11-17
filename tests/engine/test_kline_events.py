import json
import struct
import unittest

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
                         {iid: {"late": [], "unknown": [close + 60 * 10**9], "sent": {close: 3 * 10**9}}})
        bars[0]["ts_init"] += 1
        self.assertEqual(kline_events.received(bars, events)[iid]["late"], [close])


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
