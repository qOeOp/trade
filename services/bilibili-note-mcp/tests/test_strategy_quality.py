from __future__ import annotations

import pytest
from pydantic import ValidationError

from bilibili_note_mcp.adapters.strategy_aggregation import DeterministicStrategyAggregator
from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.domain.models import (
    PublicRuleV1,
    StrategySummaryV1,
    summary_items_duplicate,
)
from bilibili_note_mcp.domain.strategy_summary import strategy_summary_title
from bilibili_note_mcp.presentation.markdown import MarkdownRenderer


def _rule(body: str) -> PublicRuleV1:
    return PublicRuleV1(rule_body=body)


def _summary(subject: str, prefix: str) -> StrategySummaryV1:
    return StrategySummaryV1(
        subject=subject,
        core_strategies=(_rule(f"{prefix}核心规则。"),),
        methods=(_rule(f"{prefix}执行方法。"),),
        risk_management=(_rule(f"{prefix}风险边界。"),),
    )


def test_renderer_alone_derives_title_from_strict_subject() -> None:
    summary = _summary("罗尼交易指南-官方", "趋势")

    assert strategy_summary_title(summary.subject) == "罗尼交易指南：交易思想与策略总结"
    assert MarkdownRenderer().render(summary).startswith("# 罗尼交易指南：交易思想与策略总结\n")
    assert "title" not in StrategySummaryV1.model_json_schema()["properties"]
    with pytest.raises(ValidationError):
        StrategySummaryV1.model_validate(
            {
                "title": "旧标题交易思想与策略总结",
                "core_strategies": [{"rule_body": "核心规则。"}],
                "methods": [{"rule_body": "执行方法。"}],
                "risk_management": [{"rule_body": "风险边界。"}],
            }
        )


async def test_cross_video_aggregation_preserves_typed_rules_and_polarity() -> None:
    first = StrategySummaryV1(
        subject="罗尼",
        core_strategies=(_rule("主要趋势决定方向偏好。"),),
        methods=(_rule("价格站稳后参与。"), _rule("允许等待确认。")),
        risk_management=(_rule("价格跌破失效位置后退出。"),),
    )
    second = StrategySummaryV1(
        subject="罗尼",
        core_strategies=(_rule("逆势方向不属于策略偏好。"),),
        methods=(_rule("避免在区间中部参与。"),),
        risk_management=(_rule("必须保留失效条件。"),),
    )

    summary = await DeterministicStrategyAggregator().aggregate("罗尼", (first, second))

    assert summary.subject == "罗尼"
    assert all(isinstance(rule, PublicRuleV1) for rule in summary.core_strategies)
    assert tuple(rule.rule_body for rule in summary.core_strategies) == (
        "主要趋势决定方向偏好。",
        "逆势方向不属于策略偏好。",
    )
    output = tuple(
        rule.rule_body
        for rule in (*summary.core_strategies, *summary.methods, *summary.risk_management)
    )
    for body in (
        "允许等待确认。",
        "逆势方向不属于策略偏好。",
        "避免在区间中部参与。",
        "价格跌破失效位置后退出。",
        "必须保留失效条件。",
    ):
        assert output.count(body) == 1


async def test_cross_video_aggregation_deduplicates_without_unwrapping_rules() -> None:
    first = _summary("作者甲", "共享")
    second = StrategySummaryV1(
        subject="作者乙",
        core_strategies=(first.core_strategies[0], _rule("独立核心规则。")),
        methods=(first.methods[0], _rule("独立执行方法。")),
        risk_management=(first.risk_management[0], _rule("独立风险边界。")),
    )

    summary = await DeterministicStrategyAggregator().aggregate("查询主题", (first, second))

    assert summary.core_strategies.count(first.core_strategies[0]) == 1
    assert summary.methods.count(first.methods[0]) == 1
    assert summary.risk_management.count(first.risk_management[0]) == 1


async def test_cross_category_collision_fails_closed_before_bounded_projection() -> None:
    first = _summary("作者甲", "共享")
    collision = StrategySummaryV1(
        subject="作者乙",
        core_strategies=(_rule("独立核心规则。"),),
        methods=(_rule("共享核心规则。"),),
        risk_management=(_rule("独立风险边界。"),),
    )

    with pytest.raises(BilibiliNoteFailure) as failure:
        await DeterministicStrategyAggregator().aggregate("主题", (first, collision))

    assert failure.value.reason == "strategy_aggregation_response_invalid"


async def test_three_maximal_distinct_sources_fail_closed_instead_of_truncating() -> None:
    summaries = tuple(
        StrategySummaryV1(
            subject=f"作者{source}",
            core_strategies=tuple(_rule(f"来源{source}核心{rank}。") for rank in range(9)),
            methods=tuple(_rule(f"来源{source}方法{rank}。") for rank in range(9)),
            risk_management=tuple(_rule(f"来源{source}风险{rank}。") for rank in range(6)),
        )
        for source in range(3)
    )

    with pytest.raises(BilibiliNoteFailure) as failure:
        await DeterministicStrategyAggregator().aggregate("有界聚合", summaries)

    assert failure.value.reason == "strategy_aggregation_response_invalid"


async def test_aggregator_rejects_source_count_outside_search_contract() -> None:
    summary = _summary("作者", "规则")
    for values in ((), (summary, summary, summary, summary)):
        with pytest.raises(BilibiliNoteFailure) as failure:
            await DeterministicStrategyAggregator().aggregate("主题", values)
        assert failure.value.reason == "strategy_aggregation_source_count_invalid"


def test_semantic_duplicate_detection_preserves_opposing_rules() -> None:
    assert not summary_items_duplicate(
        _rule(
            "结合上升趋势线与斐波那契回调位（如61.8%）寻找参与位置，"
            "价格测试趋势线或回调位后出现阳线企稳视为潜在入场信号。"
        ),
        _rule(
            "价格回落测试上升趋势线或斐波那契回调位（如61.8%）时，"
            "若出现阳线企稳，视为潜在做多条件。"
        ),
    )
    assert summary_items_duplicate(
        _rule("价格站上关键位置后等待确认。"),
        _rule(" 价格站上关键位置后等待确认。 ".strip()),
    )
    assert not summary_items_duplicate(
        _rule("价格跌破关键前低时必须立即止损并且不得继续持有该仓位。"),
        _rule("价格跌破关键前低时不必立即止损并且仍可继续持有该仓位。"),
    )
