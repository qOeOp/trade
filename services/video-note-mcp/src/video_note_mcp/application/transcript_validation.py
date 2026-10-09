from video_note_mcp.domain.artifacts import AcquiredSource

from .errors import BilibiliNoteFailure
from .resource_limits import TRANSCRIPT_TOTAL_BYTES


def validate_transcript(source: AcquiredSource) -> None:
    transcript = source.transcript.segments
    duration_ms = source.source.duration_ms
    full_audio = source.transcript.covered_duration_ms == duration_ms
    if (
        (source.transcript.covered_duration_ms is not None and not full_audio)
        or not transcript
        or len(transcript) > 4096
        or (
            not full_audio and (transcript[0].start_ms != 0 or transcript[-1].end_ms != duration_ms)
        )
    ):
        raise BilibiliNoteFailure("TRANSCRIPT_INCOMPLETE", "transcript_coverage_incomplete")
    previous_end = 0
    transcript_bytes = 0
    for index, segment in enumerate(transcript, start=1):
        if (
            not segment.text.strip()
            or segment.evidence_id != f"E{index:03d}"
            or segment.start_ms < previous_end
            or (not full_audio and segment.start_ms != previous_end)
            or segment.end_ms <= segment.start_ms
            or segment.end_ms > duration_ms
        ):
            raise BilibiliNoteFailure("TRANSCRIPT_INCOMPLETE", "transcript_timeline_invalid")
        previous_end = segment.end_ms
        transcript_bytes += len(segment.text.encode("utf-8"))
        if transcript_bytes > TRANSCRIPT_TOTAL_BYTES:
            raise BilibiliNoteFailure("TRANSCRIPT_INCOMPLETE", "transcript_bytes_exceeded")
