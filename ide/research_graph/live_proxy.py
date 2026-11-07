"""The Live-only proxy boundary: trusted router TCP peer, browser CSRF, then a private UDS.

The router's Docker network/name are trusted deployment configuration. Browser headers
are not service identity; an untrusted backend peer cannot acquire this authority by
copying a page nonce. This module neither reads venue credentials nor retries a command.
"""

from __future__ import annotations

import http.client
import ipaddress
import json
from pathlib import Path
import secrets
import socket
from typing import Any
from urllib.parse import urlsplit


PREFIX = "/api/live"
MAX_BODY = 64 * 1024
MAX_RESPONSE = 4 * 1024 * 1024


def matches(path: str) -> bool:
    route = urlsplit(path).path
    return route == PREFIX or route.startswith(PREFIX + "/")


def _address(value: str):
    address = ipaddress.ip_address(value)
    return address.ipv4_mapped or address if isinstance(address, ipaddress.IPv6Address) else address


def router_peer(peer: str, router: str) -> bool:
    """Resolve on every call; a stale or failed lookup cannot keep an old peer authorized."""
    try:
        addresses = {_address(str(result[4][0])) for result in
                     socket.getaddrinfo(router, None, type=socket.SOCK_STREAM)}
        return bool(addresses) and _address(peer) in addresses
    except (OSError, ValueError):
        return False


class UnixConnection(http.client.HTTPConnection):
    def __init__(self, path: Path):
        super().__init__("live-control", timeout=900)
        self.path = path

    def connect(self) -> None:
        connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            connection.settimeout(self.timeout)
            connection.connect(str(self.path))
        except BaseException:
            connection.close()
            raise
        self.sock = connection


def forward(handler: Any, path: Path | None, router: str | None, token: str, token_header: str) -> None:
    def refuse(status: int, code: str, message: str, *, renew: bool = False) -> None:
        handler.refuse(status, {"ok": False, "error": {"code": code, "message": message}}, renew)

    if path is None or router is None:
        refuse(503, "LIVE_UNAVAILABLE", "Live is not configured for this IDE.")
        return
    # Check before even issuing a nonce renewal. Host, Fetch and forwarded address headers
    # are intentionally irrelevant to this service-to-service boundary.
    if not router_peer(handler.client_address[0], router):
        refuse(403, "LIVE_ACCESS", "Live requests must pass through the configured login proxy.")
        return
    if handler.command not in {"GET", "POST"}:
        refuse(405, "LIVE_METHOD", "Live accepts only GET and POST.")
        return
    if handler.command == "POST" and (
            handler.headers.get("Sec-Fetch-Site") != "same-origin"
            or not secrets.compare_digest(handler.headers.get(token_header, "").encode(), token.encode())):
        refuse(403, "FORBIDDEN", "Live actions must come from this page.",
               renew=handler.headers.get("Sec-Fetch-Site") == "same-origin")
        return
    lengths = handler.headers.get_all("Content-Length", [])
    try:
        if handler.headers.get("Transfer-Encoding") or len(lengths) > 1:
            raise ValueError
        if lengths and (not lengths[0].isascii() or not lengths[0].isdigit()):
            raise ValueError
        length = int(lengths[0]) if lengths else 0
        if handler.command == "GET" and length:
            raise ValueError
    except ValueError:
        refuse(400, "LIVE_REQUEST", "Live requires one explicit, valid content length.")
        return
    if length > MAX_BODY:
        refuse(413, "LIVE_REQUEST", "The Live request is too large.")
        return
    if handler.command == "POST" and not lengths:
        refuse(411, "LIVE_REQUEST", "A Live action requires a content length.")
        return
    body = handler.rfile.read(length) if length else None
    if body is not None and len(body) != length:
        refuse(400, "LIVE_REQUEST", "The Live request body is incomplete.")
        return
    upstream = UnixConnection(path)
    try:
        upstream.request(handler.command, handler.path, body=body,
                         headers={"Host": "live-control", "Content-Type": "application/json"})
        response = upstream.getresponse()
        data = response.read(MAX_RESPONSE + 1)
        if len(data) > MAX_RESPONSE:
            raise ValueError
        value = json.loads(data)
        if not isinstance(value, dict) or type(value.get("ok")) is not bool:
            raise ValueError
        status = response.status
    except (OSError, ValueError, http.client.HTTPException):
        # The request may already have been accepted. No exception text, request body,
        # response text or UDS path reaches the browser; it must query its request ID.
        refuse(502, "LIVE_RESPONSE_UNKNOWN", "Live did not return a confirmed response. Check the original request.")
        return
    finally:
        upstream.close()
    handler.json(status, value)
