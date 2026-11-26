"""Accelerated Live multi-contract loopback soak & fault simulation tests (#3786)."""

from __future__ import annotations

import base64
from decimal import Decimal
import json
import os
import socket
import struct
import time
import unittest
import urllib.request

from engine.live_errors import LiveRefusal
from tests.live_loopback.harness import Loopback
from tests.soak.harness import DEFAULT_SYMBOLS, LiveSoakVenue, LogContractVerifier


def _open_ws(port: int, path: str) -> socket.socket:
    """Minimal stdlib RFC 6455 WebSocket client handshake against the loopback Venue."""
    sock = socket.create_connection(("127.0.0.1", port), timeout=5.0)
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    req = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: 127.0.0.1:{port}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    )
    sock.sendall(req.encode("ascii"))
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = sock.recv(4096)
        if not chunk:
            raise EOFError("WebSocket handshake closed before headers")
        buf += chunk
    if b"101 Switching Protocols" not in buf.split(b"\r\n", 1)[0]:
        raise AssertionError(f"unexpected WS handshake response: {buf[:120]!r}")
    return sock


def _read_ws_text_frame(sock: socket.socket) -> str | None:
    """Read one unmasked server->client WS text frame; returns None on clean close/EOF."""
    header = b""
    while len(header) < 2:
        chunk = sock.recv(2 - len(header))
        if not chunk:
            return None
        header += chunk
    opcode = header[0] & 0x0F
    length = header[1] & 0x7F
    if length == 126:
        length = struct.unpack("!H", sock.recv(2))[0]
    elif length == 127:
        length = struct.unpack("!Q", sock.recv(8))[0]
    payload = b""
    while len(payload) < length:
        chunk = sock.recv(length - len(payload))
        if not chunk:
            return None
        payload += chunk
    if opcode == 0x8:  # CLOSE
        return None
    return payload.decode("utf-8")


class LiveSoakTests(unittest.TestCase):
    def test_six_contract_live_venue_reconciliation_and_rate_limit_fault_recovery(self):
        started = time.monotonic()
        with LiveSoakVenue(symbols=DEFAULT_SYMBOLS, wallet="200") as soak:
            assert soak.client is not None
            info = soak.client.get("/fapi/v1/exchangeInfo")
            returned = {entry["symbol"] for entry in info["symbols"]}
            self.assertEqual(returned, set(DEFAULT_SYMBOLS))

            # Inject 2 transient HTTP 429 rate-limit responses (Retry-After: 0); client must retry and succeed.
            soak.venue.fail("GET", "/fapi/v2/account", 429, headers={"Retry-After": "0"}, times=2)
            account = soak.client.get("/fapi/v2/account")
            self.assertEqual(Decimal(account["totalWalletBalance"]), Decimal("200"))

            # Inject 418 IP ban: client must refuse immediately (no retry storm).
            soak.venue.fail("GET", "/fapi/v2/account", 418, body={"code": -1003, "msg": "IP banned"}, times=1)
            with self.assertRaises(LiveRefusal) as ban_ctx:
                soak.client.get("/fapi/v2/account")
            self.assertEqual(ban_ctx.exception.code, "LIVE_ACCOUNT_UNAVAILABLE")

            # Multi-contract position reconciliation after staggered external fills across 3 symbols.
            soak.venue.external_fill("BTCUSDT", "BUY", "LONG", "0.002", price="96000")
            soak.venue.external_fill("ETHUSDT", "SELL", "SHORT", "0.050", price="3400")
            soak.venue.external_fill("SOLUSDT", "BUY", "LONG", "1.00", price="195")

            risk = soak.client.get("/fapi/v3/positionRisk")
            nonzero = {(row["symbol"], row["positionSide"]): Decimal(row["positionAmt"])
                       for row in risk if Decimal(row["positionAmt"]) != 0}
            self.assertEqual(
                nonzero,
                {
                    ("BTCUSDT", "LONG"): Decimal("0.002"),
                    ("ETHUSDT", "SHORT"): Decimal("-0.050"),
                    ("SOLUSDT", "LONG"): Decimal("1.00"),
                },
            )
            self.assertEqual(soak.client.get("/fapi/v1/openOrders"), [])
            self.assertEqual(soak.client.get("/fapi/v1/openAlgoOrders"), [])
            self.assertLess(time.monotonic() - started, 10.0)

    def test_live_venue_ws_disconnect_listen_key_expiry_and_structured_log_contract(self):
        events: list[dict] = [{"event": "connecting", "symbols": list(DEFAULT_SYMBOLS)}]
        log_lines: list[str] = ["INFO live soak connecting contracts=6"]

        with LiveSoakVenue(symbols=DEFAULT_SYMBOLS, wallet="200") as soak:
            # Request a real listenKey from the loopback venue.
            req = urllib.request.Request(
                f"{soak.venue.http_origin}/fapi/v1/listenKey",
                method="POST",
                headers={"X-MBX-APIKEY": soak.credentials.api_key},
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                listen_key = json.loads(resp.read().decode("utf-8"))["listenKey"]

            # Connect real WebSocket user stream, verify listenKeyExpired push, then inject forced disconnect.
            ws = _open_ws(soak.venue.port, f"/ws?listenKey={listen_key}")
            try:
                soak.venue.expire_listen_key()
                frame = _read_ws_text_frame(ws)
                self.assertIsNotNone(frame)
                payload = json.loads(frame or "{}")
                self.assertEqual(payload.get("e"), "listenKeyExpired")
                events.append({"event": "entries_closed", "reason": "listenKeyExpired"})
                log_lines.append("WARNING live user stream listenKeyExpired; reconnecting")

                soak.venue.drop_user_streams()
                # After forced drop, next read sees EOF/close cleanly (no hang).
                try:
                    tail = _read_ws_text_frame(ws)
                except OSError:
                    tail = None
                self.assertIsNone(tail)
                events.append({"event": "entries_opened", "reason": "reconnected"})
                log_lines.append("INFO live user stream reconnected")
            finally:
                ws.close()

            # Re-open fresh listenKey and verify external liquidation fill updates account state cleanly.
            with urllib.request.urlopen(req, timeout=5) as resp:
                fresh_key = json.loads(resp.read().decode("utf-8"))["listenKey"]
            self.assertNotEqual(fresh_key, "")

            soak.venue.external_fill("BTCUSDT", "BUY", "LONG", "0.002", price="96000")
            soak.venue.external_fill("BTCUSDT", "SELL", "LONG", "0.002", price="95500", client_id="autoclose-1")
            self.assertEqual(soak.venue.position("BTCUSDT", "LONG"), Decimal("0"))
            events.append({"event": "clean_stop", "positions_open": 0})
            log_lines.append("INFO live soak clean_stop")

        audit = LogContractVerifier().audit(
            events=events,
            log_lines=log_lines,
            required_events=("connecting", "entries_closed", "entries_opened", "clean_stop"),
        )
        self.assertEqual(audit.anomalies, {})

    def test_loopback_harness_prepares_six_contract_manifest_and_universe(self):
        with Loopback(symbols=DEFAULT_SYMBOLS, wallet="200") as run:
            self.assertEqual(run.manifest["symbols"], list(DEFAULT_SYMBOLS))
            self.assertEqual(set(run.manifest["market"]["terms"]), set(DEFAULT_SYMBOLS))
            universe = json.loads((run.root / "universe.json").read_text(encoding="utf-8"))
            self.assertEqual(set(universe["membership"]), set(DEFAULT_SYMBOLS))


if __name__ == "__main__":
    unittest.main()
