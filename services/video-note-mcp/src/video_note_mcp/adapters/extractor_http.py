"""Bounded responses and public-address transport for isolated extractors."""

from __future__ import annotations

import ipaddress
from typing import Any
from urllib.parse import urlsplit


def bounded_response(response: Any, remaining: int) -> Any:
    original_read = response.read

    def read(amount: int | None = None) -> bytes:
        nonlocal remaining
        count = remaining + 1 if amount is None or amount < 0 else min(amount, remaining + 1)
        data: bytes = original_read(count)
        if len(data) > remaining:
            response.close()
            raise ValueError("youtube_response_too_large")
        remaining -= len(data)
        return data

    response.read = read
    return response


def refuse_redirect(*args: Any, **kwargs: Any) -> Any:
    raise ValueError("youtube_redirect_denied")


def public_resolver(original: Any, proxy: str | None) -> Any:
    proxy_parts = urlsplit(proxy) if proxy else None

    def resolve(host: Any, port: Any, *args: Any, **kwargs: Any) -> Any:
        records = original(host, port, *args, **kwargs)
        if proxy_parts and host == proxy_parts.hostname and int(port) == proxy_parts.port:
            return records
        if not records or any(not ipaddress.ip_address(r[4][0]).is_global for r in records):
            raise OSError("youtube_nonpublic_address")
        return records

    return resolve
