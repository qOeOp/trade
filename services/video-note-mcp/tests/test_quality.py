import asyncio
from dataclasses import replace
from pathlib import Path

import pytest
from conftest import MemoryAuthor, MemoryMedia, MemorySource
from pydantic import ValidationError

from video_note_mcp.adapters.audio_review import AudioReviewer, normalized, review_windows
from video_note_mcp.adapters.note_publisher import LocalNotePublisher
from video_note_mcp.application.create_note import CreateBilibiliNote
from video_note_mcp.application.errors import BilibiliNoteFailure
from video_note_mcp.application.progress import NullProgressReporter
from video_note_mcp.domain.artifacts import AudioReview, TranscriptResult, TranscriptSegment
from video_note_mcp.domain.models import CreateNoteInputV1, SearchAndCreateInputV1
from video_note_mcp.fixture import FIXTURE_URL


class Reviewer:
    def __init__(self):
        self.qualities = []

    async def review(self, source, quality, workspace):
        self.qualities.append(quality)
        return (
            AudioReview(
                0,
                2000,
                source.transcript.segments[0].text,
                "折纸另一种转写<script>",
                "second-asr",
                True,
            ),
        )


@pytest.mark.parametrize("quality", ["fast", "standard", "precise"])
async def test_quality_preserves_original_and_exposes_disagreement(tmp_path, draft, quality):
    reviewer = Reviewer()
    app = CreateBilibiliNote(
        MemorySource(draft),
        MemoryMedia(draft),
        MemoryAuthor(draft),
        LocalNotePublisher(tmp_path),
        reviewer,
    )
    result = await app.execute(FIXTURE_URL, quality=quality)
    assert reviewer.qualities == ([] if quality == "fast" else [quality])
    text = await asyncio.to_thread(Path(result.note_path).read_text)
    assert "完整转录" in text and draft.transcript[0].text in text
    if quality != "fast":
        assert "转写存在分歧" in text
        assert "&lt;script&gt;" in await asyncio.to_thread(Path(result.html_path).read_text)
        assert "<script>" not in await asyncio.to_thread(Path(result.html_path).read_text)


async def test_required_review_failure_never_publishes(tmp_path, draft):
    class Failed(Reviewer):
        async def review(self, *args):
            raise BilibiliNoteFailure("TRANSCRIPT_UNAVAILABLE", "review_failed")

    app = CreateBilibiliNote(
        MemorySource(draft),
        MemoryMedia(draft),
        MemoryAuthor(draft),
        LocalNotePublisher(tmp_path),
        Failed(),
    )
    with pytest.raises(BilibiliNoteFailure, match="review_failed"):
        await app.execute(FIXTURE_URL, quality="precise")
    assert not list(tmp_path.glob("note-*"))


def test_both_public_inputs_default_standard_and_reject_unknown():
    assert CreateNoteInputV1(url=FIXTURE_URL).quality == "standard"
    assert SearchAndCreateInputV1(query="折纸").quality == "standard"
    for cls, args in [
        (CreateNoteInputV1, {"url": FIXTURE_URL}),
        (SearchAndCreateInputV1, {"query": "折纸"}),
    ]:
        with pytest.raises(ValidationError):
            cls.model_validate({**args, "quality": "maximum"})


async def test_no_subtitle_review_limits_and_audio_coverage(tmp_path, draft):
    source = await MemorySource(draft).acquire(FIXTURE_URL, tmp_path, NullProgressReporter())
    segments = tuple(
        TranscriptSegment(f"E{i:03}", i * 45000, (i + 1) * 45000, f"步骤{i}，然后对折。")
        for i in range(7)
    )
    source = replace(
        source,
        source=source.source.model_copy(update={"duration_ms": 315000}),
        transcript=TranscriptResult("asr", "mlx:test", "zh", segments),
    )
    assert len(review_windows(source, "standard")) == 3
    complete = review_windows(source, "precise")
    assert complete[0][0] == 0 and complete[-1][1] == 315000
    assert all(a[1] == b[0] for a, b in zip(complete, complete[1:], strict=False))
    assert review_windows(source, "fast") == ()
    assert normalized("ＡＢＣ， 3。") == normalized("abc3")
    assert normalized("3小时") != normalized("3到4小时")
    assert normalized("3") != normalized("-3")
    assert normalized("3.4") != normalized("34")
    assert normalized("3%") != normalized("3")


