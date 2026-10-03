import base64
import io
import json
from dataclasses import replace
from pathlib import Path

import pytest
from PIL import Image

from bilibili_note_mcp.adapters.direct_notes import DirectDistiller, Summary, chunks, sheets
from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.application.note_validation import validate_note
from bilibili_note_mcp.application.ports import AcquiredSource, TranscriptResult, TranscriptSegment
from bilibili_note_mcp.domain.models import GroundedText, NoteChapter, VideoNote


def source(draft, segments=None):
    return AcquiredSource(
        draft.source,
        Path("/unused"),
        TranscriptResult("platform_subtitle", None, "zh-CN", segments or draft.transcript),
        "test",
    )


async def test_short_note_uses_one_visual_request_and_retains_originals(draft):
    class Provider(DirectDistiller):
        calls = 0

        async def request(self, instruction, content, schema, **kwargs):
            self.calls += 1
            transcript = json.loads(content[0]["text"])["transcript"]
            assert [s["text"] for s in transcript] == [s.text for s in draft.transcript]
            assert sum(c["type"] == "image_url" for c in content) == 1
            assert "F02" in json.loads(content[1]["text"])["frames"][-1]["frame_id"]
            return draft.note

    provider = Provider()
    assert await provider.distill(source(draft), draft.frames) == draft.note
    assert provider.calls == 1
    assert draft.frames[-1].png_bytes.startswith(b"\x89PNG")


def test_partial_last_sheet_contains_last_frame(draft):
    frames = tuple(
        replace(draft.frames[i % 2], frame_id=f"F{i + 1:02}", timestamp_ms=i * 1000)
        for i in range(11)
    )
    output = sheets(frames)
    assert len(output) == 2
    raw = base64.b64decode(output[-1]["image_url"]["url"].split(",")[1])
    with Image.open(io.BytesIO(raw)) as image:
        assert image.size == (2880, 572)
        # Final frame is red and sits in the second cell; it was not discarded.
        r, g, b = image.getpixel((1400, 250))
        assert r > 200 and g < 30 and b < 30


@pytest.mark.parametrize("recover", [True, False])
async def test_invalid_binding_retries_only_author_once_then_fails_closed(draft, recover):
    class Provider(DirectDistiller):
        calls = 0

        async def request(self, *args, **kwargs):
            self.calls += 1
            if recover and self.calls == 2:
                return draft.note
            invalid = draft.note.overview[0].model_copy(update={"evidence_refs": ("foreign",)})
            return draft.note.model_copy(update={"overview": (invalid,)})

    provider = Provider()
    if recover:
        assert await provider.distill(source(draft), draft.frames) == draft.note
    else:
        with pytest.raises(BilibiliNoteFailure, match="note_evidence_invalid"):
            await provider.distill(source(draft), draft.frames)
    assert provider.calls == 2


def test_large_transcript_partition_retains_tail_and_frame_binding_group(draft):
    segments = tuple(
        TranscriptSegment(f"E{i:03}", i * 1000, (i + 1) * 1000, "说明" * 1000) for i in range(30)
    )
    frames = (
        replace(draft.frames[0], transcript_refs=("E014", "E015"), timestamp_ms=15000),
        replace(draft.frames[1], transcript_refs=("E029",), timestamp_ms=29500),
    )
    parts = chunks(source(draft, segments), frames)
    assert len(parts) > 1
    assert tuple(s for part, _ in parts for s in part.transcript.segments) == segments
    assert tuple(f for _, images in parts for f in images) == frames
    for part, images in parts:
        ids = {s.evidence_id for s in part.transcript.segments}
        assert all(set(f.transcript_refs) <= ids for f in images)


async def test_large_note_keeps_chapter_bodies_and_only_synthesizes_overview(draft):
    segments = tuple(
        TranscriptSegment(f"E{i:03}", i * 1000, (i + 1) * 1000, "说明" * 1000) for i in range(30)
    )

    class Provider(DirectDistiller):
        authored = []
        summaries = 0

        async def request(self, instruction, content, schema, **kwargs):
            if schema is Summary:
                self.summaries += 1
                return Summary(
                    overview=(GroundedText(text="完整概览", evidence_refs=("E000",)),), takeaways=()
                )
            transcript = json.loads(content[0]["text"])["transcript"]
            refs = tuple(s["evidence_id"] for s in transcript)
            point = GroundedText(text="本批原始内容" + refs[0], evidence_refs=refs)
            note = VideoNote(
                overview=(point,),
                chapters=(NoteChapter(title="讲解", points=(point,), screenshots=()),),
                takeaways=(),
            )
            self.authored.append(note)
            return note

    provider = Provider()
    note = await provider.distill(source(draft, segments), ())
    assert len(provider.authored) > 1 and provider.summaries == 1
    assert note.chapters == tuple(c for n in provider.authored for c in n.chapters)
    assert {ref for c in note.chapters for p in c.points for ref in p.evidence_refs} == {
        s.evidence_id for s in segments
    }


