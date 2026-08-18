from __future__ import annotations

BILIBILI_BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)


def bilibili_browser_headers(*, referer: str) -> dict[str, str]:
    return {"User-Agent": BILIBILI_BROWSER_USER_AGENT, "Referer": referer}
