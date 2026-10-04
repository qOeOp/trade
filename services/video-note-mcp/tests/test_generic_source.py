from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest

from video_note_mcp.adapters._generic_worker import (
    PublicVideoDL,
    progressive_url,
    single_video,
)
from video_note_mcp.adapters.extractor_http import bounded_response, public_resolver
from video_note_mcp.adapters.generic_source import GenericSource
from video_note_mcp.adapters.video_source import VideoSource
from video_note_mcp.application.errors import BilibiliNoteFailure
from video_note_mcp.application.progress import NullProgressReporter
from video_note_mcp.domain.generic_url import validate_generic_url
from video_note_mcp.domain.models import SourceV1
from video_note_mcp.domain.video_url import validate_video_url

URL = "https://public.example.org/video/example"


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "http://public.example.org/a",
        "https://127.0.0.1/a",
        "https://[::1]/a",
        "https://localhost/a",
        "https://site.local/a",
        "https://public.example.org:444/a",
        "https://u:p@public.example.org/a",
        URL + "#fragment",
        URL + "\n",
        URL + "%0a",
        URL + "%zz",
        URL + "<tag>",
    ],
)
def test_generic_rejects_unsafe_urls(url):
    with pytest.raises(ValueError):
        validate_generic_url(url)


def test_generic_identity_and_existing_platform_grammars():
    parsed = validate_video_url(URL)
    assert parsed.video_id.startswith("web-")
    assert validate_generic_url(URL + ":443").video_id != parsed.video_id
    with pytest.raises(ValueError):
        validate_video_url("https://www.youtube.com/playlist?list=anything")
    with pytest.raises(ValueError):
        validate_video_url("https://www.bilibili.com/video/not-a-bvid")
    source = SourceV1(
        platform="generic",
        requested_url=URL,
        canonical_url=URL,
        video_id=parsed.video_id,
        part_id=parsed.video_id,
        part_index=1,
        title="Unknown source",
        author_name=None,
        published_at=None,
        duration_ms=1200,
    )
    with pytest.raises(ValueError):
        SourceV1.model_validate({**source.model_dump(), "canonical_url": URL + "/other"})
    with pytest.raises(ValueError):
        SourceV1.model_validate({**source.model_dump(), "platform": "youtube"})


