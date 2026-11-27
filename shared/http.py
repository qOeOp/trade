"""What the product's small HTTP services share: one JSON reply and one trust check. Each service passes its own
policy (the Host names it answers, the Sec-Fetch-Site values it refuses)."""

from __future__ import annotations

from collections.abc import Collection
from http.server import BaseHTTPRequestHandler
import json


def encode(value) -> bytes:
    return json.dumps(value, default=str, ensure_ascii=False).encode()


def send_json(handler: BaseHTTPRequestHandler, status: int, body: bytes, *, close: bool = False) -> None:
    """Answer with JSON `body` that no cache keeps; `close` ends the connection after it."""
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("X-Content-Type-Options", "nosniff")
    if close:
        handler.send_header("Connection", "close")
        handler.close_connection = True
    handler.end_headers()
    handler.wfile.write(body)


def body_length(handler: BaseHTTPRequestHandler) -> int:
    """The request's Content-Length, 0 when it has none; ValueError unless it is at most 18 plain ASCII digits (int()
    alone takes "-1", "+1" and "1_0", and a negative length reads to the end of the connection)."""
    declared = (handler.headers.get("Content-Length") or "").strip() or "0"
    if not declared.isascii() or not declared.isdigit() or len(declared) > 18:
        raise ValueError(f"content length {declared!r} is not a whole number of bytes")
    return int(declared)


def trusted(handler: BaseHTTPRequestHandler, hosts: Collection[str], refused_sites: Collection[str] = ()) -> bool:
    """Whether the request names one of `hosts` and its browser did not send it from a refused site."""
    return handler.headers.get("Host") in hosts and handler.headers.get("Sec-Fetch-Site") not in refused_sites
