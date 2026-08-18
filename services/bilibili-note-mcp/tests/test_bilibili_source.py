from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest

from bilibili_note_mcp.adapters.bilibili_http import BILIBILI_BROWSER_USER_AGENT
from bilibili_note_mcp.adapters.bilibili_source import BilibiliSource
from bilibili_note_mcp.adapters.egress import SafeHttpClient, _target
from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.application.ports import (
    SourceMediaArtifact,
    TranscriptResult,
    TranscriptSegment,
)
from bilibili_note_mcp.application.progress import NullProgressReporter

USER_URL = "https://www.bilibili.com/video/BV1uHuQ6pEFr/?spm_id_from=333.337.search-card.all.click"


class FakeTranscript:
    def __init__(self) -> None:
        self.calls = 0

    async def transcribe(
        self, media_path: Path, duration_ms: int, workspace: Path, progress: object
    ) -> TranscriptResult:
        self.calls += 1
        assert await asyncio.to_thread(media_path.read_bytes) == b"media"
        return TranscriptResult(
            method="asr",
            provider_ref="siliconflow:test-asr",
            language="zh-CN",
            segments=(TranscriptSegment("E001", 0, duration_ms, "完整转写"),),
        )


class FakeHttp:
    def __init__(self, bvid: str = "BV1uHuQ6pEFr", duration_seconds: int = 481) -> None:
        self.urls: list[str] = []
        self.bvid = bvid
        self.duration_seconds = duration_seconds

    async def get_json(self, url: str, *, headers: dict[str, str] | None = None) -> dict[str, Any]:
        self.urls.append(url)
        assert headers is not None and "spm_id_from" not in headers["Referer"]
        assert headers["User-Agent"] == BILIBILI_BROWSER_USER_AGENT
        if "web-interface/view" in url:
            return {
                "code": 0,
                "data": {
                    "bvid": self.bvid,
                    "title": "策略研究视频",
                    "pubdate": 1_786_320_000,
                    "owner": {"name": "研究作者"},
                    "pages": [
                        {
                            "cid": 40_765_885_910,
                            "page": 1,
                            "part": "main",
                            "duration": self.duration_seconds,
                            "dimension": {"width": 2560, "height": 1440},
                        }
                    ],
                },
            }
        raise AssertionError(f"unexpected URL: {url}")


def _metadata_payload() -> dict[str, Any]:
    return {
        "code": 0,
        "data": {
            "bvid": "BV1uHuQ6pEFr",
            "title": "策略研究视频",
            "pubdate": 1_786_320_000,
            "owner": {"name": "研究作者"},
            "pages": [
                {
                    "cid": 40_765_885_910,
                    "page": 1,
                    "part": "main",
                    "duration": 481,
                    "dimension": {"width": 2560, "height": 1440},
                }
            ],
        },
    }


class PayloadHttp:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload

    async def get_json(self, url: str, *, headers: dict[str, str] | None = None) -> dict[str, Any]:
        del url, headers
        return self.payload


class FakeMedia:
    def __init__(
        self,
        *,
        duration_ms: int = 481_000,
        video_id: str = "BV1uHuQ6pEFr",
        part_index: int = 1,
    ) -> None:
        self.duration_ms = duration_ms
        self.video_id = video_id
        self.part_index = part_index
        self.urls: list[str] = []

    async def download(self, canonical_url: str, workspace: Path) -> SourceMediaArtifact:
        self.urls.append(canonical_url)
        media_path = workspace / "source.mp4"
        await asyncio.to_thread(media_path.write_bytes, b"media")
        return SourceMediaArtifact(
            media_path=media_path,
            media_sha256="hash",
            observed_duration_ms=self.duration_ms,
            width=1280,
            height=720,
            upstream_video_id=self.video_id,
            upstream_part_index=self.part_index,
            format_id="64",
            adapter_ref="yt-dlp/test",
        )


async def test_public_api_source_preserves_request_and_freezes_canonical_part(
    tmp_path: Path,
) -> None:
    http = FakeHttp()
    media = FakeMedia()
    source = await BilibiliSource(FakeTranscript(), media=media, http=http).acquire(  # type: ignore[arg-type]
        USER_URL, tmp_path, NullProgressReporter()
    )

    assert source.source.requested_url == USER_URL
    assert source.source.canonical_url == "https://www.bilibili.com/video/BV1uHuQ6pEFr?p=1"
    assert source.source.part_id == "40765885910"
    assert source.source.duration_ms == 481_000
    assert source.source_snapshot_ref.startswith("bs_")
    assert all("spm_id_from" not in url for url in http.urls)
    assert media.urls == ["https://www.bilibili.com/video/BV1uHuQ6pEFr?p=1"]


