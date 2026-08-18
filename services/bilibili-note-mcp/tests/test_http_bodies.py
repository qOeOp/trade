from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

import httpx
import pytest

from bilibili_note_mcp.adapters import egress
from bilibili_note_mcp.adapters.egress import SafeHttpClient
from bilibili_note_mcp.adapters.http_bodies import (
    ContentLengthError,
    parse_content_length_values,
    read_aiohttp_body,
    read_httpx_body,
)
from bilibili_note_mcp.application.errors import BilibiliNoteFailure


def test_content_length_parser_is_single_bounded_ascii_decimal_authority() -> None:
    assert parse_content_length_values([], limit_bytes=100) is None
    assert parse_content_length_values(["0"], limit_bytes=100) == 0
    assert parse_content_length_values(["100"], limit_bytes=100) == 100
    for values in (
        [""],
        ["1", "1"],
        ["+1"],
        ["-1"],
        ["1_0"],
        ["1.0"],
        ["\uff11"],
        ["101"],
        ["1" + "0" * 100],
    ):
        with pytest.raises(ContentLengthError):
            parse_content_length_values(values, limit_bytes=100)


@pytest.mark.parametrize(
    "values",
    (
        [""],
        ["1", "1"],
        ["+1"],
        ["-1"],
        ["1_0"],
        ["\uff11"],
        ["9"],
        ["1" + "0" * 100],
    ),
)
async def test_raw_http_consumers_reject_bad_content_length_before_body_read(
    values: list[str],
) -> None:
    reads = 0

    class HttpxHeaders:
        def get_list(self, name: str) -> list[str]:
            assert name == "Content-Length"
            return values

    class HttpxResponse:
        headers = HttpxHeaders()

        async def aiter_bytes(self):  # type: ignore[no-untyped-def]
            nonlocal reads
            reads += 1
            yield b"private"

    class AiohttpHeaders:
        def getall(self, name: str, default: list[str]) -> list[str]:
            assert name == "Content-Length"
            assert default == []
            return values

    class AiohttpContent:
        async def iter_chunked(self, size: int):  # type: ignore[no-untyped-def]
            nonlocal reads
            assert size == 64 * 1024
            reads += 1
            yield b"private"

    class AiohttpResponse:
        headers = AiohttpHeaders()
        content = AiohttpContent()

    for reader, response in (
        (read_httpx_body, HttpxResponse()),
        (read_aiohttp_body, AiohttpResponse()),
    ):
        with pytest.raises(BilibiliNoteFailure) as failure:
            await reader(  # type: ignore[arg-type]
                response,
                limit_bytes=8,
                code="SOURCE_UNAVAILABLE",
                reason="body_contract_denied",
            )
        assert failure.value.reason == "body_contract_denied"

    assert reads == 0


async def test_proxy_metadata_stream_stops_at_cap_plus_one_before_buffering_full_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(egress, "_JSON_BYTES", 8)
    yielded = 0
    stream_calls = 0

    class Response:
        status_code = 200
        headers = httpx.Headers()

        async def aiter_bytes(self):  # type: ignore[no-untyped-def]
            nonlocal yielded
            yielded += 1
            yield b"x" * 128
            yielded += 1
            yield b"unreachable"

    class Client:
        async def __aenter__(self) -> Client:
            return self

        async def __aexit__(self, *args: object) -> None:
            return None

        @asynccontextmanager
        async def stream(self, method: str, url: str, **kwargs: object):  # type: ignore[no-untyped-def]
            nonlocal stream_calls
            del kwargs
            assert method == "GET"
            assert url.startswith("https://api.bilibili.com/")
            stream_calls += 1
            yield Response()

    def client_factory(**kwargs: Any) -> Client:
        assert kwargs["proxy"] == "http://127.0.0.1:1082"
        return Client()

    monkeypatch.setattr(egress.httpx, "AsyncClient", client_factory)

    with pytest.raises(BilibiliNoteFailure) as failure:
        await SafeHttpClient("http://127.0.0.1:1082").get_json(
            "https://api.bilibili.com/x/web-interface/view?bvid=BV1uHuQ6pEFr"
        )

    assert failure.value.reason == "metadata_too_large"
    assert stream_calls == 1
    assert yielded == 1
