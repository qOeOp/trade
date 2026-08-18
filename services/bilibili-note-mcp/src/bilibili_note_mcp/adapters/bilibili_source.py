from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast
from urllib.parse import urlencode

from bilibili_note_mcp.adapters.bilibili_http import bilibili_browser_headers
from bilibili_note_mcp.adapters.egress import SafeHttpClient
from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.application.ports import AcquiredSource, SourceMediaPort, TranscriptPort
from bilibili_note_mcp.application.progress import (
    ProgressReporter,
    ProgressStageV1,
    progress_update,
)
from bilibili_note_mcp.application.resource_limits import (
    MEDIA_SOURCE_MAX_PIXELS,
    MEDIA_SOURCE_MAX_SIDE,
)
from bilibili_note_mcp.domain.models import MAX_SOURCE_DURATION_MS, FailureCode, SourceV1
from bilibili_note_mcp.domain.refs import source_snapshot_ref
from bilibili_note_mcp.domain.url_policy import InvalidBilibiliUrl, validate_bilibili_url


def _mapping(value: object, reason: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", reason)
    return cast(dict[str, Any], value)


def _sequence(value: object, reason: str) -> list[Any]:
    if not isinstance(value, list):
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", reason)
    return value


def _integer(
    value: object,
    reason: str,
    *,
    minimum: int | None = None,
    maximum: int | None = None,
) -> int:
    if (
        not isinstance(value, int)
        or isinstance(value, bool)
        or (minimum is not None and value < minimum)
        or (maximum is not None and value > maximum)
    ):
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", reason)
    return value


def _text(value: object, reason: str) -> str:
    if not isinstance(value, str):
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", reason)
    return value


class BilibiliSource:
    def __init__(
        self,
        transcript: TranscriptPort,
        media: SourceMediaPort,
        http: SafeHttpClient | None = None,
    ) -> None:
        self._transcript = transcript
        self._media = media
        self._http = http or SafeHttpClient()

    async def acquire(
        self, url: str, workspace: Path, progress: ProgressReporter
    ) -> AcquiredSource:
        try:
            validated = validate_bilibili_url(url)
        except InvalidBilibiliUrl as e:
            raise BilibiliNoteFailure(cast(FailureCode, e.code), e.reason) from e
        headers = bilibili_browser_headers(referer=validated.clean_url)
        query = urlencode({"bvid": validated.video_id})
        envelope = await self._http.get_json(
            f"https://api.bilibili.com/x/web-interface/view?{query}", headers=headers
        )
        code = envelope.get("code")
        if not isinstance(code, int) or isinstance(code, bool):
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "source_metadata_invalid")
        if code != 0:
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "source_metadata_rejected")
        data = _mapping(envelope.get("data"), "source_metadata_invalid")
        video_id = _text(data.get("bvid"), "source_metadata_invalid")
        if video_id != validated.video_id:
            raise BilibiliNoteFailure("SOURCE_CHANGED", "source_video_identity_changed")
        pages = _sequence(data.get("pages"), "source_parts_invalid")
        if not pages:
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "source_parts_empty")
        if validated.requested_part is None and len(pages) > 1:
            raise BilibiliNoteFailure("PART_REQUIRED", "source_part_required")
        part_index = validated.requested_part or 1
        if part_index > len(pages):
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "source_part_out_of_range")
        page = _mapping(pages[part_index - 1], "source_part_invalid")
        if _integer(page.get("page"), "source_part_invalid", minimum=1) != part_index:
            raise BilibiliNoteFailure("SOURCE_CHANGED", "source_part_identity_changed")
        try:
            cid = _integer(
                page.get("cid"),
                "source_metadata_invalid",
                minimum=1,
                maximum=(1 << 63) - 1,
            )
            duration_seconds = _integer(
                page.get("duration"),
                "source_metadata_invalid",
                minimum=1,
            )
            duration_ms = duration_seconds * 1000
            if duration_ms > MAX_SOURCE_DURATION_MS:
                raise BilibiliNoteFailure(
                    "SOURCE_UNAVAILABLE", "source_duration_exceeds_supported_limit"
                )
            dimension_value = page.get("dimension")
            if dimension_value is None:
                dimension_value = data.get("dimension")
            dimension = _mapping(dimension_value, "dimension_invalid")
            width = _integer(
                dimension.get("width"),
                "dimension_invalid",
                minimum=1,
                maximum=MEDIA_SOURCE_MAX_SIDE,
            )
            height = _integer(
                dimension.get("height"),
                "dimension_invalid",
                minimum=1,
                maximum=MEDIA_SOURCE_MAX_SIDE,
            )
            owner = _mapping(data["owner"], "source_owner_invalid")
            title = _text(data.get("title"), "source_metadata_invalid")
            author_name = _text(owner.get("name"), "source_owner_invalid")
            published_seconds = _integer(
                data.get("pubdate"),
                "source_metadata_invalid",
                minimum=1,
                maximum=253_402_300_799,
            )
            source = SourceV1(
                platform="bilibili",
                requested_url=validated.requested_url,
                canonical_url=validated.canonical_url(part_index),
                video_id=video_id,
                part_id=str(cid),
                part_index=part_index,
                title=title,
                author_name=author_name,
                published_at=datetime.fromtimestamp(published_seconds, UTC)
                .isoformat()
                .replace("+00:00", "Z"),
                duration_ms=duration_ms,
            )
        except (KeyError, OSError, OverflowError, TypeError, ValueError) as e:
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "source_metadata_invalid") from e
        if (
            width * height < 1280 * 720
            or width * height > MEDIA_SOURCE_MAX_PIXELS
            or min(width, height) < 720
        ):
            raise BilibiliNoteFailure("HD_SOURCE_UNAVAILABLE", "source_below_hd_floor")
        media = await self._media.download(source.canonical_url, workspace)
        if (
            media.upstream_video_id != source.video_id
            or media.upstream_part_index != source.part_index
        ):
            raise BilibiliNoteFailure("SOURCE_CHANGED", "media_video_identity_changed")
        if (
            media.width * media.height < 1280 * 720
            or media.width * media.height > MEDIA_SOURCE_MAX_PIXELS
            or max(media.width, media.height) > MEDIA_SOURCE_MAX_SIDE
            or min(media.width, media.height) < 720
        ):
            raise BilibiliNoteFailure("HD_SOURCE_UNAVAILABLE", "source_below_hd_floor")
        duration_delta = media.observed_duration_ms - source.duration_ms
        if duration_delta < -2000:
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "media_access_restricted_preview")
        if abs(duration_delta) > 2000:
            raise BilibiliNoteFailure("SOURCE_CHANGED", "media_duration_changed")
        await progress.report(progress_update(ProgressStageV1.MEDIA_READY))
        transcript = await self._transcript.transcribe(
            media.media_path, duration_ms, workspace, progress
        )
        snapshot = {
            "source": source.model_dump(mode="json", by_alias=True),
            "cid": cid,
            "declared_dimensions": [width, height],
            "observed_dimensions": [media.width, media.height],
            "observed_duration_ms": media.observed_duration_ms,
            "media_sha256": media.media_sha256,
            "format_id": media.format_id,
            "adapter": media.adapter_ref,
        }
        return AcquiredSource(
            source=source,
            media_path=media.media_path,
            transcript=transcript,
            source_snapshot_ref=source_snapshot_ref(snapshot),
        )
