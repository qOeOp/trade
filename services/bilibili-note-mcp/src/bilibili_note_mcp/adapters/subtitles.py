from __future__ import annotations

import re

from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.application.ports import TranscriptSegment

_TIMING = re.compile(
    r"^(?P<start>\d{2}:\d{2}:\d{2}[.,]\d{3})\s+-->\s+"
    r"(?P<end>\d{2}:\d{2}:\d{2}[.,]\d{3})"
)


def _milliseconds(value: str) -> int:
    hours, minutes, seconds = value.replace(",", ".").split(":")
    whole, fraction = seconds.split(".")
    return ((int(hours) * 60 + int(minutes)) * 60 + int(whole)) * 1000 + int(fraction)


def parse_webvtt(text: str) -> tuple[TranscriptSegment, ...]:
    lines = text.replace("\r\n", "\n").split("\n")
    output: list[TranscriptSegment] = []
    index = 0
    while index < len(lines):
        match = _TIMING.match(lines[index].strip())
        index += 1
        if match is None:
            continue
        body: list[str] = []
        while index < len(lines) and lines[index].strip():
            body.append(lines[index].strip())
            index += 1
        excerpt = " ".join(body).strip()
        if excerpt:
            output.append(
                TranscriptSegment(
                    evidence_id=f"E{len(output) + 1:03d}",
                    start_ms=_milliseconds(match.group("start")),
                    end_ms=_milliseconds(match.group("end")),
                    text=excerpt,
                )
            )
    if not output:
        raise BilibiliNoteFailure("TRANSCRIPT_UNAVAILABLE", "subtitle_empty")
    return tuple(output)
