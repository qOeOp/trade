"""Private, bounded material cache. Live metadata is always obtained by the source adapter."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import shutil
import tempfile
import time
from pathlib import Path

from pydantic import TypeAdapter

from video_note_mcp.application.transcript_validation import validate_transcript
from video_note_mcp.domain.artifacts import AcquiredSource, TranscriptResult
from video_note_mcp.domain.models import SourceV1

_TRANSCRIPT = TypeAdapter(TranscriptResult)
_MAX_BYTES = 8 * 1024**3
_TTL = 24 * 3600


def _sha(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


class SourceCache:
    def __init__(self, engine: str, root: Path | None = None) -> None:
        self.engine = engine
        self.root = root or Path(
            os.environ.get(
                "BILIBILI_NOTE_CACHE_DIR", str(Path.home() / ".cache/bilibili-note-mcp/material-v1")
            )
        )

    def _key(self, source: SourceV1) -> str:
        data = source.model_dump(mode="json")
        data.pop("requested_url", None)
        return hashlib.sha256(json.dumps([data, self.engine], sort_keys=True).encode()).hexdigest()

    def load(self, source: SourceV1) -> AcquiredSource | None:
        directory = self.root / self._key(source)
        try:
            manifest = directory / "receipt.json"
            if manifest.stat().st_size > 3 * 1024**2:
                return None
            data = json.loads(manifest.read_bytes())
            if not 0 <= time.time() - data["created"] <= _TTL:
                return None
            if data["key"] != self._key(source) or data["engine"] != self.engine:
                return None
            media = directory / "source.mp4"
            text = directory / "transcript.json"
            if media.is_symlink() or text.is_symlink() or directory.is_symlink():
                return None
            if not 0 < media.stat().st_size <= 2 * 1024**3 or text.stat().st_size > 2 * 1024**2:
                return None
            if _sha(media) != data["media_sha256"] or _sha(text) != data["transcript_sha256"]:
                return None
            transcript = _TRANSCRIPT.validate_json(text.read_bytes(), strict=True)
            if transcript.provider_ref != self.engine:
                return None
            if not isinstance(data["snapshot"], str) or len(data["snapshot"]) > 256:
                return None
            result = AcquiredSource(source, media, transcript, data["snapshot"])
            validate_transcript(result)
            return result
        except OSError, ValueError, KeyError, TypeError:
            return None

    def save(self, source: AcquiredSource) -> None:
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        with (self.root / ".write.lock").open("a") as lock:
            try:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return
            self._save_locked(source)

    def _save_locked(self, source: AcquiredSource) -> None:
        validate_transcript(source)
        if source.transcript.provider_ref != self.engine:
            return
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        destination = self.root / self._key(source.source)
        # Existing entries are immutable; no eviction of user material.
        if destination.exists():
            return
        size = source.media_path.stat().st_size
        used = sum(p.stat().st_size for p in self.root.glob("*/*") if p.is_file())
        if used + size + 3 * 1024**2 > _MAX_BYTES:
            return
        with tempfile.TemporaryDirectory(prefix=".write-", dir=self.root) as temporary:
            stage = Path(temporary) / "entry"
            stage.mkdir(mode=0o700)
            shutil.copyfile(source.media_path, stage / "source.mp4")
            (stage / "transcript.json").write_bytes(_TRANSCRIPT.dump_json(source.transcript))
            receipt = {
                "key": self._key(source.source),
                "engine": self.engine,
                "created": time.time(),
                "media_sha256": _sha(stage / "source.mp4"),
                "transcript_sha256": _sha(stage / "transcript.json"),
                "snapshot": source.source_snapshot_ref,
            }
            (stage / "receipt.json").write_text(json.dumps(receipt))
            try:
                stage.rename(destination)
            except FileExistsError:
                pass
