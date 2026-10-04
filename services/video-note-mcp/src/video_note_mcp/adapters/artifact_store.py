"""One bounded immutable store for resumable media, transcripts and original frames."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import stat
import tempfile
import time
from collections.abc import Callable
from dataclasses import asdict
from functools import wraps
from pathlib import Path
from typing import Any

from pydantic import TypeAdapter

from video_note_mcp.adapters.media_acquisition import copy_bounded_media
from video_note_mcp.adapters.strict_json import decode_strict_json_object
from video_note_mcp.application.errors import BilibiliNoteFailure
from video_note_mcp.application.note_validation import validate_frame_bindings, validate_frames
from video_note_mcp.application.resource_limits import FRAME_PNG_BYTES, MEDIA_DOWNLOAD_BYTES
from video_note_mcp.application.transcript_validation import validate_transcript
from video_note_mcp.domain.artifacts import (
    AcquiredSource,
    AudioReview,
    DownloadedSource,
    FrameAsset,
    TranscriptResult,
)
from video_note_mcp.domain.models import Quality, SourceV1

ID = re.compile(r"^(media|transcript|frames)-[0-9a-f]{64}$")
MANIFEST_BYTES = 8 * 1024 * 1024


def _failure(reason: str) -> BilibiliNoteFailure:
    return BilibiliNoteFailure("ARTIFACT_UNAVAILABLE", reason)


def _regular(path: Path, maximum: int) -> bytes:
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > maximum:
            raise _failure("artifact_file_invalid")
        value = stream.read(maximum + 1)
    if len(value) > maximum:
        raise _failure("artifact_file_too_large")
    return value


def _validated[**P, T](operation: Callable[P, T]) -> Callable[P, T]:
    @wraps(operation)
    def wrapped(*args: P.args, **kwargs: P.kwargs) -> T:
        try:
            return operation(*args, **kwargs)
        except (OSError, ValueError, TypeError, KeyError) as e:
            raise _failure("artifact_invalid") from e

    return wrapped


class ArtifactStore:
    def __init__(
        self,
        root: Path | None = None,
        *,
        max_bytes: int = 8 * 1024**3,
        max_entries: int = 256,
        ttl_seconds: int = 86400,
    ) -> None:
        self.root = root or Path(
            os.environ.get(
                "BILIBILI_NOTE_ARTIFACT_DIR",
                str(Path.home() / ".local/share/video-note-mcp/artifacts"),
            )
        )
        self.max_bytes, self.max_entries, self.ttl_seconds = max_bytes, max_entries, ttl_seconds

    def _root(self) -> None:
        if not self.root.is_absolute() or self.root.is_symlink():
            raise _failure("artifact_root_invalid")
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        if not self.root.is_dir():
            raise _failure("artifact_root_invalid")

    def _commit(
        self,
        kind: str,
        data: dict[str, Any],
        media: Path | None = None,
        frames: tuple[FrameAsset, ...] = (),
    ) -> str:
        self._root()
        # Lock across server processes, including capacity accounting and the final rename.
        descriptor = os.open(self.root / ".lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "rb") as lock:
            if not stat.S_ISREG(os.fstat(lock.fileno()).st_mode):
                raise _failure("artifact_store_invalid")
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as e:
                raise _failure("artifact_store_busy") from e
            directories = []
            for entry in self.root.iterdir():
                if entry.name == ".lock":
                    continue
                if not ID.fullmatch(entry.name) and not entry.name.startswith(".staging-"):
                    raise _failure("artifact_store_invalid")
                directories.append(entry)
                if len(directories) >= self.max_entries:
                    raise _failure("artifact_capacity_exceeded")
            used = 0
            for directory in directories:
                if directory.is_symlink() or not directory.is_dir():
                    raise _failure("artifact_store_invalid")
                for child in directory.iterdir():
                    if child.is_symlink() or not child.is_file():
                        raise _failure("artifact_store_invalid")
                    used += child.stat().st_size
            expected = (media.stat().st_size if media else 0) + sum(
                len(f.png_bytes) for f in frames
            )
            if len(directories) >= self.max_entries or used + expected > self.max_bytes:
                raise _failure("artifact_capacity_exceeded")
            with tempfile.TemporaryDirectory(prefix=".staging-", dir=self.root) as scratch:
                stage = Path(scratch)
                files: dict[str, str] = {}
                if media is not None:
                    files["media.mp4"] = copy_bounded_media(media, stage / "media.mp4")
                for frame in frames:
                    name = frame.frame_id + ".png"
                    (stage / name).write_bytes(frame.png_bytes)
                    files[name] = hashlib.sha256(frame.png_bytes).hexdigest()
                manifest = json.dumps(
                    {
                        "version": 1,
                        "kind": kind,
                        "created": time.time(),
                        "data": data,
                        "files": files,
                    },
                    sort_keys=True,
                    separators=(",", ":"),
                    ensure_ascii=False,
                ).encode()
                if len(manifest) > MANIFEST_BYTES:
                    raise _failure("artifact_manifest_too_large")
                size = len(manifest) + sum(p.stat().st_size for p in stage.iterdir())
                if used + size > self.max_bytes:
                    raise _failure("artifact_capacity_exceeded")
                identity = kind + "-" + hashlib.sha256(manifest).hexdigest()
                (stage / "manifest.json").write_bytes(manifest)
                stage.rename(self.root / identity)
            return identity

    def _load(self, identity: str, kind: str) -> tuple[dict[str, Any], Path]:
        try:
            if not ID.fullmatch(identity) or not identity.startswith(kind + "-"):
                raise _failure("artifact_id_invalid")
            self._root()
            directory = self.root / identity
            if directory.is_symlink() or not directory.is_dir():
                raise _failure("artifact_missing")
            raw = _regular(directory / "manifest.json", MANIFEST_BYTES)
            if hashlib.sha256(raw).hexdigest() != identity.split("-", 1)[1]:
                raise _failure("artifact_digest_invalid")
            manifest = decode_strict_json_object(raw)
            if (
                set(manifest) != {"version", "kind", "created", "data", "files"}
                or manifest["version"] != 1
                or manifest["kind"] != kind
            ):
                raise _failure("artifact_manifest_invalid")
            if (
                not isinstance(manifest["created"], (int, float))
                or not 0 <= time.time() - manifest["created"] <= self.ttl_seconds
            ):
                raise _failure("artifact_expired")
            files = manifest["files"]
            if not isinstance(files, dict) or len(files) > 48:
                raise _failure("artifact_manifest_invalid")
            for name, expected in files.items():
                if name != "media.mp4" and not re.fullmatch(r"F[0-9]{2}\.png", name):
                    raise _failure("artifact_file_invalid")
                path = directory / name
                if name == "media.mp4":
                    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                    with os.fdopen(fd, "rb") as stream:
                        info = os.fstat(stream.fileno())
                        if (
                            not stat.S_ISREG(info.st_mode)
                            or not 0 < info.st_size <= MEDIA_DOWNLOAD_BYTES
                        ):
                            raise _failure("artifact_media_invalid")
                        digest = hashlib.file_digest(stream, "sha256").hexdigest()
                else:
                    digest = hashlib.sha256(_regular(path, FRAME_PNG_BYTES)).hexdigest()
                if digest != expected:
                    raise _failure("artifact_digest_invalid")
            if set(p.name for p in directory.iterdir()) != {"manifest.json", *files}:
                raise _failure("artifact_files_invalid")
            return manifest["data"], directory
        except (OSError, ValueError, TypeError, KeyError) as e:
            raise _failure("artifact_invalid") from e

    @_validated
    def save_media(self, source: DownloadedSource) -> str:
        return self._commit(
            "media",
            {
                "source": source.source.model_dump(mode="json"),
                "snapshot": source.source_snapshot_ref,
            },
            source.media_path,
        )

    @_validated
    def load_media(self, identity: str) -> DownloadedSource:
        data, directory = self._load(identity, "media")
        return DownloadedSource(
            SourceV1.model_validate(data["source"]), directory / "media.mp4", data["snapshot"]
        )

    @_validated
    def save_transcript(self, media_id: str, source: AcquiredSource, quality: Quality) -> str:
        validate_transcript(source)
        parent = self.load_media(media_id)
        if (
            parent.source != source.source
            or parent.source_snapshot_ref != source.source_snapshot_ref
        ):
            raise _failure("artifact_parent_mismatch")
        return self._commit(
            "transcript",
            {
                "media_id": media_id,
                "quality": quality,
                "transcript": asdict(source.transcript),
                "reviews": [asdict(r) for r in source.reviews],
            },
        )

    @_validated
    def load_transcript(self, identity: str) -> tuple[AcquiredSource, Quality]:
        data, _ = self._load(identity, "transcript")
        media = self.load_media(data["media_id"])
        transcript = TypeAdapter(TranscriptResult).validate_json(
            json.dumps(data["transcript"]), strict=True
        )
        reviews = TypeAdapter(tuple[AudioReview, ...]).validate_json(
            json.dumps(data["reviews"]), strict=True
        )
        quality: Quality = TypeAdapter(Quality).validate_python(data["quality"], strict=True)
        source = AcquiredSource(
            media.source, media.media_path, transcript, media.source_snapshot_ref, reviews
        )
        validate_transcript(source)
        return source, quality

    @_validated
    def save_frames(self, transcript_id: str, frames: tuple[FrameAsset, ...]) -> str:
        validate_frames(frames)
        source, _ = self.load_transcript(transcript_id)
        validate_frame_bindings(source, frames)
        rows = [{k: v for k, v in asdict(f).items() if k != "png_bytes"} for f in frames]
        return self._commit(
            "frames", {"transcript_id": transcript_id, "frames": rows}, frames=frames
        )

    @_validated
    def load_frames(self, identity: str) -> tuple[AcquiredSource, Quality, tuple[FrameAsset, ...]]:
        data, directory = self._load(identity, "frames")
        source, quality = self.load_transcript(data["transcript_id"])
        if not isinstance(data["frames"], list) or not 2 <= len(data["frames"]) <= 48:
            raise _failure("artifact_frames_invalid")
        for row in data["frames"]:
            if (
                not isinstance(row, dict)
                or not isinstance(row.get("frame_id"), str)
                or not re.fullmatch(r"F[0-9]{2}", row["frame_id"])
            ):
                raise _failure("artifact_frames_invalid")
        frames = tuple(
            FrameAsset(
                **{
                    **row,
                    "transcript_refs": tuple(row["transcript_refs"]),
                    "png_bytes": _regular(directory / (row["frame_id"] + ".png"), FRAME_PNG_BYTES),
                }
            )
            for row in data["frames"]
        )
        validate_frames(frames)
        validate_frame_bindings(source, frames)
        return source, quality, frames

    @_validated
    def frame_paths(self, identity: str) -> tuple[str, ...]:
        _, _, frames = self.load_frames(identity)
        return tuple(str(self.root / identity / (frame.frame_id + ".png")) for frame in frames)
