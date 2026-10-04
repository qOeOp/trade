from __future__ import annotations

import re
import unicodedata
from dataclasses import replace
from pathlib import Path

from video_note_mcp.application.errors import BilibiliNoteFailure
from video_note_mcp.config import load_model_profile
from video_note_mcp.domain.artifacts import AcquiredSource, AudioReview
from video_note_mcp.domain.models import Quality

from .asr_siliconflow import SiliconFlowAsr, _extract_audio


def normalized(text: str) -> str:
    return "".join(
        c
        for c in unicodedata.normalize("NFKC", text).casefold()
        if not c.isspace() and c not in ",，。!?！？;；、"
    )


def review_windows(source: AcquiredSource, quality: Quality) -> tuple[tuple[int, int, str], ...]:
    """Keep sentence boundaries; review all audio or at most three heuristic-risk windows."""
    windows: list[tuple[int, int, str]] = []
    start = 0
    texts: list[str] = []
    previous_end = 0
    for segment in source.transcript.segments:
        if texts and segment.end_ms - start > 45000:
            windows.append((start, previous_end, " ".join(texts)))
            start, texts = previous_end, []
        texts.append(segment.text)
        previous_end = segment.end_ms
    if texts:
        windows.append((start, source.source.duration_ms, " ".join(texts)))
    if quality == "precise":
        return tuple(windows)
    if quality == "fast":
        return ()

    def risk(window: tuple[int, int, str]) -> int:
        text = window[2]
        return (
            4 * len(re.findall(r"[�]|听不清|无法辨认", text))
            + 2 * len(re.findall(r"(.{2,6})\1{2,}", text))
            + len(re.findall(r"[A-Za-z]+|\d+(?:\.\d+)?", text))
        )

    ranked = sorted(enumerate(windows), key=lambda item: (-risk(item[1]), item[0]))
    selected = sorted(index for index, _ in ranked[:3])
    return tuple(windows[index] for index in selected)


class AudioReviewer:
    async def review(
        self, source: AcquiredSource, quality: Quality, workspace: Path
    ) -> tuple[AudioReview, ...]:
        profile = load_model_profile()
        model = "Qwen/Qwen3-ASR-1.7B"
        if source.transcript.provider_ref == f"siliconflow:{model}":
            model = "XingChenAGI/XingChenASR-V3.2-Ultra"
        engine = SiliconFlowAsr(profile=replace(profile, asr_model=model))
        root = workspace / "audio-review"
        root.mkdir()
        results = []
        for index, (start, end, primary) in enumerate(review_windows(source, quality)):
            # Silence can make a sentence-boundary window long. The provider adapter splits it
            # into bounded 45-second uploads while preserving the complete review interval.
            audio = root / f"review-{index}.mp3"
            await _extract_audio(source.media_path, audio, start_ms=start, duration_ms=end - start)
            from video_note_mcp.application.progress import NullProgressReporter

            subdir = root / str(index)
            subdir.mkdir()
            result = await engine.transcribe(audio, end - start, subdir, NullProgressReporter())
            alternate = " ".join(s.text for s in result.segments)
            if not alternate or result.provider_ref == source.transcript.provider_ref:
                raise BilibiliNoteFailure("TRANSCRIPT_UNAVAILABLE", "review_engine_not_independent")
            results.append(
                AudioReview(
                    start,
                    end,
                    primary,
                    alternate,
                    result.provider_ref or model,
                    normalized(primary) != normalized(alternate),
                )
            )
        return tuple(results)
