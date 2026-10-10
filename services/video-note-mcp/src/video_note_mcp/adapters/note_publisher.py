from __future__ import annotations

import hashlib
import io
import os
import shutil
import tempfile
import uuid
from pathlib import Path

from PIL import Image

from video_note_mcp.application.errors import BilibiliNoteFailure
from video_note_mcp.application.ports import NoteDraft, PublishedNote
from video_note_mcp.application.resource_limits import (
    FRAME_MAX_PIXELS,
    FRAME_PNG_BYTES,
    FRAME_PNG_TOTAL_BYTES,
)
from video_note_mcp.presentation.markdown import render


class LocalNotePublisher:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or Path(
            os.environ.get(
                "BILIBILI_NOTE_OUTPUT_DIR",
                str(Path.home() / ".local/share/bilibili-note-mcp/notes"),
            )
        )

    def publish(self, drafts: tuple[NoteDraft, ...]) -> PublishedNote:
        if not 1 <= len(drafts) <= 3:
            raise BilibiliNoteFailure("OUTPUT_INVALID", "bundle_count_invalid")
        root = self.root.expanduser()
        if not root.is_absolute():
            raise BilibiliNoteFailure("OUTPUT_INVALID", "output_root_not_absolute")
        if any(p.is_symlink() for p in (root, *root.parents)):
            raise BilibiliNoteFailure("OUTPUT_INVALID", "output_root_symlink")
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        final = root / ("note-" + uuid.uuid4().hex)
        stage = Path(tempfile.mkdtemp(prefix=".staging-", dir=root))
        try:
            images = stage / "images"
            images.mkdir(mode=0o700)
            relative: dict[tuple[int, str], str] = {}
            absolute: dict[tuple[int, str], str] = {}
            total = 0
            for index, draft in enumerate(drafts):
                for number, frame in enumerate(draft.frames):
                    total += len(frame.png_bytes)
                    if len(frame.png_bytes) > FRAME_PNG_BYTES or total > 3 * FRAME_PNG_TOTAL_BYTES:
                        raise ValueError("asset bytes exceeded")
                    if hashlib.sha256(frame.png_bytes).hexdigest() != frame.asset_ref:
                        raise ValueError("asset digest changed")
                    with Image.open(io.BytesIO(frame.png_bytes)) as decoded:
                        if (
                            decoded.format != "PNG"
                            or decoded.size != (frame.width, frame.height)
                            or decoded.width * decoded.height > FRAME_MAX_PIXELS
                        ):
                            raise ValueError("invalid image")
                        decoded.verify()
                    name = f"images/source-{index + 1}-{number + 1}.png"
                    (stage / name).write_bytes(frame.png_bytes)
                    relative[index, frame.frame_id] = name
                    absolute[index, frame.frame_id] = str(final / name)
            markdown = render(drafts, relative)
            preview = render(drafts, relative, html_mode=True)
            terminal = render(drafts, absolute)
            if (
                len(terminal.encode()) > len(drafts) * 262144
                or len(preview.encode()) > len(drafts) * 524288
            ):
                raise ValueError("terminal exceeded")
            (stage / "note.md").write_text(markdown, encoding="utf-8")
            (stage / "note.html").write_text(preview, encoding="utf-8")
            result = PublishedNote(
                terminal, str(final / "note.md"), str(final / "note.html"), tuple(absolute.values())
            )
            if final.exists() or final.is_symlink():
                raise ValueError("bundle collision")
            os.rename(stage, final)
            return result
        except Exception as e:
            if isinstance(e, BilibiliNoteFailure):
                raise
            raise BilibiliNoteFailure("OUTPUT_INVALID", "bundle_publication_failed") from e
        finally:
            if stage.exists():
                shutil.rmtree(stage)
