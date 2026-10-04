from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Protocol


class ProgressStageV1(StrEnum):
    SEARCH_ACTIVE = "search_active"
    SEARCH_READY = "search_ready"
    BATCH_ITEM_ACTIVE = "batch_item_active"
    BATCH_READY = "batch_ready"
    REQUEST_VALIDATED = "request_validated"
    MEDIA_ACQUISITION_ACTIVE = "media_acquisition_active"
    MEDIA_READY = "media_ready"
    TRANSCRIPTION_ACTIVE = "transcription_active"
    TRANSCRIPT_READY = "transcript_ready"
    HD_FRAMES_READY = "hd_frames_ready"
    VISUAL_ANALYSIS_ACTIVE = "visual_analysis_active"
    NOTE_VALIDATED = "note_validated"


@dataclass(frozen=True, slots=True)
class ProgressUpdateV1:
    stage: ProgressStageV1
    progress: int
    total: int
    message: str


_UPDATES = {
    ProgressStageV1.REQUEST_VALIDATED: ProgressUpdateV1(
        ProgressStageV1.REQUEST_VALIDATED, 5, 100, "链接已验证，正在读取视频来源"
    ),
    ProgressStageV1.MEDIA_READY: ProgressUpdateV1(
        ProgressStageV1.MEDIA_READY, 25, 100, "视频源已验证并下载"
    ),
    ProgressStageV1.TRANSCRIPT_READY: ProgressUpdateV1(
        ProgressStageV1.TRANSCRIPT_READY, 50, 100, "语音或字幕转写已完成"
    ),
    ProgressStageV1.HD_FRAMES_READY: ProgressUpdateV1(
        ProgressStageV1.HD_FRAMES_READY, 65, 100, "已按语音意图定位并提取相关视频截图"
    ),
    ProgressStageV1.NOTE_VALIDATED: ProgressUpdateV1(
        ProgressStageV1.NOTE_VALIDATED, 89, 100, "图文笔记已校验，正在保存并返回"
    ),
}


class ProgressReporter(Protocol):
    async def report(self, update: ProgressUpdateV1) -> None: ...


class NullProgressReporter:
    async def report(self, update: ProgressUpdateV1) -> None:
        return


def progress_update(stage: ProgressStageV1) -> ProgressUpdateV1:
    return _UPDATES[stage]


def transcription_progress(completed: int, total: int) -> ProgressUpdateV1:
    if total <= 0 or completed <= 0 or completed > total:
        raise ValueError("transcription progress is invalid")
    progress = 25 + min(24, round(24 * completed / total))
    return ProgressUpdateV1(
        ProgressStageV1.TRANSCRIPTION_ACTIVE,
        progress,
        100,
        f"语音转写进行中：{completed}/{total} 个时间窗",
    )


def media_acquisition_heartbeat(
    elapsed_seconds: int, last_verified_progress: int = 5
) -> ProgressUpdateV1:
    if elapsed_seconds <= 0 or not 5 <= last_verified_progress <= 49:
        raise ValueError("media acquisition heartbeat is invalid")
    if last_verified_progress >= 25:
        return ProgressUpdateV1(
            ProgressStageV1.TRANSCRIPTION_ACTIVE,
            last_verified_progress,
            100,
            f"语音转写仍在进行：已等待 {elapsed_seconds} 秒",
        )
    return ProgressUpdateV1(
        ProgressStageV1.MEDIA_ACQUISITION_ACTIVE,
        last_verified_progress,
        100,
        f"视频来源仍在读取：已等待 {elapsed_seconds} 秒",
    )


def visual_analysis_heartbeat(elapsed_seconds: int, sequence: int) -> ProgressUpdateV1:
    if elapsed_seconds <= 0 or sequence <= 0:
        raise ValueError("visual analysis heartbeat is invalid")
    return ProgressUpdateV1(
        ProgressStageV1.VISUAL_ANALYSIS_ACTIVE,
        min(74, 65 + sequence),
        100,
        f"视觉模型仍在解析音画证据：已等待 {elapsed_seconds} 秒",
    )


def search_progress(message: str, progress: int) -> ProgressUpdateV1:
    if not 1 <= progress <= 99:
        raise ValueError("search progress is invalid")
    stage = ProgressStageV1.SEARCH_READY if progress == 10 else ProgressStageV1.SEARCH_ACTIVE
    return ProgressUpdateV1(stage, progress, 100, message)


def batch_progress(message: str, progress: int, *, ready: bool = False) -> ProgressUpdateV1:
    if not 10 <= progress <= 99:
        raise ValueError("batch progress is invalid")
    stage = ProgressStageV1.BATCH_READY if ready else ProgressStageV1.BATCH_ITEM_ACTIVE
    return ProgressUpdateV1(stage, progress, 100, message)


class AnalysisProgressReporter:
    def __init__(self, parent: ProgressReporter) -> None:
        self.parent = parent
        self.last = 65

    async def report(self, update: ProgressUpdateV1) -> None:
        self.last = max(self.last, update.progress)
        await self.parent.report(replace(update, progress=self.last))


_PROVIDER_PROGRESS: ContextVar[ProgressReporter | None] = ContextVar(
    "provider_progress", default=None
)


@contextmanager
def provider_progress_scope(reporter: ProgressReporter) -> Iterator[None]:
    token = _PROVIDER_PROGRESS.set(reporter)
    try:
        yield
    finally:
        _PROVIDER_PROGRESS.reset(token)


async def report_provider_retry(attempt: int, status: int, delay: float) -> None:
    reporter = _PROVIDER_PROGRESS.get()
    if reporter is not None:
        reason = f"HTTP {status}" if status else "连接中断或超时"
        await reporter.report(
            ProgressUpdateV1(
                ProgressStageV1.VISUAL_ANALYSIS_ACTIVE,
                65,
                100,
                f"模型服务暂时不可用（{reason}），{delay:g}秒后重试当前步骤（第{attempt}/3次）；已完成步骤保留",
            )
        )
