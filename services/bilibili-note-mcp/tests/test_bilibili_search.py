from __future__ import annotations

from collections.abc import Mapping
from typing import Any, cast

import pytest

from bilibili_note_mcp.adapters.bilibili_http import BILIBILI_BROWSER_USER_AGENT
from bilibili_note_mcp.adapters.bilibili_search import BilibiliSearch
from bilibili_note_mcp.adapters.egress import SafeHttpClient
from bilibili_note_mcp.application.errors import BilibiliNoteFailure


class FakeHttp:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload
        self.calls: list[tuple[str, Mapping[str, str] | None]] = []

    async def get_json(
        self, url: str, *, headers: Mapping[str, str] | None = None
    ) -> dict[str, Any]:
        self.calls.append((url, headers))
        return self.payload


async def test_search_preserves_api_order_deduplicates_and_cleans_highlights() -> None:
    http = FakeHttp(
        {
            "code": 0,
            "data": {
                "result": [
                    {
                        "type": "video",
                        "bvid": "BV1uHuQ6pEFr",
                        "title": '<em class="keyword">趋势</em>交易 &amp; 风控',
                    },
                    {
                        "type": "video",
                        "bvid": "BV1uHuQ6pEFr",
                        "title": "duplicate",
                    },
                    {"type": "article", "bvid": "BV1j6um69EJn", "title": "wrong type"},
                    {
                        "type": "video",
                        "bvid": "BV1j6um69EJn",
                        "title": "支撑阻力实战",
                        "tag": "趋势,交易",
                    },
                ]
            },
        }
    )

    result = await BilibiliSearch(cast(SafeHttpClient, http)).search("趋势 交易", 2)

    assert [item.video_id for item in result] == ["BV1uHuQ6pEFr", "BV1j6um69EJn"]
    assert result[0].title == "趋势交易 & 风控"
    assert result[0].canonical_url == "https://www.bilibili.com/video/BV1uHuQ6pEFr?p=1"
    assert "keyword=%E8%B6%8B%E5%8A%BF+%E4%BA%A4%E6%98%93" in http.calls[0][0]
    assert "order=pubdate" in http.calls[0][0]
    assert "/x/web-interface/wbi/search/type?" in http.calls[0][0]
    assert http.calls[0][1] is not None
    assert http.calls[0][1]["Referer"] == "https://search.bilibili.com/"
    assert http.calls[0][1]["User-Agent"] == BILIBILI_BROWSER_USER_AGENT
    assert "Origin" not in http.calls[0][1]


async def test_search_prioritizes_query_match_across_author_and_metadata() -> None:
    http = FakeHttp(
        {
            "code": 0,
            "data": {
                "result": [
                    {
                        "type": "video",
                        "bvid": "BV1JEgw6NEjw",
                        "title": "比特币小周期继续下行",
                        "author": "罗尼交易指南-官方",
                        "pubdate": 100,
                    },
                    {
                        "type": "video",
                        "bvid": "BV1nDgE67EUC",
                        "title": "鲜哥缠论：比特币与以太坊",
                        "author": "鲜哥缠论",
                        "tag": "趋势体系,交易,支撑压力",
                    },
                    {
                        "type": "video",
                        "bvid": "BV1Pygn6FEJP",
                        "title": "BNB阻力位如期下行",
                        "author": "罗尼交易指南-官方",
                        "pubdate": 200,
                    },
                ]
            },
        }
    )

    result = await BilibiliSearch(cast(SafeHttpClient, http)).search("罗尼交易指南", 2)

    assert [item.video_id for item in result] == ["BV1Pygn6FEJP", "BV1JEgw6NEjw"]
    assert result[0].published_at == 200
    assert result[0].author_name == "罗尼交易指南-官方"


async def test_exact_creator_is_ranked_before_newer_extended_account() -> None:
    http = FakeHttp(
        {
            "code": 0,
            "data": {
                "result": [
                    {
                        "type": "video",
                        "bvid": "BV1Gvuj6dENb",
                        "title": "指尖内部精修课程",
                        "author": "指尖金汇-黄金",
                        "pubdate": 300,
                    },
                    {
                        "type": "video",
                        "bvid": "BV1VSGo6JE98",
                        "title": "黄金公开行情",
                        "author": "指尖金汇",
                        "pubdate": 100,
                    },
                ]
            },
        }
    )

    result = await BilibiliSearch(cast(SafeHttpClient, http)).search("指尖金汇", 2)

    assert [item.video_id for item in result] == ["BV1VSGo6JE98", "BV1Gvuj6dENb"]


