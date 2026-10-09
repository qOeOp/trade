import json
from dataclasses import replace

import pytest

from video_note_mcp.adapters.asr_mlx import MLX_IDENTITY, MlxAsr
from video_note_mcp.adapters.subprocesses import CapturedProcess
from video_note_mcp.application.errors import BilibiliNoteFailure
from video_note_mcp.application.progress import NullProgressReporter
from video_note_mcp.application.transcript_validation import validate_transcript
from video_note_mcp.domain.artifacts import AcquiredSource, TranscriptResult, TranscriptSegment


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

    monkeypatch.setattr("video_note_mcp.adapters.asr_mlx.run_captured", captured)
    engine = MlxAsr("/test/python")
    result = await engine.transcribe(
        tmp_path / "source.mp4", 4000, tmp_path, NullProgressReporter()
    )
    assert result.covered_duration_ms == 4000
    assert result.segments[0].start_ms == 120
    duration = 1000
    with pytest.raises(BilibiliNoteFailure, match="local_asr_failed"):
        await engine.transcribe(tmp_path / "source.mp4", 4000, tmp_path, NullProgressReporter())
