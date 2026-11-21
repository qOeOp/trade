"""Binance's own time for each closed one-minute kline of a run's contracts, which Nautilus does not hand over.

rc7's Binance data client reads the kline stream's event time E and drops it: a bar carries its close (``ts_event``)
and the moment the client received it (``ts_init``) only, and no hook reaches the raw message (rc9 the same;
docs/plans/late-bar-exchange-time-20261118.zh.md). So Paper and Live keep a second connection to the same public
streams, through the run's proxy when it has one, and journal each closed kline's E as a ``kline_event`` line
(``instrument_id``, ``ts_event``: its close as Nautilus stamps the bar, ``event_ns``: E).

A bar is late when the client received it more than LATE_NS after Binance sent it (``ts_init − event_ns``): only our
side's delay. How long after the close Binance sent it is evidence, never a cause. A bar with no ``kline_event`` (this
connection was down, or the run started or resumed in that minute) is unknown, neither late nor on time.

The connection never stops the run: a failure reconnects after a pause. Each change of its state is journalled as a
``kline_socket`` line (``state``: ``up`` or ``down``; ``at_ns``: the host's time it was up from, or last shown alive
at: its last frame; ``reason`` on a ``down``: closed, silent, refused or error), and a process begins with it down
(``starting``) until its first ``up``. A bar with no ``kline_event`` while it was down counts apart from the unknown
ones, with the reason (docs/plans/late-bar-exchange-time-20261118.zh.md).
"""
from __future__ import annotations

import base64
from collections.abc import Iterable, Iterator, Mapping
import contextlib
import json
import os
import socket
import ssl
import struct
import threading
import time
from urllib.parse import urlsplit

from engine.config import instrument_id

HOST = "fstream.binance.com"
PORT = 443
PATH = "/market/stream?streams="
LATE_NS = 2 * 10**9  # a bar the client received more than this after Binance sent it is late
MILLISECOND_NS = 1_000_000
SILENCE_SECONDS = 30  # a kline stream pushes several times a second; this long without a frame is a dead link
RETRY_SECONDS = (1, 2, 5, 10, 30)
STARTING = "starting"  # the reason a process's side connection is down before its first up: derived, never stored


class Refused(ConnectionError):
    """The proxy refused the tunnel or the stream the upgrade."""


def closed(message: Mapping) -> tuple[str, int, int] | None:
    """(symbol, close in ns as Nautilus stamps the bar, Binance's event time E in ns) of a combined-stream message
    holding a closed one-minute kline, else None."""
    data = message.get("data", message)
    kline = data.get("k") if isinstance(data, Mapping) else None
    if not isinstance(kline, Mapping) or data.get("e") != "kline" or kline.get("i") != "1m" or kline.get("x") is not True:
        return None
    symbol, close, sent = data.get("s"), kline.get("T"), data.get("E")
    if not isinstance(symbol, str) or type(close) is not int or type(sent) is not int:
        return None
    return symbol, close * MILLISECOND_NS, sent * MILLISECOND_NS


def _timeline(sockets: Iterable[Mapping], starts: Iterable[int]) -> list[tuple[int, str | None]]:
    """The side connection's states by time: (from, None while up, else the reason it was down). Each process start
    makes it down (STARTING) until the next ``up``; before any line or start it was up as far as is recorded."""
    found: list[tuple[int, int, str | None]] = [(at, 0, STARTING) for at in starts if isinstance(at, int)]
    for line in sockets:
        at = line.get("at_ns")
        if isinstance(at, int) and line.get("state") in ("up", "down"):
            found.append((at, 1, None if line["state"] == "up" else str(line.get("reason") or "error")))
    return [(at, reason) for at, _, reason in sorted(found, key=lambda item: item[:2])]


def _down(timeline: list[tuple[int, str | None]], first: int, last: int) -> str | None:
    """The reason the side connection was down at the first moment of [first, last] it was, else None."""
    reason = None
    for at, state in timeline:
        if at > last:
            break
        if at <= first:
            reason = state
        elif reason is None and state is not None:
            return state
    return reason