async def test_exact_creator_is_ranked_before_unrelated_suffix_account() -> None:
    http = FakeHttp(
        {
            "code": 0,
            "data": {
                "result": [
                    {
                        "type": "video",
                        "bvid": "BV1Gvuj6dENb",
                        "title": "风险曝光",
                        "author": "指尖金汇-反诈曝光",
                    },
                    {
                        "type": "video",
                        "bvid": "BV1VSGo6JE98",
                        "title": "黄金公开行情",
                        "author": "指尖金汇-官方",
                    },
                ]
            },
        }
    )

    result = await BilibiliSearch(cast(SafeHttpClient, http)).search("指尖金汇", 2)

    assert [item.video_id for item in result] == ["BV1VSGo6JE98", "BV1Gvuj6dENb"]


async def test_exact_author_match_does_not_discard_other_topic_results() -> None:
    http = FakeHttp(
        {
            "code": 0,
            "data": {
                "result": [
                    {
                        "type": "video",
                        "bvid": "BV1VSGo6JE98",
                        "title": "专题作者的新观点",
                        "author": "专题作者",
                        "pubdate": 100,
                    },
                    {
                        "type": "video",
                        "bvid": "BV1Gvuj6dENb",
                        "title": "专题作者：跨作者评述",
                        "author": "其他作者",
                        "pubdate": 200,
                    },
                ]
            },
        }
    )

    result = await BilibiliSearch(cast(SafeHttpClient, http)).search("专题作者", 2)

    assert [item.video_id for item in result] == ["BV1VSGo6JE98", "BV1Gvuj6dENb"]


async def test_exact_author_is_only_a_tiebreak_after_topic_relevance_before_limit() -> None:
    exact_author_rows = [
        {
            "type": "video",
            "bvid": f"BV1{index:09d}",
            "title": "日常更新",
            "author": "专题作者",
            "pubdate": 200 - index,
        }
        for index in range(9)
    ]
    strongest_topic_row = {
        "type": "video",
        "bvid": "BV1999999999",
        "title": "专题作者深度研究",
        "author": "独立研究员",
        "tag": "专题作者",
        "description": "专题作者完整方法",
        "pubdate": 1,
    }
    http = FakeHttp(
        {
            "code": 0,
            "data": {"result": [*exact_author_rows, strongest_topic_row]},
        }
    )

    result = await BilibiliSearch(cast(SafeHttpClient, http)).search("专题作者", 9)

    assert result[0].video_id == "BV1999999999"
    assert len(result) == 9
    assert "BV1000000008" not in {item.video_id for item in result}


async def test_search_prioritizes_multi_concept_title_without_exact_author() -> None:
    http = FakeHttp(
        {
            "code": 0,
            "data": {
                "result": [
                    {
                        "type": "video",
                        "bvid": "BV1nDgE67EUC",
                        "title": "市场复盘",
                        "tag": "趋势体系,交易",
                    },
                    {
                        "type": "video",
                        "bvid": "BV1uHuQ6pEFr",
                        "title": "趋势交易：支撑阻力实战",
                    },
                    {
                        "type": "video",
                        "bvid": "BV1j6um69EJn",
                        "title": "趋势交易与支撑阻力基础",
                    },
                ]
            },
        }
    )

    result = await BilibiliSearch(cast(SafeHttpClient, http)).search("趋势交易 支撑阻力", 2)

    assert [item.video_id for item in result] == ["BV1uHuQ6pEFr", "BV1j6um69EJn"]


async def test_multi_unit_query_cannot_form_units_across_field_boundaries() -> None:
    http = FakeHttp(
        {
            "code": 0,
            "data": {
                "result": [
                    {
                        "type": "video",
                        "bvid": "BV1uHuQ6pEFr",
                        "title": "甲",
                        "author": "乙",
                        "tag": "丙",
                        "description": "丁",
                    }
                ]
            },
        }
    )

    with pytest.raises(BilibiliNoteFailure) as caught:
        await BilibiliSearch(cast(SafeHttpClient, http)).search("甲乙 丙丁", 1)

    assert caught.value.code == "SEARCH_EMPTY"
    assert caught.value.reason == "search_no_usable_results"


