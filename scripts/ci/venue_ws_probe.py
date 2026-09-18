#!/usr/bin/env python3
"""Measure whether a venue's public WebSocket is reachable from this host.

The daily source canary probes REST instruments endpoints. A venue can serve or
refuse those independently of its streaming endpoint, so a REST refusal settles
nothing about a live channel. This probe answers the streaming question the only
way that counts: it performs the real handshake, subscribes, and waits for one
frame.

It reads nothing, admits nothing and persists nothing. Market Data remains the
sole ingestion authority; this is reachability evidence for a decision about
which venue a live channel should use.
"""

from __future__ import annotations

import base64
import json
import os
import socket
import ssl
import struct
import sys
from dataclasses import dataclass

HANDSHAKE_TIMEOUT_S = 10.0
FRAME_TIMEOUT_S = 15.0


@dataclass(frozen=True)
class Venue:
    name: str
    host: str
    port: int
    path: str
    subscribe: str


VENUES = (
    Venue(
        name="Bybit spot public",
        host="stream.bybit.com",
        port=443,
        path="/v5/public/spot",
        subscribe=json.dumps({"op": "subscribe", "args": ["publicTrade.BTCUSDT"]}),
    ),
    Venue(
        name="OKX public",
        host="ws.okx.com",
        port=8443,
        path="/ws/v5/public",
        subscribe=json.dumps(
            {"op": "subscribe", "args": [{"channel": "trades", "instId": "BTC-USDT"}]}
        ),
    ),
    Venue(
        name="Binance spot public",
        host="stream.binance.com",
        port=9443,
        path="/ws/btcusdt@trade",
        subscribe="",
    ),
)


def _mask(payload: bytes) -> bytes:
    """Client frames must be masked, so every send carries its own random key."""
    key = os.urandom(4)
    masked = bytes(byte ^ key[index % 4] for index, byte in enumerate(payload))
    return key + masked


def _text_frame(text: str) -> bytes:
    payload = text.encode()
    header = bytearray([0x81])
    length = len(payload)

    if length < 126:
        header.append(0x80 | length)
    elif length < 65536:
        header.append(0x80 | 126)
        header.extend(struct.pack(">H", length))
    else:
        header.append(0x80 | 127)
        header.extend(struct.pack(">Q", length))
    return bytes(header) + _mask(payload)


def _read_exact(connection: ssl.SSLSocket, count: int) -> bytes:
    chunks = []
    remaining = count

    while remaining > 0:
        chunk = connection.recv(remaining)
        if not chunk:
            raise ConnectionError("the peer closed before the frame was complete")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def _read_frame(connection: ssl.SSLSocket) -> tuple[int, bytes]:
    first, second = _read_exact(connection, 2)
    opcode = first & 0x0F
    length = second & 0x7F

    if length == 126:
        length = struct.unpack(">H", _read_exact(connection, 2))[0]
    elif length == 127:
        length = struct.unpack(">Q", _read_exact(connection, 8))[0]
    return opcode, _read_exact(connection, length) if length else b""


def probe(venue: Venue) -> tuple[str, str]:
    """Returns one bounded verdict and one line of detail."""
    context = ssl.create_default_context()
    key = base64.b64encode(os.urandom(16)).decode()
    request = (
        f"GET {venue.path} HTTP/1.1\r\n"
        f"Host: {venue.host}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        "User-Agent: trade-venue-ws-probe/1\r\n"
        "\r\n"
    ).encode()

    try:
        with socket.create_connection(
            (venue.host, venue.port), timeout=HANDSHAKE_TIMEOUT_S
        ) as raw:
            with context.wrap_socket(raw, server_hostname=venue.host) as connection:
                connection.sendall(request)
                connection.settimeout(HANDSHAKE_TIMEOUT_S)
                head = b""

                while b"\r\n\r\n" not in head:
                    chunk = connection.recv(4096)
                    if not chunk:
                        break
                    head += chunk
                status = head.split(b"\r\n", 1)[0].decode(errors="replace")

                if b" 101 " not in head.split(b"\r\n", 1)[0] + b" ":
                    return "REFUSED", status

                if venue.subscribe:
                    connection.sendall(_text_frame(venue.subscribe))
                connection.settimeout(FRAME_TIMEOUT_S)

                for _ in range(8):
                    opcode, payload = _read_frame(connection)
                    if opcode == 0x9:  # ping
                        continue
                    if opcode in (0x1, 0x2) and payload:
                        text = payload.decode(errors="replace")
                        return "REACHABLE", f"{status} | first frame: {text[:160]}"
                return "REACHABLE", f"{status} | upgraded, no data frame in window"
    except (TimeoutError, socket.timeout) as error:
        return "TIMEOUT", f"{type(error).__name__}: {error}"
    except (OSError, ConnectionError, ssl.SSLError) as error:
        return "UNAVAILABLE", f"{type(error).__name__}: {error}"


def main() -> int:
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    lines = ["| Venue | Verdict | Detail |", "| --- | --- | --- |"]
    verdicts = []

    for venue in VENUES:
        verdict, detail = probe(venue)
        verdicts.append((venue.name, verdict))
        print(f"{venue.name}: {verdict} :: {detail}", flush=True)
        safe = detail.replace("|", "/")
        lines.append(f"| {venue.name} | {verdict} | {safe} |")

    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("\n".join(lines) + "\n")
    # The probe reports; it never fails the job, because an unreachable venue is
    # the measurement, not a defect in this repository.
    return 0


if __name__ == "__main__":
    sys.exit(main())
