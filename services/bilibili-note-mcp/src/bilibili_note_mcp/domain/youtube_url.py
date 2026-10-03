from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlsplit

from .url_policy import InvalidBilibiliUrl

VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}\Z")
_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}


@dataclass(frozen=True, slots=True)
class ValidatedYoutubeUrl:
    requested_url: str
    video_id: str

    def canonical_url(self, part_index: int = 1) -> str:
        if part_index != 1:
            raise ValueError("youtube_part_invalid")
        return f"https://www.youtube.com/watch?v={self.video_id}"


def validate_youtube_url(url: str) -> ValidatedYoutubeUrl:
    if (
        not isinstance(url, str)
        or not url
        or len(url) > 2048
        or not url.isascii()
        or any(ord(c) <= 32 or ord(c) == 127 for c in url)
    ):
        raise InvalidBilibiliUrl("INVALID_URL", "url_text_invalid")
    try:
        parts = urlsplit(url)
        authority = parts.netloc.removesuffix(":443")
        if parts.scheme != "https" or authority not in _HOSTS or parts.port not in (None, 443):
            raise InvalidBilibiliUrl("UNSUPPORTED_URL", "url_authority_unsupported")
        if parts.fragment or parts.username or parts.password or "%" in parts.path:
            raise InvalidBilibiliUrl("INVALID_URL", "url_resource_invalid")
        pairs = parse_qsl(
            parts.query,
            keep_blank_values=True,
            strict_parsing=True,
            encoding="ascii",
            errors="strict",
        )
    except (ValueError, UnicodeError) as e:
        if isinstance(e, InvalidBilibiliUrl):
            raise
        raise InvalidBilibiliUrl("INVALID_URL", "url_syntax_invalid") from e
    query: dict[str, str] = {}
    for key, value in pairs:
        if key in query or not value or len(value) > 128:
            raise InvalidBilibiliUrl("INVALID_URL", "url_query_invalid")
        if key not in {"v", "t", "start", "si", "feature"}:
            raise InvalidBilibiliUrl("UNSUPPORTED_URL", "url_query_unsupported")
        if key in {"t", "start"} and not re.fullmatch(r"(?:[0-9]+[hms]?){1,3}", value):
            raise InvalidBilibiliUrl("INVALID_URL", "url_time_invalid")
        query[key] = value
    if authority == "youtu.be":
        video_id = parts.path.removeprefix("/")
        if "v" in query:
            raise InvalidBilibiliUrl("INVALID_URL", "url_query_invalid")
    elif parts.path == "/watch":
        video_id = query.get("v", "")
    elif parts.path.startswith("/shorts/"):
        video_id = parts.path.removeprefix("/shorts/")
        if "v" in query:
            raise InvalidBilibiliUrl("INVALID_URL", "url_query_invalid")
    else:
        raise InvalidBilibiliUrl("UNSUPPORTED_URL", "url_resource_unsupported")
    if not VIDEO_ID.fullmatch(video_id):
        raise InvalidBilibiliUrl("UNSUPPORTED_URL", "url_video_identity_invalid")
    return ValidatedYoutubeUrl(url, video_id)