async def test_cancelled_author_does_not_start_repair(draft):
    import asyncio

    class Provider(DirectDistiller):
        calls = 0

        async def request(self, *args, **kwargs):
            self.calls += 1
            raise asyncio.CancelledError

    provider = Provider()
    with pytest.raises(asyncio.CancelledError):
        await provider.distill(source(draft), draft.frames)
    assert provider.calls == 1


@pytest.mark.parametrize("fault", ["unknown", "wrong_chapter", "duplicate", "speech_mismatch"])
async def test_bad_optional_image_keeps_all_prose_and_valid_images_without_regeneration(
    draft, fault
):
    first, second = draft.note.chapters
    bad = first.screenshots[0]
    frames = draft.frames
    if fault == "unknown":
        bad = bad.model_copy(update={"frame_id": "missing"})
    elif fault == "wrong_chapter":
        bad = second.screenshots[0]
    elif fault == "speech_mismatch":
        frames = (replace(frames[0], transcript_refs=("E002",)), frames[1])
    if fault == "duplicate":
        choices = (bad, bad)
    else:
        choices = (bad,)
    authored = draft.note.model_copy(
        update={"chapters": (first.model_copy(update={"screenshots": choices}), second)}
    )

    class Provider(DirectDistiller):
        calls = 0

        async def request(self, *args, **kwargs):
            self.calls += 1
            return authored

    with pytest.raises(BilibiliNoteFailure, match="chapter_frame_binding_invalid"):
        validate_note(authored, source(draft), frames)
    provider = Provider()
    note = await provider.distill(source(draft), frames)
    assert provider.calls == 1
    assert note.overview == authored.overview and note.takeaways == authored.takeaways
    assert [(c.title, c.points) for c in note.chapters] == [
        (c.title, c.points) for c in authored.chapters
    ]
    assert note.chapters[0].screenshots == (first.screenshots if fault == "duplicate" else ())
    assert note.chapters[1] == second
    assert authored.chapters[0].screenshots == choices
    validate_note(note, source(draft), frames)


async def test_all_images_invalid_keeps_complete_text_without_fabricating_replacements(draft):
    authored = draft.note.model_copy(
        update={
            "chapters": tuple(
                c.model_copy(
                    update={
                        "screenshots": (
                            c.screenshots[0].model_copy(update={"frame_id": "missing"}),
                        )
                    }
                )
                for c in draft.note.chapters
            )
        }
    )

    class Provider(DirectDistiller):
        async def request(self, *args, **kwargs):
            return authored

    note = await Provider().distill(source(draft), draft.frames)
    assert all(not c.screenshots for c in note.chapters)
    assert [c.points for c in note.chapters] == [c.points for c in authored.chapters]
    validate_note(note, source(draft), draft.frames)


async def test_schema_retry_identifies_shape_without_echoing_invalid_input(draft):
    from pydantic import ValidationError

    class Provider(DirectDistiller):
        calls = 0

        async def request(self, instruction, content, schema, **kwargs):
            self.calls += 1
            if self.calls == 1:
                invalid = draft.note.model_dump(mode="json")
                invalid["chapters"][0]["screenshots"] = ["UNTRUSTED_PRIVATE_VALUE"]
                try:
                    VideoNote.model_validate_json(json.dumps(invalid))
                except ValidationError as e:
                    raise BilibiliNoteFailure(
                        "DISTILLATION_FAILED", "provider_response_invalid"
                    ) from e
            feedback = content[-1]["text"]
            assert '"path": ["chapters", 0, "screenshots", 0]' in feedback
            assert '"type": "model_type"' in feedback
            assert "UNTRUSTED_PRIVATE_VALUE" not in feedback
            assert '{"frame_id":"F01"}' in instruction
            return draft.note

    provider = Provider()
    assert await provider.distill(source(draft), draft.frames) == draft.note
    assert provider.calls == 2
