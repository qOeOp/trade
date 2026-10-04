from __future__ import annotations

from urllib.parse import urlsplit

from .generic_url import ValidatedGenericUrl, validate_generic_url
from .url_policy import ValidatedBilibiliUrl, validate_bilibili_url
from .youtube_url import ValidatedYoutubeUrl, validate_youtube_url


def validate_video_url(
    url: str,
) -> ValidatedBilibiliUrl | ValidatedYoutubeUrl | ValidatedGenericUrl:
    # Each adapter's exact grammar still owns admission; this only selects that grammar.
    try:
        host = urlsplit(url).hostname
    except ValueError:
        host = None
    if host in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}:
        return validate_youtube_url(url)
    if host in {"bilibili.com", "www.bilibili.com"}:
        return validate_bilibili_url(url)
    return validate_generic_url(url)