@pytest.mark.parametrize(
    "url",
    [
        "https://127.0.0.1/file",
        "https://x.bilivideo.com.evil.example/file",
        "https://api.bilibili.com.evil.example/data",
        "http://api.bilibili.com/data",
    ],
)
def test_metadata_egress_target_policy_rejects_ssrf_shapes(url: str) -> None:
    with pytest.raises(BilibiliNoteFailure, match="egress"):
        _target(url)


def test_only_explicit_loopback_http_proxy_is_admitted() -> None:
    SafeHttpClient(proxy_url="http://127.0.0.1:1082")
    with pytest.raises(BilibiliNoteFailure, match="egress_proxy_invalid"):
        SafeHttpClient(proxy_url="http://proxy.example:1082")


async def test_source_metadata_identity_drift_fails_closed(tmp_path: Path) -> None:
    with pytest.raises(BilibiliNoteFailure) as failure:
        await BilibiliSource(
            FakeTranscript(), media=FakeMedia(), http=FakeHttp("BV1bK411W797")
        ).acquire(  # type: ignore[arg-type]
            USER_URL, tmp_path, NullProgressReporter()
        )
    assert failure.value.code == "SOURCE_CHANGED"
    assert failure.value.reason == "source_video_identity_changed"


@pytest.mark.parametrize(
    ("path", "value"),
    (
        (("code",), False),
        (("data", "bvid"), 123),
        (("data", "title"), 123),
        (("data", "pubdate"), "1786320000"),
        (("data", "owner", "name"), 456),
        (("data", "pages", 0, "page"), True),
        (("data", "pages", 0, "cid"), "40765885910"),
        (("data", "pages", 0, "duration"), "481"),
        (("data", "pages", 0, "dimension", "width"), "2560"),
        (("data", "pages", 0, "dimension", "height"), False),
        (("data", "pages", 0, "dimension", "width"), 8193),
        (("data", "pages", 0, "cid"), 1 << 63),
        (("data", "pubdate"), 253_402_300_800),
    ),
)
async def test_source_rejects_coercible_metadata_before_download(
    tmp_path: Path,
    path: tuple[str | int, ...],
    value: object,
) -> None:
    payload = _metadata_payload()
    cursor: object = payload
    for key in path[:-1]:
        cursor = cursor[key]  # type: ignore[index]
    cursor[path[-1]] = value  # type: ignore[index]
    transcript = FakeTranscript()
    media = FakeMedia()

    with pytest.raises(BilibiliNoteFailure) as failure:
        await BilibiliSource(
            transcript,
            media=media,
            http=PayloadHttp(payload),
        ).acquire(USER_URL, tmp_path, NullProgressReporter())  # type: ignore[arg-type]

    assert failure.value.code == "SOURCE_UNAVAILABLE"
    assert media.urls == []
    assert transcript.calls == 0


async def test_restricted_preview_is_rejected_before_asr(tmp_path: Path) -> None:
    transcript = FakeTranscript()
    with pytest.raises(BilibiliNoteFailure) as failure:
        await BilibiliSource(
            transcript,
            media=FakeMedia(duration_ms=300_000),
            http=FakeHttp(),
        ).acquire(USER_URL, tmp_path, NullProgressReporter())  # type: ignore[arg-type]
    assert failure.value.code == "SOURCE_UNAVAILABLE"
    assert failure.value.reason == "media_access_restricted_preview"
    assert transcript.calls == 0


async def test_unsupported_long_video_is_rejected_before_download_or_asr(
    tmp_path: Path,
) -> None:
    transcript = FakeTranscript()
    media = FakeMedia()
    with pytest.raises(BilibiliNoteFailure) as failure:
        await BilibiliSource(
            transcript,
            media=media,
            http=FakeHttp(duration_seconds=5_805),
        ).acquire(USER_URL, tmp_path, NullProgressReporter())  # type: ignore[arg-type]

    assert failure.value.code == "SOURCE_UNAVAILABLE"
    assert failure.value.reason == "source_duration_exceeds_supported_limit"
    assert media.urls == []
    assert transcript.calls == 0


@pytest.mark.parametrize(
    ("video_id", "part_index"),
    [("BV1bK411W797", 1), ("BV1uHuQ6pEFr", 2)],
)
async def test_downloaded_media_identity_drift_fails_closed(
    tmp_path: Path, video_id: str, part_index: int
) -> None:
    with pytest.raises(BilibiliNoteFailure) as failure:
        await BilibiliSource(
            FakeTranscript(),
            media=FakeMedia(video_id=video_id, part_index=part_index),
            http=FakeHttp(),
        ).acquire(USER_URL, tmp_path, NullProgressReporter())  # type: ignore[arg-type]
    assert failure.value.code == "SOURCE_CHANGED"
    assert failure.value.reason == "media_video_identity_changed"
