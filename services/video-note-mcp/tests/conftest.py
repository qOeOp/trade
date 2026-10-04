from __future__ import annotations

import hashlib
import io

import pytest
from PIL import Image

from video_note_mcp.application.ports import (
    AcquiredSource,
    FrameAsset,
    NoteDraft,
    TranscriptResult,
    TranscriptSegment,
)
from video_note_mcp.domain.models import (
    GroundedText,
    NoteChapter,
    ScreenshotSelection,
    SourceV1,
    VideoNote,
)
from video_note_mcp.fixture import FIXTURE_URL


def make_draft(title="纸飞机折叠示范", text="将纸张沿中线对折，再展开。", images=True):
    source = SourceV1(
        platform="bilibili",
        requested_url=FIXTURE_URL,
        canonical_url=FIXTURE_URL,
        video_id="BV1bK411W797",
        part_id="1",
        part_index=1,
        title=title,
        author_name="示范作者",
        published_at="2026-10-02T00:00:00Z",
        duration_ms=4000,
    )
    transcript = (
        TranscriptSegment("E001", 0, 2000, text),
        TranscriptSegment("E002", 2000, 4000, "沿折痕折叠机翼。"),
    )
    frames = []
    for index, color in enumerate(("red", "blue"), 1):
        buffer = io.BytesIO()
        Image.new("RGB", (1280, 720), color).save(buffer, format="PNG")
        png = buffer.getvalue()
        frames.append(
            FrameAsset(
                f"F{index:02d}",
                f"G{index:02d}",
                index * 2000 - 1000,
                1280,
                720,
                png,
                hashlib.sha256(png).hexdigest(),
                (f"E{index:03d}",),
                "coverage",
            )
        )
    chapters = tuple(
        NoteChapter(
            title=f"步骤{index}",
            points=(GroundedText(text=s.text, evidence_refs=(s.evidence_id,)),),
            screenshots=(ScreenshotSelection(frame_id=f.frame_id),) if images else (),
        )
        for index, (s, f) in enumerate(zip(transcript, frames, strict=True), 1)
    )
    note = VideoNote(
        overview=(GroundedText(text="纸飞机折叠的两个步骤。", evidence_refs=("E001", "E002")),),
        chapters=chapters,
        takeaways=(),
    )
    return NoteDraft(source, note, transcript, tuple(frames) if images else ())


@pytest.fixture
def draft():
    return make_draft()


class MemorySource:
    def __init__(self, draft):
        self.draft = draft
        self.workspace = None

    async def acquire(self, url, workspace, progress):
        self.workspace = workspace
        media = workspace / "media.mp4"
        media.write_bytes(b"temporary private media")
        return AcquiredSource(
            self.draft.source,
            media,
            TranscriptResult("platform_subtitle", None, "zh-CN", self.draft.transcript),
            "fixture-snapshot",
        )


class MemoryMedia:
    def __init__(self, draft):
        self.draft = draft

    async def extract_frames(self, source, workspace):
        assert source.media_path.exists()
        return self.draft.frames


class MemoryAuthor:
    def __init__(self, draft):
        self.draft = draft
        self.calls = 0

    async def distill(self, source, frames):
        self.calls += 1
        return self.draft.note
