from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from bilibili_note_mcp.adapters.bilibili_media_ytdlp import (
    _media_candidates,
    _probe,
    _run_worker,
    _sha256_file,
    _worker_environment,
)
from bilibili_note_mcp.adapters.egress import admitted_loopback_proxy
from bilibili_note_mcp.adapters.source_acquisition import SourceAcquisition
from bilibili_note_mcp.adapters.source_cache import SourceCache
from bilibili_note_mcp.adapters.strict_json import StrictJsonError, decode_strict_json_object
from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.application.ports import AcquiredSource, SourceMediaArtifact, TranscriptPort
from bilibili_note_mcp.application.progress import ProgressReporter
from bilibili_note_mcp.application.resource_limits import (
    MEDIA_SOURCE_MAX_PIXELS,
    MEDIA_SOURCE_MAX_SIDE,
)
from bilibili_note_mcp.domain.models import SearchCandidateV1, SourceV1
from bilibili_note_mcp.domain.youtube_url import validate_youtube_url

_SCHEMA = "video-note-youtube-worker/v1"


class YoutubeExtractor:
    def __init__(self) -> None:
        self.proxy = admitted_loopback_proxy(
            os.environ.get(
                "BILIBILI_NOTE_MEDIA_PROXY", os.environ.get("BILIBILI_NOTE_EGRESS_PROXY")
            )
        )

    async def request(
        self, operation: str, value: str, workspace: Path | None = None, limit: int = 1
    ) -> dict[str, Any]:
        payload = {
            "schema": _SCHEMA,
            "operation": operation,
            "value": value,
            "limit": limit,
            "workspace": str(workspace) if workspace else None,
            "proxy": self.proxy,
        }
        code, raw = await _run_worker(
            (sys.executable, "-m", "bilibili_note_mcp.adapters._youtube_worker"),
            json.dumps(payload).encode(),
            timeout_seconds=360 if operation == "media" else 90,
            grace_seconds=2,
            env=_worker_environment(),
        )
        try:
            result = decode_strict_json_object(raw)
            if code != 0 or result.get("schema") != _SCHEMA or result.get("ok") is not True:
                raise ValueError("youtube_worker_failed")
            key = "candidates" if operation == "search" else "metadata"
            if set(result) != {"schema", "ok", key}:
                raise ValueError("youtube_worker_receipt_invalid")
            return result
        except (ValueError, StrictJsonError) as e:
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "youtube_acquisition_failed") from e

    async def download(self, canonical_url: str, workspace: Path) -> SourceMediaArtifact:
        result = await self.request("media", canonical_url, workspace)
        source = source_metadata(result["metadata"], canonical_url)
        files = await asyncio.to_thread(_media_candidates, workspace)
        if len(files) != 1:
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "downloaded_media_ambiguous")
        path = files[0]
        duration, width, height = await _probe(path)
        return SourceMediaArtifact(
            media_path=path,
            media_sha256=await asyncio.to_thread(_sha256_file, path),
            observed_duration_ms=duration,
            width=width,
            height=height,
            upstream_video_id=source.video_id,
            upstream_part_index=1,
            format_id=result["metadata"]["format_id"],
            adapter_ref="yt-dlp/youtube",
        )


def source_metadata(data: Any, requested_url: str) -> SourceV1:
    try:
        parsed = validate_youtube_url(requested_url)
        if not isinstance(data, dict) or set(data) != {
            "id",
            "title",
            "author",
            "date",
            "duration_ms",
            "width",
            "height",
            "format_id",
        }:
            raise ValueError("youtube_metadata_invalid")
        width, height = data["width"], data["height"]
        if (
            type(width) is not int
            or type(height) is not int
            or min(width, height) < 720
            or max(width, height) > MEDIA_SOURCE_MAX_SIDE
            or not 1280 * 720 <= width * height <= MEDIA_SOURCE_MAX_PIXELS
        ):
            raise BilibiliNoteFailure("HD_SOURCE_UNAVAILABLE", "source_below_hd_floor")
        if not isinstance(data["format_id"], str) or not 1 <= len(data["format_id"]) <= 100:
            raise ValueError("youtube_format_invalid")
        if not isinstance(data["date"], str) or len(data["date"]) != 8:
            raise ValueError("youtube_date_invalid")
        date = datetime.strptime(data["date"], "%Y%m%d").replace(tzinfo=UTC)
        return SourceV1(
            platform="youtube",
            requested_url=requested_url,
            canonical_url=parsed.canonical_url(),
            video_id=data["id"],
            part_id=data["id"],
            part_index=1,
            title=data["title"],
            author_name=data["author"],
            published_at=date.isoformat().replace("+00:00", "Z"),
            duration_ms=data["duration_ms"],
        )
    except (KeyError, TypeError, ValueError, ValidationError) as e:
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "youtube_metadata_invalid") from e


class YoutubeSource:
    def __init__(
        self,
        transcript: TranscriptPort,
        cache: SourceCache | None = None,
        extractor: YoutubeExtractor | None = None,
    ) -> None:
        self.extractor = extractor or YoutubeExtractor()
        self.acquisition = SourceAcquisition(transcript, self.extractor, cache)

    async def acquire(
        self, url: str, workspace: Path, progress: ProgressReporter
    ) -> AcquiredSource:
        canonical = validate_youtube_url(url).canonical_url()
        data = (await self.extractor.request("metadata", canonical))["metadata"]
        source = source_metadata(data, url)
        return await self.acquisition.acquire(
            source,
            data["width"],
            data["height"],
            {"youtube_id": source.video_id},
            workspace,
            progress,
        )


class YoutubeSearch:
    def __init__(self, extractor: YoutubeExtractor | None = None) -> None:
        self.extractor = extractor or YoutubeExtractor()

    async def search(self, query: str, limit: int) -> tuple[SearchCandidateV1, ...]:
        rows = (await self.extractor.request("search", query, limit=limit))["candidates"]
        try:
            if not isinstance(rows, list) or len(rows) > limit:
                raise ValueError("youtube_search_invalid")
            candidates = tuple(SearchCandidateV1.model_validate(r) for r in rows)
            if any(len(c.video_id) != 11 for c in candidates):
                raise ValueError("youtube_search_platform_invalid")
        except (ValueError, ValidationError) as e:
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "youtube_search_invalid") from e
        unique = tuple({c.video_id: c for c in candidates}.values())
        if not unique:
            raise BilibiliNoteFailure("SEARCH_EMPTY", "search_no_usable_results")
        return unique
