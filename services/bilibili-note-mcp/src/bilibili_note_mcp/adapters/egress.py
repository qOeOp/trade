from __future__ import annotations

import asyncio
import ipaddress
import os
import socket
from collections.abc import Mapping
from typing import Any
from urllib.parse import urlsplit

import aiohttp
import httpx
from aiohttp.abc import AbstractResolver, ResolveResult

from bilibili_note_mcp.adapters.strict_json import StrictJsonError, decode_strict_json_object
from bilibili_note_mcp.application.errors import BilibiliNoteFailure

from .http_bodies import read_aiohttp_body, read_httpx_body

_JSON_BYTES = 2 * 1024 * 1024


class _PinnedResolver(AbstractResolver):
    def __init__(self, hostname: str, addresses: tuple[tuple[str, int], ...]) -> None:
        self._hostname = hostname
        self._addresses = addresses

    async def resolve(
        self, host: str, port: int = 0, family: socket.AddressFamily = socket.AF_UNSPEC
    ) -> list[ResolveResult]:
        if host != self._hostname:
            raise OSError("resolver_host_changed")
        return [
            ResolveResult(
                hostname=host,
                host=address,
                port=port,
                family=resolved_family,
                proto=0,
                flags=0,
            )
            for address, resolved_family in self._addresses
            if family in {socket.AF_UNSPEC, resolved_family}
        ]

    async def close(self) -> None:
        return None


async def _resolve_public(host: str, port: int) -> tuple[tuple[str, int], ...]:
    try:
        records = await asyncio.get_running_loop().getaddrinfo(
            host, port, type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP
        )
    except OSError as e:
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "egress_dns_failed") from e
    addresses: set[tuple[str, int]] = set()
    for family, _, _, _, sockaddr in records:
        address = str(sockaddr[0])
        try:
            parsed = ipaddress.ip_address(address)
        except ValueError as e:
            raise BilibiliNoteFailure("ACCESS_DENIED", "egress_address_invalid") from e
        if not parsed.is_global:
            raise BilibiliNoteFailure("ACCESS_DENIED", "egress_address_not_public")
        addresses.add((address, family))
    if not addresses:
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "egress_dns_empty")
    return tuple(sorted(addresses))


def _target(url: str) -> tuple[str, int]:
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError as e:
        raise BilibiliNoteFailure("ACCESS_DENIED", "egress_url_invalid") from e
    host = (parts.hostname or "").lower()
    if parts.scheme != "https":
        raise BilibiliNoteFailure("ACCESS_DENIED", "egress_scheme_denied")
    if port not in {None, 443}:
        raise BilibiliNoteFailure("ACCESS_DENIED", "egress_port_denied")
    if parts.username is not None or parts.password is not None:
        raise BilibiliNoteFailure("ACCESS_DENIED", "egress_credentials_denied")
    if host != "api.bilibili.com":
        raise BilibiliNoteFailure("ACCESS_DENIED", "egress_host_denied")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise BilibiliNoteFailure("ACCESS_DENIED", "egress_ip_literal_denied")
    return host, 443


def admitted_loopback_proxy(value: str | None) -> str | None:
    if not value:
        return None
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError as e:
        raise BilibiliNoteFailure("ACCESS_DENIED", "egress_proxy_invalid") from e
    if (
        parts.scheme != "http"
        or parts.hostname not in {"127.0.0.1", "::1"}
        or port is None
        or parts.username is not None
        or parts.password is not None
        or parts.path not in {"", "/"}
        or parts.query
        or parts.fragment
    ):
        raise BilibiliNoteFailure("ACCESS_DENIED", "egress_proxy_invalid")
    return value


class SafeHttpClient:
    def __init__(self, proxy_url: str | None = None) -> None:
        self._proxy = admitted_loopback_proxy(
            proxy_url if proxy_url is not None else os.environ.get("BILIBILI_NOTE_EGRESS_PROXY")
        )

    async def _session(self, url: str) -> aiohttp.ClientSession:
        host, port = _target(url)
        if self._proxy is None:
            addresses = await _resolve_public(host, port)
            connector = aiohttp.TCPConnector(
                resolver=_PinnedResolver(host, addresses),
                use_dns_cache=False,
                limit=2,
                ssl=True,
            )
        else:
            connector = aiohttp.TCPConnector(use_dns_cache=False, limit=2, ssl=True)
        timeout = aiohttp.ClientTimeout(total=30, connect=15)
        return aiohttp.ClientSession(
            connector=connector,
            timeout=timeout,
            trust_env=False,
            auto_decompress=False,
            headers={"Accept-Encoding": "identity"},
        )

    async def get_json(
        self, url: str, *, headers: Mapping[str, str] | None = None
    ) -> dict[str, Any]:
        _target(url)
        if self._proxy is not None:
            return await self._proxy_json(url, headers=headers)
        try:
            async with await self._session(url) as session:
                async with session.get(
                    url,
                    headers=headers,
                    allow_redirects=False,
                    proxy=self._proxy,
                ) as response:
                    self._check_status(response.status)
                    payload = await read_aiohttp_body(
                        response,
                        limit_bytes=_JSON_BYTES,
                        code="SOURCE_UNAVAILABLE",
                        reason="metadata_too_large",
                    )
        except BilibiliNoteFailure:
            raise
        except (aiohttp.ClientError, TimeoutError, OSError) as e:
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "egress_request_failed") from e
        try:
            value = decode_strict_json_object(payload)
        except (UnicodeDecodeError, StrictJsonError) as e:
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "metadata_json_invalid") from e
        if not isinstance(value, dict):
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "metadata_shape_invalid")
        return value

    async def _proxy_json(self, url: str, *, headers: Mapping[str, str] | None) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(
                proxy=self._proxy,
                http2=True,
                trust_env=False,
                follow_redirects=False,
                timeout=30,
                headers={"Accept-Encoding": "identity"},
            ) as client:
                async with client.stream("GET", url, headers=headers) as response:
                    self._check_status(response.status_code)
                    payload = await read_httpx_body(
                        response,
                        limit_bytes=_JSON_BYTES,
                        code="SOURCE_UNAVAILABLE",
                        reason="metadata_too_large",
                    )
                value = decode_strict_json_object(payload)
        except BilibiliNoteFailure:
            raise
        except (httpx.HTTPError, UnicodeDecodeError, StrictJsonError) as e:
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "metadata_json_invalid") from e
        if not isinstance(value, dict):
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "metadata_shape_invalid")
        return value

    @staticmethod
    def _check_status(status: int) -> None:
        if status == 429:
            raise BilibiliNoteFailure("RATE_LIMITED", "source_rate_limited")
        if status in {401, 403, 412, 451}:
            raise BilibiliNoteFailure("ACCESS_DENIED", "source_access_denied")
        if status < 200 or status >= 300:
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "source_http_failed")
