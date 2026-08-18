from __future__ import annotations

import re
from collections.abc import AsyncIterator, Sequence

import aiohttp
import httpx

from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.domain.models import FailureCode


class ContentLengthError(ValueError):
    """A Content-Length field is ambiguous, malformed, or outside the body bound."""

    def __init__(self, kind: str) -> None:
        super().__init__(kind)
        self.kind = kind


_ASCII_DECIMAL = re.compile(r"[0-9]+")


def parse_content_length_values(
    values: Sequence[str],
    *,
    limit_bytes: int,
) -> int | None:
    """Parse at most one bounded, nonempty ASCII-decimal Content-Length field."""
    if limit_bytes < 0:
        raise ValueError("body limit is invalid")
    if not values:
        return None
    if len(values) != 1:
        raise ContentLengthError("duplicate")
    raw = values[0]
    if not raw or len(raw) > len(str(limit_bytes)) or _ASCII_DECIMAL.fullmatch(raw) is None:
        raise ContentLengthError("invalid")
    parsed = int(raw)
    if parsed > limit_bytes:
        raise ContentLengthError("overflow")
    return parsed


async def _bounded_body(
    chunks: AsyncIterator[bytes],
    *,
    limit_bytes: int,
    code: FailureCode,
    reason: str,
) -> bytes:
    if limit_bytes < 0:
        raise ValueError("body limit is invalid")
    body = bytearray()
    async for chunk in chunks:
        remaining = limit_bytes + 1 - len(body)
        body.extend(chunk[:remaining])
        if len(body) > limit_bytes or len(chunk) > remaining:
            raise BilibiliNoteFailure(code, reason)
    return bytes(body)


async def read_httpx_body(
    response: httpx.Response,
    *,
    limit_bytes: int,
    code: FailureCode,
    reason: str,
) -> bytes:
    try:
        parse_content_length_values(
            response.headers.get_list("Content-Length"),
            limit_bytes=limit_bytes,
        )
    except ContentLengthError as e:
        raise BilibiliNoteFailure(code, reason) from e
    return await _bounded_body(
        response.aiter_bytes(), limit_bytes=limit_bytes, code=code, reason=reason
    )


async def read_aiohttp_body(
    response: aiohttp.ClientResponse,
    *,
    limit_bytes: int,
    code: FailureCode,
    reason: str,
) -> bytes:
    try:
        parse_content_length_values(
            response.headers.getall("Content-Length", []),
            limit_bytes=limit_bytes,
        )
    except ContentLengthError as e:
        raise BilibiliNoteFailure(code, reason) from e
    return await _bounded_body(
        response.content.iter_chunked(64 * 1024),
        limit_bytes=limit_bytes,
        code=code,
        reason=reason,
    )
