import json
from dataclasses import replace

import pytest

from bilibili_note_mcp.adapters.asr_mlx import MLX_IDENTITY, MlxAsr
from bilibili_note_mcp.adapters.source_cache import SourceCache
from bilibili_note_mcp.adapters.subprocesses import CapturedProcess
from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.application.progress import NullProgressReporter
from bilibili_note_mcp.application.transcript_validation import validate_transcript
from bilibili_note_mcp.domain.artifacts import AcquiredSource, TranscriptResult, TranscriptSegment


def material(tmp_path, draft):
    media = tmp_path / "original.mp4"
    media.write_bytes(b"verified test media")
    return AcquiredSource(
        draft.source,
        media,
        TranscriptResult(
            "asr",
            MLX_IDENTITY,
            "zh",
            (
                TranscriptSegment("E001", 120, 1800, "先折叠纸张。"),
                TranscriptSegment("E002", 2500, 3800, "最后展开检查。"),
            ),
            4000,
        ),
        "bs_" + "a" * 64,
    )


def test_full_audio_receipt_allows_silence_but_rejects_overlap_and_incomplete(tmp_path, draft):
    source = material(tmp_path, draft)
    validate_transcript(source)
    for receipt in (None, 3999):
        with pytest.raises(BilibiliNoteFailure):
            validate_transcript(
                replace(source, transcript=replace(source.transcript, covered_duration_ms=receipt))
            )
    with pytest.raises(BilibiliNoteFailure):
        validate_transcript(
            replace(
                source,
                transcript=replace(
                    source.transcript,
                    segments=(
                        source.transcript.segments[0],
                        TranscriptSegment("E002", 1700, 3900, "重叠"),
                    ),
                ),
            )
        )


def test_cache_identity_integrity_and_ttl(tmp_path, draft, monkeypatch):
    source = material(tmp_path, draft)
    cache = SourceCache(MLX_IDENTITY, tmp_path / "cache")
    cache.save(source)
    hit = cache.load(source.source)
    assert hit and hit.transcript == source.transcript
    assert hit.media_path.read_bytes() == source.media_path.read_bytes()
    assert cache.load(source.source.model_copy(update={"part_id": "2"})) is None
    assert SourceCache("different revision", cache.root).load(source.source) is None
    monkeypatch.setattr("bilibili_note_mcp.adapters.source_cache.time.time", lambda: 10**12)
    assert cache.load(source.source) is None
    monkeypatch.undo()
    hit.media_path.write_bytes(b"corrupted")
    assert cache.load(source.source) is None


async def test_mlx_worker_receipt_and_duration_failure(tmp_path, monkeypatch):
    duration = 4000

    async def captured(*args, **kwargs):
        if args[0] == "ffmpeg":
            return CapturedProcess(0, b"", b"")
        return CapturedProcess(
            0,
            json.dumps(
                {
                    "audio_duration_ms": duration,
                    "language": "zh",
                    "segments": [{"start_ms": 120, "end_ms": 3800, "text": "保留结尾。"}],
                }
            ).encode(),
            b"",
        )

    monkeypatch.setattr("bilibili_note_mcp.adapters.asr_mlx.run_captured", captured)
    engine = MlxAsr("/test/python")
    result = await engine.transcribe(
        tmp_path / "source.mp4", 4000, tmp_path, NullProgressReporter()
    )
    assert result.covered_duration_ms == 4000
    assert result.segments[0].start_ms == 120
    duration = 1000
    with pytest.raises(BilibiliNoteFailure, match="local_asr_failed"):
        await engine.transcribe(tmp_path / "source.mp4", 4000, tmp_path, NullProgressReporter())