@pytest.mark.parametrize(
    "primary,expected_model",
    [
        ("mlx:test", "Qwen/Qwen3-ASR-1.7B"),
        ("siliconflow:Qwen/Qwen3-ASR-1.7B", "XingChenAGI/XingChenASR-V3.2-Ultra"),
    ],
)
async def test_reviewer_uses_siliconflow_wire_and_preserves_raw(
    tmp_path, draft, monkeypatch, primary, expected_model
):
    import httpx

    from bilibili_note_mcp.adapters import asr_siliconflow, audio_review

    monkeypatch.setenv("SILICONFLOW_API_KEY", "siliconflow-test-only")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "deepseek-test-only")
    source = await MemorySource(draft).acquire(FIXTURE_URL, tmp_path, NullProgressReporter())
    source = replace(
        source, transcript=replace(source.transcript, method="asr", provider_ref=primary)
    )
    requests = []

    def respond(request):
        requests.append(request)
        assert str(request.url) == "https://api.siliconflow.cn/v1/audio/transcriptions"
        assert request.headers["Authorization"] == "Bearer siliconflow-test-only"
        assert expected_model.encode() in request.content
        return httpx.Response(200, json={"text": "另一种结果"})

    def engine(profile):
        return asr_siliconflow.SiliconFlowAsr(profile, httpx.MockTransport(respond))

    async def extract(_source, target, **_kwargs):
        target.write_bytes(b"audio")

    monkeypatch.setattr(audio_review, "SiliconFlowAsr", engine)
    monkeypatch.setattr(audio_review, "_extract_audio", extract)
    monkeypatch.setattr(asr_siliconflow, "_extract_audio", extract)
    result = await AudioReviewer().review(source, "precise", tmp_path)
    assert len(requests) == 1
    assert result[0].provider_ref == "siliconflow:" + expected_model
    assert result[0].differs
    assert result[0].primary_text == " ".join(s.text for s in source.transcript.segments)
    assert source.transcript.segments == draft.transcript


@pytest.mark.parametrize("search", [False, True])
@pytest.mark.parametrize("quality", ["fast", "standard", "precise"])
async def test_mcp_routes_quality_for_both_entrypoints(tmp_path, draft, search, quality):
    from mcp import Client

    from video_note_mcp.adapters.fixture_search import FixtureSearch
    from video_note_mcp.application.search_notes import SearchAndCreateBilibiliNotes
    from video_note_mcp.mcp_server import SEARCH_TOOL_NAME, TOOL_NAME, build_server

    reviewer = Reviewer()
    publisher = LocalNotePublisher(tmp_path)
    app = CreateBilibiliNote(
        MemorySource(draft),
        MemoryMedia(draft),
        MemoryAuthor(draft),
        publisher,
        reviewer,
    )
    server = build_server(app, SearchAndCreateBilibiliNotes(FixtureSearch(), app, publisher))
    arguments = {"query": "纸飞机", "max_videos": 1} if search else {"url": FIXTURE_URL}
    async with Client(server) as client:
        result = await client.call_tool(
            SEARCH_TOOL_NAME if search else TOOL_NAME, {**arguments, "quality": quality}
        )
    assert not result.is_error
    if quality == "fast":
        assert reviewer.qualities == []
    else:
        assert reviewer.qualities and all(q == quality for q in reviewer.qualities)


async def test_cancellation_during_review_does_not_publish(tmp_path, draft):
    import asyncio

    started, stopped = asyncio.Event(), asyncio.Event()

    class Waiting(Reviewer):
        async def review(self, *args):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                stopped.set()

    app = CreateBilibiliNote(
        MemorySource(draft),
        MemoryMedia(draft),
        MemoryAuthor(draft),
        LocalNotePublisher(tmp_path),
        Waiting(),
    )
    task = asyncio.create_task(app.execute(FIXTURE_URL, quality="precise"))
    await asyncio.wait_for(started.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert stopped.is_set()
    assert not list(tmp_path.glob("note-*"))
