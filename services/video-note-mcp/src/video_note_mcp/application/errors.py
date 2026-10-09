from __future__ import annotations

import asyncio

from video_note_mcp.domain.models import FailureCode


class BilibiliNoteFailure(RuntimeError):
    def __init__(self, code: FailureCode, reason: str) -> None:
        super().__init__(reason)
        self.code = code
        self.reason = reason
        self.recovery: dict[str, str] = {}


class NoteCancelled(asyncio.CancelledError):
    def __init__(self, recovery: dict[str, str], cause: asyncio.CancelledError) -> None:
        super().__init__("request_cancelled")
        self.recovery = {**recovery, **getattr(cause, "recovery", {})}