def received(bars: Iterable[Mapping], events: Iterable[Mapping], sockets: Iterable[Mapping] = (),
             starts: Iterable[int] = ()) -> dict[str, dict]:
    """Per contract, its one-minute bars by when Binance sent them: {late: closes the client received more than
    LATE_NS after Binance sent them, unknown: closes with no kline_event while the side connection was up, side_down:
    {close: why the side connection was down} for those with none while it was down at some moment from the close to
    LATE_NS after the client received the bar (it reads the same message about when the client does), sent: {close:
    ns from the close (its last millisecond) to Binance sending it}}. `bars`: journal ``bar`` lines (instrument_id,
    ts_event, ts_init); `events`: ``kline_event`` lines, the first of a close standing; `sockets`: ``kline_socket``
    lines; `starts`: when each of the run's processes began (its side connection down until its first ``up``)."""
    timeline = _timeline(sockets, starts)
    sent: dict[tuple[str, int], int] = {}
    for line in events:
        close = line.get("ts_event")
        if isinstance(close, int) and isinstance(line.get("event_ns"), int):
            sent.setdefault((str(line.get("instrument_id")), close), line["event_ns"])
    found: dict[str, dict] = {}
    for line in bars:
        iid, close = str(line.get("instrument_id")), line.get("ts_event")
        if not isinstance(close, int):
            continue
        item = found.setdefault(iid, {"late": [], "unknown": [], "side_down": {}, "sent": {}})
        at = sent.get((iid, close))
        if at is None or not isinstance(line.get("ts_init"), int):
            receipt = line.get("ts_init")
            why = _down(timeline, close, (receipt if isinstance(receipt, int) else close) + LATE_NS)
            if why is None:
                item["unknown"].append(close)
            else:
                item["side_down"][close] = why
            continue
        item["sent"][close] = at - (close + MILLISECOND_NS)
        if line["ts_init"] - at > LATE_NS:
            item["late"].append(close)
    return found


# The connection: a plain RFC 6455 client over the run's CONNECT proxy, for the few public streams it reads.

def _read_head(stream) -> bytes:
    head = b""
    while not head.endswith(b"\r\n\r\n"):
        byte = stream.recv(1)
        if not byte or len(head) > 16384:
            raise ConnectionError("the response head ended early")
        head += byte
    return head


def _exact(stream, size: int) -> bytes:
    data = b""
    while len(data) < size:
        chunk = stream.recv(size - len(data))
        if not chunk:
            raise ConnectionError("the connection closed")
        data += chunk
    return data


