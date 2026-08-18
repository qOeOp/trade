from __future__ import annotations

from bilibili_note_mcp.domain.models import FailureCode


class BilibiliNoteFailure(RuntimeError):
    def __init__(self, code: FailureCode, reason: str) -> None:
        super().__init__(reason)
        self.code = code
        self.reason = reason
