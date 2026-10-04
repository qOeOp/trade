from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit

_VIDEO_PATH = re.compile(r"^/video/(?P<video_id>BV[0-9A-Za-z]{10})/?$")
_ALLOWED_AUTHORITIES = {
    "www.bilibili.com",
    "www.bilibili.com:443",
    "bilibili.com",
    "bilibili.com:443",
}
_TRACKING_KEYS = {"spm_id_from"}


class InvalidBilibiliUrl(ValueError):
    def __init__(self, code: Literal["INVALID_URL", "UNSUPPORTED_URL"], reason: str) -> None:
        super().__init__(reason)
        self.code = code
        self.reason = reason


@dataclass(frozen=True, slots=True)
class ValidatedBilibiliUrl:
    requested_url: str
    clean_url: str
    video_id: str
    requested_part: int | None

    def canonical_url(self, part_index: int) -> str:
        return f"https://www.bilibili.com/video/{self.video_id}?{urlencode({'p': part_index})}"


def validate_bilibili_url(url: str) -> ValidatedBilibiliUrl:
    if not isinstance(url, str) or not url or len(url.encode("utf-8")) > 2048:
        raise InvalidBilibiliUrl("INVALID_URL", "url_size_invalid")
    if url != url.strip() or any(unicodedata.category(character) == "Cc" for character in url):
        raise InvalidBilibiliUrl("INVALID_URL", "url_text_invalid")
    try:
        url.encode("ascii")
        parts = urlsplit(url)
        port = parts.port
    except (UnicodeEncodeError, ValueError) as e:
        raise InvalidBilibiliUrl("INVALID_URL", "url_syntax_invalid") from e
    if (
        parts.scheme != "https"
        or parts.netloc not in _ALLOWED_AUTHORITIES
        or port not in {None, 443}
    ):
        raise InvalidBilibiliUrl("UNSUPPORTED_URL", "url_authority_unsupported")
    if parts.username is not None or parts.password is not None or parts.fragment:
        raise InvalidBilibiliUrl("INVALID_URL", "url_authority_invalid")
    if "%" in parts.path or _VIDEO_PATH.fullmatch(parts.path) is None:
        raise InvalidBilibiliUrl("UNSUPPORTED_URL", "url_resource_unsupported")
    match = _VIDEO_PATH.fullmatch(parts.path)
    assert match is not None
    try:
        pairs = parse_qsl(
            parts.query,
            keep_blank_values=True,
            strict_parsing=True,
            encoding="ascii",
            errors="strict",
            separator="&",
        )
    except (UnicodeDecodeError, ValueError) as e:
        raise InvalidBilibiliUrl("INVALID_URL", "url_query_invalid") from e
    seen: set[str] = set()
    requested_part: int | None = None
    for key, value in pairs:
        if not key or key in seen:
            raise InvalidBilibiliUrl("INVALID_URL", "url_query_duplicate")
        seen.add(key)
        if key == "p":
            if not value.isascii() or not value.isdecimal() or value.startswith("0"):
                raise InvalidBilibiliUrl("INVALID_URL", "url_part_invalid")
            requested_part = int(value)
            if requested_part < 1:
                raise InvalidBilibiliUrl("INVALID_URL", "url_part_invalid")
        elif key in _TRACKING_KEYS:
            if not 1 <= len(value.encode("ascii", errors="ignore")) <= 128 or not value.isascii():
                raise InvalidBilibiliUrl("INVALID_URL", "url_tracking_invalid")
        else:
            raise InvalidBilibiliUrl("UNSUPPORTED_URL", "url_query_unsupported")
    video_id = match.group("video_id")
    clean_url = f"https://www.bilibili.com/video/{video_id}"
    if requested_part is not None:
        clean_url += f"?{urlencode({'p': requested_part})}"
    return ValidatedBilibiliUrl(
        requested_url=url,
        clean_url=clean_url,
        video_id=video_id,
        requested_part=requested_part,
    )