def connect(symbols: Iterable[str], proxy_url: str | None, timeout: float = SILENCE_SECONDS, host: str | None = None):
    """A websocket on the closed-kline streams of `symbols` at `host` (HOST, production, when None; a Live run's
    environment: engine.live_venue.VENUES), through `proxy_url` when given."""
    host = host or HOST
    if proxy_url:
        proxy = urlsplit(proxy_url)
        raw = socket.create_connection((proxy.hostname, proxy.port or 3128), timeout=timeout)
        raw.sendall(f"CONNECT {host}:{PORT} HTTP/1.1\r\nHost: {host}:{PORT}\r\n\r\n".encode())
        status = _read_head(raw).split(b"\r\n", 1)[0].split(b" ")
        if len(status) < 2 or status[1] != b"200":
            raw.close()
            raise Refused(f"the proxy refused the tunnel: {b' '.join(status[:3]).decode('latin-1')}")
    else:
        raw = socket.create_connection((host, PORT), timeout=timeout)
    context = ssl.create_default_context()
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    stream = context.wrap_socket(raw, server_hostname=host)
    stream.settimeout(timeout)
    key = base64.b64encode(os.urandom(16)).decode()
    streams = "/".join(f"{symbol.lower()}@kline_1m" for symbol in symbols)
    stream.sendall((f"GET {PATH}{streams} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                    f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
    status = _read_head(stream).split(b"\r\n", 1)[0].split(b" ")
    if len(status) < 2 or status[1] != b"101":
        stream.close()
        raise Refused(f"the stream refused the upgrade: {b' '.join(status[:3]).decode('latin-1')}")
    return stream


def send(stream, opcode: int, payload: bytes = b"") -> None:
    """One masked frame, as a client sends."""
    mask = os.urandom(4)
    size = len(payload)
    head = bytes([0x80 | opcode]) + (bytes([0x80 | size]) if size < 126 else bytes([0x80 | 126]) + struct.pack(">H", size))
    stream.sendall(head + mask + bytes(value ^ mask[i % 4] for i, value in enumerate(payload)))


def frames(stream) -> Iterator[bytes]:
    """The text messages of `stream`, answering pings; returns when the server closes."""
    parts: list[bytes] = []
    while True:
        first, second = _exact(stream, 2)
        opcode, size = first & 0x0F, second & 0x7F
        if size == 126:
            size = struct.unpack(">H", _exact(stream, 2))[0]
        elif size == 127:
            size = struct.unpack(">Q", _exact(stream, 8))[0]
        mask = _exact(stream, 4) if second & 0x80 else b""
        payload = _exact(stream, size)
        if mask:
            payload = bytes(value ^ mask[i % 4] for i, value in enumerate(payload))
        if opcode == 0x8:
            return
        if opcode == 0x9:
            send(stream, 0xA, payload)
        elif opcode in (0x0, 0x1, 0x2):
            parts.append(payload)
            if first & 0x80:
                yield b"".join(parts)
                parts = []


class KlineEvents:
    """The run's closed-kline events, read on a daemon thread and taken (`drain`) by the node's own thread, which
    journals them: the journal and its checkpoint see writes from the node's thread only."""

    def __init__(self, symbols: Iterable[str], proxy_url: str | None, opener=connect):
        self.symbols = sorted(symbols)
        self.proxy_url = proxy_url
        self._open = opener
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._found: list[tuple[str, int, int]] = []
        self._states: list[tuple[str, int, str | None]] = []
        self._reason: str | None = STARTING  # why it is down now, None while up
        self._last: dict[str, int] = {}  # symbol -> the latest close taken: the first message of a close stands
        self._thread: threading.Thread | None = None
        self.failures = 0

    def start(self) -> None:
        if self.symbols and self._thread is None:
            self._thread = threading.Thread(target=self._run, name="kline-events", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def drain(self) -> list[tuple[str, int, int]]:
        """(instrument ID, close, event time) of each closed kline read since the last drain."""
        with self._lock:
            found, self._found = self._found, []
        return found

    def drain_states(self) -> list[tuple[str, int, str | None]]:
        """(state, at_ns, reason) of each change of the connection's state since the last drain."""
        with self._lock:
            found, self._states = self._states, []
        return found

    def _state(self, reason: str | None, at: int) -> None:
        """Keep a change: up (reason None), down, or down for another reason than the one kept."""
        if reason == self._reason:
            return
        self._reason = reason
        with self._lock:
            self._states.append(("up", at, None) if reason is None else ("down", at, reason))

    def take(self, message: Mapping) -> None:
        found = closed(message)
        if found is None or found[0] not in self.symbols or found[1] <= self._last.get(found[0], -1):
            return
        symbol, close, sent = found
        self._last[symbol] = close
        with self._lock:
            self._found.append((instrument_id(symbol), close, sent))

    def _run(self) -> None:
        attempt = 0
        while not self._stop.is_set():
            stream = None
            alive: int | None = None  # up: the last moment the link was shown alive
            began = time.time_ns()
            reason: str | None = "closed"  # the server's close frame
            try:
                stream = self._open(self.symbols, self.proxy_url)
                alive = time.time_ns()
                self._state(None, alive)
                attempt = 0
                for text in frames(stream):
                    alive = time.time_ns()
                    if self._stop.is_set():
                        break
                    self.take(json.loads(text))
            except Exception as exc:  # noqa: BLE001 - any failure of this connection only leaves its minutes without E
                self.failures += 1
                reason = ("refused" if isinstance(exc, Refused)
                          else "silent" if alive is not None and isinstance(exc, TimeoutError)
                          else "closed" if alive is not None and isinstance(exc, ConnectionError) else "error")
            finally:
                if stream is not None:
                    with contextlib.suppress(OSError):
                        stream.close()
            if not self._stop.is_set():  # a stop is no gap: no bar comes after it
                self._state(reason, began if alive is None else alive)
            self._stop.wait(RETRY_SECONDS[min(attempt, len(RETRY_SECONDS) - 1)])
            attempt += 1