@pytest.mark.parametrize("address", ["127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "fc00::1"])
def test_connection_resolution_rejects_private_or_mixed_answers(address):
    records = [(2, 1, 6, "", ("8.8.8.8", 443)), (2, 1, 6, "", (address, 443))]
    with pytest.raises(OSError):
        public_resolver(lambda *args: records, None)("public.example.org", 443)


def test_response_budget_enforced_even_without_content_length():
    from io import BytesIO

    stream = bounded_response(BytesIO(b"12345"), 4)
    assert stream.read(3) == b"123"
    with pytest.raises(ValueError):
        stream.read(3)
    assert stream.closed


@pytest.mark.parametrize(
    "info",
    [
        {"_type": "url", "url": URL},
        {"_type": "url_transparent", "url": URL},
        {"_type": "playlist", "entries": [{}, {}]},
        {"_type": "playlist", "entries": []},
        {"is_live": True},
        {"has_drm": True},
        {"live_status": "is_upcoming"},
    ],
)
def test_no_live_playlists_drm_or_extractor_handoff(info):
    with pytest.raises(ValueError):
        single_video(info)


@pytest.mark.parametrize(
    "info",
    [
        {"url": URL, "protocol": "m3u8_native"},
        {"url": URL, "protocol": "http_dash_segments"},
        {"url": "file:///tmp/a.mp4"},
        {"url": "https://127.0.0.1/x.mp4"},
        {"url": URL, "acodec": "none"},
        {"url": URL, "fragments": [{}]},
    ],
)
def test_only_progressive_public_muxed_urls(info):
    with pytest.raises(ValueError):
        progressive_url(info)


def test_single_embedded_video_wrapper():
    info = {"url": URL + "/movie.mp4", "protocol": "https"}
    assert progressive_url(single_video({"_type": "playlist", "entries": [info]})) == info["url"]


async def test_routing_never_falls_back_after_platform_failure(tmp_path):
    bili, youtube, generic = AsyncMock(), AsyncMock(), AsyncMock()
    router = VideoSource(bili, youtube, generic)
    youtube.acquire.side_effect = BilibiliNoteFailure("SOURCE_UNAVAILABLE", "unavailable")
    with pytest.raises(BilibiliNoteFailure):
        await router.acquire(
            "https://www.youtube.com/watch?v=EtIAqiguRHs", tmp_path, NullProgressReporter()
        )
    generic.acquire.assert_not_called()
    await router.acquire(URL, tmp_path, NullProgressReporter())
    generic.acquire.assert_awaited_once()


async def test_each_generic_request_transcribes_current_download(monkeypatch, tmp_path):
    from video_note_mcp.adapters import generic_source as module

    calls = 0

    async def worker(*args, **kwargs):
        nonlocal calls
        calls += 1
        (tmp_path / "source.mp4").write_bytes(
            b"\x00\x00\x00\x18ftypmp42" + f"new media {calls}".encode()
        )
        return 0, json.dumps(
            {
                "schema": module._SCHEMA,
                "ok": True,
                "url": URL,
                "title": "Video",
                "author": None,
                "date": None,
            }
        ).encode()

    monkeypatch.setattr(module, "run_media_worker", worker)
    monkeypatch.setattr(module, "probe_downloaded_media", AsyncMock(return_value=(1000, 1280, 720)))
    transcript = AsyncMock()
    source = GenericSource(transcript)
    a = await source.acquire(URL, tmp_path, NullProgressReporter())
    b = await source.acquire(URL, tmp_path, NullProgressReporter())
    assert a.source_snapshot_ref != b.source_snapshot_ref
    assert transcript.transcribe.await_count == 2
    monkeypatch.setattr(module, "probe_downloaded_media", AsyncMock(return_value=(1000, 640, 360)))
    with pytest.raises(BilibiliNoteFailure, match="source_below_hd_floor"):
        await source.acquire(URL, tmp_path, NullProgressReporter())
    assert transcript.transcribe.await_count == 2


def test_worker_denies_requests_before_transport():
    with PublicVideoDL({"proxy": "", "quiet": True}, auto_init=False) as dl:
        with pytest.raises(ValueError):
            dl.urlopen("http://public.example.org/video")
        dl.requests_left = 0
        with pytest.raises(ValueError, match="request_limit"):
            dl.urlopen(URL)


def test_generic_render_preserves_query_and_does_not_invent_seek(draft):
    from dataclasses import replace

    from video_note_mcp.presentation.markdown import render

    url = "https://public.example.org/a(b).mp4?token=example&value=1"
    parsed = validate_generic_url(url)
    data = draft.source.model_dump()
    data.update(
        platform="generic",
        requested_url=url,
        canonical_url=url,
        video_id=parsed.video_id,
        part_id=parsed.video_id,
        part_index=1,
        author_name=None,
        published_at=None,
    )
    generic = replace(draft, source=SourceV1.model_validate(data))
    paths = {(0, f.frame_id): f"images/{f.frame_id}.png" for f in draft.frames}
    html = render((generic,), paths, html_mode=True)
    markdown = render((generic,), paths)
    assert "作者未提供" in html and "日期未提供" in html
    assert "&t=" not in html and "&amp;t=" not in html
    assert "<" + url + ">" in markdown
    assert "不保证跳转" in html


async def test_manifest_disguised_as_file_cannot_probe_remote_stream(tmp_path):
    from video_note_mcp.adapters.media_acquisition import probe_downloaded_media

    path = tmp_path / "source.mp4"
    path.write_text(
        "#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\n"
        "https://127.0.0.1/private.ts\n#EXT-X-ENDLIST\n"
    )
    with pytest.raises(BilibiliNoteFailure):
        await probe_downloaded_media(path)


def test_generic_refuses_local_playlist_before_decoder(tmp_path):
    from video_note_mcp.adapters.generic_source import require_progressive_container

    path = tmp_path / "source.mp4"
    for body in [
        b"#EXTM3U\n#EXTINF:10,\nfile:///private/media.mp4\n",
        b"ffconcat version 1.0\nfile /private/media.mp4",
    ]:
        path.write_bytes(body)
        with pytest.raises(BilibiliNoteFailure, match="generic_container_unsupported"):
            require_progressive_container(path)
