"""Public HTTPS admission; network adapters additionally validate every resolved address."""

from __future__ import annotations

import hashlib
import ipaddress
import re
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

from .url_policy import InvalidBilibiliUrl


@dataclass(frozen=True, slots=True)
class ValidatedGenericUrl:
    requested_url: str
    clean_url: str
    video_id: str

    def canonical_url(self, part_index: int = 1) -> str:
        if part_index != 1:
            raise ValueError("generic_part_invalid")
        return self.clean_url


def validate_generic_url(url: str) -> ValidatedGenericUrl:
    if (
        not isinstance(url, str)
        or not url
        or len(url) > 2048
        or not url.isascii()
        or any(ord(c) <= 32 or ord(c) == 127 for c in url)
        or any(c in url for c in '\\<>"`')
        or re.search(r"%(?![0-9a-fA-F]{2})|%(?:0[0-9a-fA-F]|1[0-9a-fA-F]|7[fF])", url)
    ):
        raise InvalidBilibiliUrl("INVALID_URL", "url_text_invalid")
    try:
        p = urlsplit(url)
        host = p.hostname or ""
        if (
            p.scheme != "https"
            or p.port not in (None, 443)
            or p.username is not None
            or p.password is not None
            or p.fragment
            or not re.fullmatch(
                r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+",
                host,
            )
            or host.endswith((".localhost", ".local", ".internal", ".test", ".invalid"))
        ):
            raise ValueError("authority")
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            raise ValueError("ip_literal")
    except ValueError as e:
        raise InvalidBilibiliUrl("UNSUPPORTED_URL", "generic_url_unsupported") from e
    clean = urlunsplit(("https", host, p.path or "/", p.query, ""))
    return ValidatedGenericUrl(url, clean, "web-" + hashlib.sha256(clean.encode()).hexdigest())