async def test_multi_unit_query_can_match_whole_units_in_different_fields() -> None:
    http = FakeHttp(
        {
            "code": 0,
            "data": {
                "result": [
                    {
                        "type": "video",
                        "bvid": "BV1uHuQ6pEFr",
                        "title": "甲乙讲解",
                        "tag": "丙丁实战",
                    }
                ]
            },
        }
    )

    result = await BilibiliSearch(cast(SafeHttpClient, http)).search("甲乙 丙丁", 1)

    assert [item.video_id for item in result] == ["BV1uHuQ6pEFr"]


async def test_compact_creator_query_uses_one_generic_request_and_rejects_homonym() -> None:
    http = FakeHttp(
        {
            "code": 0,
            "data": {
                "result": [
                    {
                        "type": "video",
                        "bvid": "BV1kqgZ6bEB2",
                        "title": "非泼罗尼猫咪驱虫避坑指南",
                        "author": "宠知档案",
                    },
                    {
                        "type": "video",
                        "bvid": "BV1JEgw6NEjw",
                        "title": "比特币小周期继续下行",
                        "author": "罗尼交易指南-官方",
                    },
                    {
                        "type": "video",
                        "bvid": "BV1Pygn6FEJP",
                        "title": "BNB阻力位如期下行",
                        "author": "罗尼交易指南-官方",
                    },
                ]
            },
        }
    )
    result = await BilibiliSearch(cast(SafeHttpClient, http)).search("罗尼交易指南", 2)

    assert [item.video_id for item in result] == ["BV1JEgw6NEjw", "BV1Pygn6FEJP"]
    assert len(http.calls) == 1
    assert "keyword=%E7%BD%97%E5%B0%BC%E4%BA%A4%E6%98%93%E6%8C%87%E5%8D%97" in http.calls[0][0]


@pytest.mark.parametrize(
    "irrelevant_title",
    (
        "非泼罗尼交易指南：宠物驱虫药如何购买",
        "罗尼交易指南针：宠物驱虫药如何购买",
    ),
)
async def test_search_fails_closed_when_compact_query_lacks_both_boundaries(
    irrelevant_title: str,
) -> None:
    http = FakeHttp(
        {
            "code": 0,
            "data": {
                "result": [
                    {
                        "type": "video",
                        "bvid": "BV1kqgZ6bEB2",
                        "title": irrelevant_title,
                        "author": "宠知档案",
                    }
                ]
            },
        }
    )

    with pytest.raises(BilibiliNoteFailure) as caught:
        await BilibiliSearch(cast(SafeHttpClient, http)).search("罗尼交易指南", 2)

    assert caught.value.code == "SEARCH_EMPTY"
    assert caught.value.reason == "search_no_usable_results"


@pytest.mark.parametrize(
    "payload",
    [
        {"code": 0, "data": {"result": []}},
        {
            "code": 0,
            "data": {
                "result": [
                    {
                        "type": "video",
                        "bvid": "BV1uHuQ6pEFr",
                        "title": "<script>invalid</script>",
                    }
                ]
            },
        },
    ],
)
async def test_search_fails_closed_when_no_usable_video_exists(payload: dict[str, Any]) -> None:
    http = FakeHttp(payload)

    with pytest.raises(BilibiliNoteFailure) as caught:
        await BilibiliSearch(cast(SafeHttpClient, http)).search("不存在的主题", 2)

    assert caught.value.code == "SEARCH_EMPTY"
    assert caught.value.reason == "search_no_usable_results"


async def test_search_rejects_malformed_envelope() -> None:
    http = FakeHttp({"code": 0, "data": {"result": {}}})

    with pytest.raises(BilibiliNoteFailure) as caught:
        await BilibiliSearch(cast(SafeHttpClient, http)).search("趋势交易", 2)

    assert caught.value.code == "SOURCE_UNAVAILABLE"
    assert caught.value.reason == "search_results_invalid"


async def test_search_rejects_upstream_nonzero_code() -> None:
    http = FakeHttp({"code": -403, "message": "denied"})

    with pytest.raises(BilibiliNoteFailure) as caught:
        await BilibiliSearch(cast(SafeHttpClient, http)).search("趋势交易", 2)

    assert caught.value.code == "SOURCE_UNAVAILABLE"
    assert caught.value.reason == "search_request_rejected"


async def test_search_rejects_boolean_success_code() -> None:
    http = FakeHttp({"code": False, "data": {"result": []}})

    with pytest.raises(BilibiliNoteFailure) as caught:
        await BilibiliSearch(cast(SafeHttpClient, http)).search("趋势交易", 2)

    assert caught.value.code == "SOURCE_UNAVAILABLE"
    assert caught.value.reason == "search_payload_invalid"
