from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast
from urllib.parse import urlencode

from video_note_mcp.adapters.bilibili_http import (
    bilibili_browser_headers,
    raise_named_envelope_refusal,
)
from video_note_mcp.adapters.egress import SafeHttpClient
from video_note_mcp.adapters.source_acquisition import SourceAcquisition
from video_note_mcp.adapters.source_cache import SourceCache
from video_note_mcp.application.errors import BilibiliNoteFailure
from video_note_mcp.application.ports import AcquiredSource, SourceMediaPort, TranscriptPort
from video_note_mcp.application.progress import (
    ProgressReporter,
)
from video_note_mcp.application.resource_limits import (
    MEDIA_SOURCE_MAX_PIXELS,
    MEDIA_SOURCE_MAX_SIDE,
)
from video_note_mcp.domain.models import MAX_SOURCE_DURATION_MS, FailureCode, SourceV1
from video_note_mcp.domain.url_policy import InvalidBilibiliUrl, validate_bilibili_url


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
        cache: SourceCache | None = None,
    ) -> None:
        self._acquisition = SourceAcquisition(transcript, media, cache)
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
            f"https://api.bilibili.com/x/web-interface/wbi/view?{query}", headers=headers
        )
        code = envelope.get("code")
        if not isinstance(code, int) or isinstance(code, bool):
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "source_metadata_invalid")
        if code != 0:
            raise_named_envelope_refusal(code)
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
        return await self._acquisition.acquire(
            source, width, height, {"cid": cid}, workspace, progress
        )
