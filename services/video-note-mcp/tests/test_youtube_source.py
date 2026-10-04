from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from video_note_mcp.adapters._youtube_worker import (
    admit_url,
    metadata,
    public_resolver,
    refuse_redirect,
)
from video_note_mcp.adapters.source_acquisition import SourceAcquisition
from video_note_mcp.adapters.video_source import VideoSource
from video_note_mcp.adapters.youtube_source import (
    YoutubeExtractor,
    source_metadata,
)
from video_note_mcp.application.errors import BilibiliNoteFailure
from video_note_mcp.application.progress import NullProgressReporter
from video_note_mcp.domain.url_policy import InvalidBilibiliUrl
from video_note_mcp.domain.video_url import validate_video_url
from video_note_mcp.domain.youtube_url import validate_youtube_url

URL = "https://www.youtube.com/watch?v=EtIAqiguRHs"
META = {
    "id": "EtIAqiguRHs",
    "title": "A visual explanation",
    "author": "Creator",
    "date": "20261002",
    "duration_ms": 304000,
    "width": 1280,
    "height": 720,
    "format_id": "398+251",
}


@pytest.mark.parametrize(
    "url",
    [
        URL,
        "https://youtu.be/EtIAqiguRHs?si=abc&t=1m2s",
        "https://m.youtube.com/watch?v=EtIAqiguRHs&start=12",
        "https://www.youtube.com/shorts/EtIAqiguRHs",
    ],
)
def test_youtube_links_normalize_to_same_video(url):
    assert validate_video_url(url).canonical_url(1) == URL


@pytest.mark.parametrize(
    "url",
    [
        "http://www.youtube.com/watch?v=EtIAqiguRHs",
        "https://youtube.com.evil/watch?v=EtIAqiguRHs",
        "https://www.youtube.com@127.0.0.1/watch?v=EtIAqiguRHs",
        URL + "&list=PL123",
        URL + "&v=AAAAAAAAAAA",
        URL + "&%76=AAAAAAAAAAA",
        URL + "#redirect",
        "https://www.youtube.com/playlist?list=PL123",
        "https://www.youtube.com/@creator",
        "https://www.youtube.com/live/EtIAqiguRHs",
        "https://youtu.be/EtIAqiguRHs/other",
        "https://www.youtube.com/watch?v=short",
        URL + "&t=bad",
        URL + "\n",
    ],
)
def test_youtube_rejects_nonvideo_or_ambiguous_urls(url):
    with pytest.raises(InvalidBilibiliUrl):
        validate_youtube_url(url)


def test_identity_is_bound_to_platform_and_canonical_url():
    value = source_metadata(META, "https://youtu.be/EtIAqiguRHs")
    assert value.platform == "youtube" and value.canonical_url == URL
    with pytest.raises(BilibiliNoteFailure):
        source_metadata({**META, "id": "AAAAAAAAAAA"}, URL)


@pytest.mark.parametrize(
    "url",
    [
        "https://evil.example/video",
        "http://www.youtube.com/",
        "https://googlevideo.com.evil/",
        "https://127.0.0.1/",
        "https://www.youtube.com:444/",
    ],
)
def test_worker_egress_rejects_unrelated_or_local_targets(url):
    with pytest.raises(ValueError):
        admit_url(url)


def test_public_dns_and_redirect_boundaries():
    admit_url("https://rr1---sn-example.googlevideo.com/videoplayback")
    records = [(2, 1, 6, "", ("127.0.0.1", 443))]
    with pytest.raises(OSError):
        public_resolver(lambda *a: records, None)("www.youtube.com", 443)
    assert (
        public_resolver(lambda *a: records, "http://127.0.0.1:1082")("127.0.0.1", 1082) == records
    )
    with pytest.raises(ValueError):
        refuse_redirect(None)


@pytest.mark.parametrize(
    "change",
    [
        {"_type": "playlist"},
        {"is_live": True},
        {"live_status": "is_upcoming"},
        {"duration": float("nan")},
        {"duration": True},
        {"id": "AAAAAAAAAAA"},
    ],
)
def test_worker_rejects_wrong_identity_live_and_unbounded_duration(change):
    info = {
        "id": "EtIAqiguRHs",
        "title": "Title",
        "uploader": "Creator",
        "duration": 304,
        "width": 1280,
        "height": 720,
        "upload_date": "20261002",
        **change,
    }
    with pytest.raises(ValueError):
        metadata(info, "EtIAqiguRHs")


async def test_source_router_keeps_platforms_separate(tmp_path):
    bili, youtube = AsyncMock(), AsyncMock()
    router = VideoSource(bili, youtube)
    await router.acquire(URL, tmp_path, NullProgressReporter())
    youtube.acquire.assert_awaited_once()
    bili.acquire.assert_not_called()


@pytest.mark.parametrize("delta", [-10000, 10000])
async def test_shared_acquisition_rejects_incomplete_or_changed_media_before_asr(tmp_path, delta):
    from video_note_mcp.domain.artifacts import SourceMediaArtifact

    media, transcript = AsyncMock(), AsyncMock()
    media.download.return_value = SourceMediaArtifact(
        media_path=tmp_path / "source.mp4",
        media_sha256="a" * 64,
        observed_duration_ms=304000 + delta,
        width=1280,
        height=720,
        upstream_video_id="EtIAqiguRHs",
        upstream_part_index=1,
        format_id="398+251",
        adapter_ref="test",
    )
    with pytest.raises(BilibiliNoteFailure):
        await SourceAcquisition(transcript, media).acquire(
            source_metadata(META, URL), 1280, 720, {}, tmp_path, NullProgressReporter()
        )
    transcript.transcribe.assert_not_called()


async def test_worker_rejects_unknown_receipt_fields(monkeypatch):
    import json

    from video_note_mcp.adapters import youtube_source

    monkeypatch.setattr(
        youtube_source,
        "run_media_worker",
        AsyncMock(
            return_value=(
                0,
                json.dumps(
                    {
                        "schema": "video-note-youtube-worker/v1",
                        "ok": True,
                        "metadata": META,
                        "unexpected": "value",
                    }
                ).encode(),
            )
        ),
    )
    with pytest.raises(BilibiliNoteFailure):
        await YoutubeExtractor().request("metadata", URL)


def test_metadata_body_limit_is_applied_before_unbounded_read():
    import io
    from types import SimpleNamespace

    from video_note_mcp.adapters._youtube_worker import bounded_response

    body = io.BytesIO(b"x" * 100)
    response = SimpleNamespace(read=body.read, close=body.close)
    bounded_response(response, 10)
    with pytest.raises(ValueError, match="response_too_large"):
        response.read()
    assert body.closed
