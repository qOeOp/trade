from __future__ import annotations

import asyncio
from dataclasses import replace
from pathlib import Path

import pytest
from conftest import MemoryAuthor, MemoryMedia, MemorySource

from bilibili_note_mcp.adapters.note_publisher import LocalNotePublisher
from bilibili_note_mcp.application.create_note import CreateBilibiliNote
from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.application.note_validation import validate_note
from bilibili_note_mcp.fixture import FIXTURE_URL


def use_case(draft, root, author=None):
    return CreateBilibiliNote(
        MemorySource(draft),
        MemoryMedia(draft),
        author or MemoryAuthor(draft),
        LocalNotePublisher(root),
    )


async def test_publication_survives_temporary_source_cleanup(tmp_path, draft):
    app = use_case(draft, tmp_path)
    result = await app.execute(FIXTURE_URL)
    assert not app._source.workspace.exists()
    paths = list(map(Path, (result.note_path, result.html_path, *result.images)))
    assert all(path.is_file() for path in paths)
    assert app._distiller.calls == 1


@pytest.mark.parametrize(
    "mutation,reason",
    [
        ("dangling", "note_evidence_invalid"),
        ("duplicate", "note_evidence_invalid"),
        ("reverse", "chapter_order_invalid"),
        ("unknown_frame", "chapter_frame_binding_invalid"),
        ("wrong_time", "chapter_frame_binding_invalid"),
        ("wrong_refs", "chapter_frame_binding_invalid"),
        ("reused_frame", "chapter_frame_binding_invalid"),
    ],
)
async def test_grounding_failures_stop_before_verification(tmp_path, draft, mutation, reason):
    chapters = list(draft.note.chapters)
    frames = draft.frames
    if mutation in ("dangling", "duplicate"):
        point = (
            chapters[0]
            .points[0]
            .model_copy(
                update={"evidence_refs": ("E999",) if mutation == "dangling" else ("E001", "E001")}
            )
        )
        chapters[0] = chapters[0].model_copy(update={"points": (point,)})
    elif mutation == "reverse":
        chapters.reverse()
    elif mutation == "unknown_frame":
        chapters[0] = chapters[0].model_copy(
            update={
                "screenshots": (chapters[0].screenshots[0].model_copy(update={"frame_id": "F99"}),)
            }
        )
    elif mutation == "wrong_time":
        frames = (replace(frames[0], timestamp_ms=3000), frames[1])
    elif mutation == "wrong_refs":
        frames = (replace(frames[0], transcript_refs=("E002",)), frames[1])
    else:
        chapters[0] = chapters[0].model_copy(update={"screenshots": chapters[0].screenshots * 2})
    draft = replace(
        draft, note=draft.note.model_copy(update={"chapters": tuple(chapters)}), frames=frames
    )
    with pytest.raises(BilibiliNoteFailure, match=reason):
        await use_case(draft, tmp_path).execute(FIXTURE_URL)
    assert list(tmp_path.iterdir()) == []


async def test_analysis_repeated_cancellation_waits_for_cleanup(tmp_path, draft):

    class BlockingAuthor:
        def __init__(self):
            self.started = asyncio.Event()
            self.cleanup = asyncio.Event()
            self.release = asyncio.Event()
            self.finished = False

        async def distill(self, *args):
            self.started.set()
            try:
                await asyncio.Event().wait()
            finally:
                self.cleanup.set()
                await self.release.wait()
                self.finished = True

    author = BlockingAuthor()
    app = use_case(draft, tmp_path, author=author)
    task = asyncio.create_task(app.execute(FIXTURE_URL))
    await asyncio.wait_for(author.started.wait(), 1)
    task.cancel()
    await asyncio.wait_for(author.cleanup.wait(), 1)
    task.cancel()
    await asyncio.sleep(0)
    assert not task.done()
    author.release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert author.finished
    assert not app._source.workspace.exists()
    assert list(tmp_path.iterdir()) == []


async def test_irrelevant_images_can_be_omitted_without_losing_text(tmp_path, draft):
    note = draft.note.model_copy(
        update={
            "chapters": tuple(c.model_copy(update={"screenshots": ()}) for c in draft.note.chapters)
        }
    )
    draft = replace(draft, note=note)
    result = await use_case(draft, tmp_path).execute(FIXTURE_URL)
    assert result.images == ()
    assert "将纸张沿中线对折" in result.rendered_markdown
    assert "![" not in result.rendered_markdown


async def test_transcript_gap_rejected_before_authoring(tmp_path, draft):
    draft = replace(
        draft, transcript=(draft.transcript[0], replace(draft.transcript[1], start_ms=2100))
    )
    author = MemoryAuthor(draft)
    with pytest.raises(BilibiliNoteFailure, match="transcript_timeline_invalid"):
        await use_case(draft, tmp_path, author=author).execute(FIXTURE_URL)
    assert author.calls == 0
    assert list(tmp_path.iterdir()) == []


async def test_published_navigation_marks_interval_and_orders_screenshots(tmp_path, draft):
    chapter = draft.note.chapters[0].model_copy(
        update={
            "points": tuple(c.points[0] for c in draft.note.chapters),
            "screenshots": tuple(c.screenshots[0] for c in reversed(draft.note.chapters)),
        }
    )
    draft = replace(draft, note=draft.note.model_copy(update={"chapters": (chapter,)}))
    result = await use_case(draft, tmp_path).execute(FIXTURE_URL)
    for path in (result.note_path, result.html_path):
        body = await asyncio.to_thread(Path(path).read_text)
        assert "约 00:00:00–00:00:04" in body
        assert "&t=0" in body or "&amp;t=0" in body
        assert body.index("视频原始画面 · 00:00:01") < body.index("视频原始画面 · 00:00:03")


async def test_image_does_not_require_repeating_all_nearby_speech(tmp_path, draft):
    from dataclasses import replace

    # Original frame spans both sentences, chapter has the correct time range,
    # but the second sentence is filler omitted from the point references.
    first = replace(draft.transcript[0], end_ms=4000)
    second = replace(draft.transcript[1], text="接下来继续", start_ms=2000)
    frame = replace(draft.frames[0], transcript_refs=("E001", "E002"))
    chapter = draft.note.chapters[0]
    note = draft.note.model_copy(update={"chapters": (chapter,)})
    source = replace(draft, transcript=(first, second), frames=(frame, draft.frames[1]), note=note)
    from conftest import MemorySource

    from bilibili_note_mcp.application.progress import NullProgressReporter

    acquired = await MemorySource(source).acquire("", tmp_path, NullProgressReporter())
    validate_note(note, acquired, source.frames)


async def test_html_omits_transcript_but_markdown_retains_original_text(tmp_path, draft):
    from bilibili_note_mcp.domain.models import ScreenshotSelection

    assert "caption" not in ScreenshotSelection.model_json_schema()["properties"]
    transcript = tuple(
        replace(segment, text="<script>alert(1)</script> & 原句") for segment in draft.transcript
    )
    result = await use_case(replace(draft, transcript=transcript), tmp_path).execute(FIXTURE_URL)
    body = await asyncio.to_thread(Path(result.html_path).read_text)
    assert 'class="transcript-row"' not in body
    assert body.count('class="chapter-row"') == len(draft.note.chapters)
    assert "<script>" not in body
    markdown = await asyncio.to_thread(Path(result.note_path).read_text)
    assert markdown.count("原句") == len(transcript)
    assert 'class="full-transcript"' not in body
    assert "完整转录" not in body
    assert "完整转录" in markdown
