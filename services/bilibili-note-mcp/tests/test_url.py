from __future__ import annotations

import pytest

from bilibili_note_mcp.domain.url_policy import InvalidBilibiliUrl, validate_bilibili_url

USER_URL = "https://www.bilibili.com/video/BV1uHuQ6pEFr/?spm_id_from=333.337.search-card.all.click"


def test_exact_acceptance_url_is_admitted_and_tracking_is_not_fetched() -> None:
    value = validate_bilibili_url(USER_URL)

    assert value.requested_url == USER_URL
    assert value.clean_url == "https://www.bilibili.com/video/BV1uHuQ6pEFr"
    assert value.video_id == "BV1uHuQ6pEFr"
    assert value.requested_part is None
    assert value.canonical_url(1) == "https://www.bilibili.com/video/BV1uHuQ6pEFr?p=1"


@pytest.mark.parametrize(
    "url",
    [
        "http://www.bilibili.com/video/BV1bK411W797",
        "https://b23.tv/example",
        "https://www.bilibili.com/video/av170001",
        "https://www.bilibili.com/video/BV1bK411W797?from=search",
        "https://www.bilibili.com/video/BV1bK411W797?p=1&p=2",
        "https://www.bilibili.com:444/video/BV1bK411W797",
        "https://user@www.bilibili.com/video/BV1bK411W797",
        "https://www.bilibili.com/video/BV1bK411W797#fragment",
        "https://evil.example/video/BV1bK411W797",
        " https://www.bilibili.com/video/BV1bK411W797",
    ],
)
def test_noncanonical_or_unsafe_url_is_rejected(url: str) -> None:
    with pytest.raises(InvalidBilibiliUrl):
        validate_bilibili_url(url)
