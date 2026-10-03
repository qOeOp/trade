"""Explicit fixture author, never selected as a live fallback."""

from bilibili_note_mcp.application.ports import AcquiredSource, FrameAsset
from bilibili_note_mcp.domain.models import (
    GroundedText,
    NoteChapter,
    ScreenshotSelection,
    VideoNote,
)


class DeterministicDistiller:
    """Explicit fixture-only author; never a live fallback."""

    async def distill(self, source: AcquiredSource, frames: tuple[FrameAsset, ...]) -> VideoNote:
        refs = tuple(s.evidence_id for s in source.transcript.segments)
        point = GroundedText(
            text="示例演示了操作的前后变化，需要结合完整说明理解。", evidence_refs=refs
        )
        return VideoNote(
            overview=(point,),
            chapters=(
                NoteChapter(
                    title="操作演示",
                    points=(point,),
                    screenshots=tuple(ScreenshotSelection(frame_id=f.frame_id) for f in frames),
                ),
            ),
            takeaways=(),
        )
