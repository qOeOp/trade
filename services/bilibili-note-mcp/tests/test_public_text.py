from __future__ import annotations

import pytest
from pydantic import ValidationError

from bilibili_note_mcp.application.public_text import (
    contains_private_audit_noise,
    contains_private_catalog_identity,
    model_public_rule_representation_is_valid,
    rendered_contains_private_audit_noise,
    rendered_public_text_is_valid,
    rendered_summary_structure_is_valid,
)
from bilibili_note_mcp.domain.models import PublicRuleV1, StrategySummaryV1
from bilibili_note_mcp.domain.strategy_summary import (
    PUBLIC_RULE_FRAME,
    UNVERIFIED_SUMMARY_SCOPE,
    public_author_subject,
    public_search_subject,
)
from bilibili_note_mcp.presentation.markdown import MarkdownRenderer, markdown_literal


def _rule(body: str) -> PublicRuleV1:
    return PublicRuleV1(rule_body=body)


def _summary(*bodies: str) -> StrategySummaryV1:
    rules = tuple(_rule(body) for body in bodies)
    return StrategySummaryV1(
        subject="研究摘要",
        core_strategies=rules,
        methods=(_rule("等待价格确认。"),),
        risk_management=(_rule("结构失效时停止沿用。"),),
    )


def test_model_rule_gate_rejects_only_unsafe_representations() -> None:
    assert model_public_rule_representation_is_valid("价格突破 MA20 后仍需要回踩确认。")
    assert model_public_rule_representation_is_valid(
        "当 EMA5 < EMA20 > EMA60 时，保持观望并等待结构确认。"
    )
    assert model_public_rule_representation_is_valid("建议你立即卖出，并授权钱包完成交易。")
    assert not model_public_rule_representation_is_valid(
        "核心 English-only research summary with many words"
    )
    assert not model_public_rule_representation_is_valid("核心结论 data:image/png;base64,QUFBQUFB")
    assert not model_public_rule_representation_is_valid("核心结论 <img src='x'> 代表趋势。")
    assert model_public_rule_representation_is_valid("大家好，请点赞关注，核心观点稍后再说。")
    assert model_public_rule_representation_is_valid("主播表示这里直接做多比特币。")
    assert model_public_rule_representation_is_valid("图中可见价格重新站上趋势线。")
    assert not model_public_rule_representation_is_valid("S01:C01：仅沿主要趋势方向寻找机会。")


@pytest.mark.parametrize(
    "value",
    (
        "当 EMA5 < EMA20 > EMA60 时，保持观望并等待结构确认。",
        "当 0 < time > 1 时，等待结构确认。",
        "当价格 < 20 且风险 > 5 时，等待结构确认。",
        "当价格<20且风险>5时，等待结构确认。",
    ),
)
def test_spaced_or_numeric_comparisons_are_not_treated_as_markup(value: str) -> None:
    assert model_public_rule_representation_is_valid(value)
    rendered = MarkdownRenderer().render(_summary(value))
    assert rendered_public_text_is_valid(rendered)


@pytest.mark.parametrize(
    "value",
    (
        "当EMA5<EMA20>EMA60时，保持观望并等待结构确认。",
        "价格满足<EMA20>后等待结构确认。",
        "核心结论 <basefont>趋势仍需确认。",
        "核心结论 <applet>趋势仍需确认。</applet>",
        "核心结论 <listing>趋势仍需确认。</listing>",
        "核心结论 <b>趋势</b> 仍需确认。",
        "核心结论 <script>unsafe</script> 仍需确认。",
        "核心结论 <svg><use href='x'/></svg> 仍需确认。",
        "核心结论 <path d='M0 0L1 1'></path> 仍需确认。",
        "核心结论 <mrow><mi>x</mi></mrow> 仍需确认。",
        "核心结论 <time>1</time> 仍需确认。",
        "核心结论 0<time datetime='1'>1</time> 仍需确认。",
        "核心结论 x<b>y 仍需确认。",
        "核心结论 x<br>y 仍需确认。",
        "核心结论 x<input>y 仍需确认。",
        "核心结论 x<svg>y 仍需确认。",
        "核心结论 x<math>y 仍需确认。",
        "核心结论 x<time>y 仍需确认。",
        "核心结论 x<unknown>y 仍需确认。",
        "核心结论 x<future-widget>y 仍需确认。",
        "核心结论 x</future-widget>y 仍需确认。",
        "核心结论 x<future-widget mode='trend'>y 仍需确认。",
        "核心结论 x<future-widget/>y 仍需确认。",
        "核心结论 x＜ｆｕｔｕｒｅ－ｗｉｄｇｅｔ＞y 仍需确认。",
        r"核心结论 x\<future-widget\>y 仍需确认。",
        "核心结论 x&lt;b&gt;y 仍需确认。",
        "核心结论 x&lt;future-widget&gt;y 仍需确认。",
        "核心结论 x&#60;svg&#62;y 仍需确认。",
        "核心结论 x&#x3c;mrow&#x3e;y 仍需确认。",
    ),
)
def test_every_tag_shaped_representation_remains_forbidden(value: str) -> None:
    assert not model_public_rule_representation_is_valid(value)
    assert not rendered_public_text_is_valid(MarkdownRenderer().render(_summary(value)))


@pytest.mark.parametrize(
    "value",
    (
        "S01:C01：仅沿主要趋势方向寻找机会。",
        r"S01\:C01：仅沿主要趋势方向寻找机会。",
        r"S01\\:C01：仅沿主要趋势方向寻找机会。",
        r"S01\\\\\\:C01：仅沿主要趋势方向寻找机会。",
        "s01:c01：仅沿主要趋势方向寻找机会。",
        "S01:\u200bC01：仅沿主要趋势方向寻找机会。",
        "Ｓ０１：Ｃ０１：仅沿主要趋势方向寻找机会。",
        "关联 S03:M12 与 S02:R04。",
        "S 0 1 : C 0 1：仅沿主要趋势方向寻找机会。",
        "关联 S 0 3 : M 1 2 与 S 0 2 : R 0 4。",
        "S&Tab;0&Tab;1&Tab;:&Tab;C&Tab;0&Tab;1：仅沿主要趋势方向寻找机会。",
        "S\u16800\u16801\u1680:\u1680R\u16800\u16804：结构失效后停止沿用。",
        "S&NewLine;0&NewLine;1&NewLine;:&NewLine;M&NewLine;0&NewLine;1：等待结构确认。",
    ),
)
def test_private_search_catalog_identity_is_never_public(value: str) -> None:
    assert contains_private_catalog_identity(value)
    assert contains_private_audit_noise(value)


@pytest.mark.parametrize(
    "value",
    (
        "依据 e001 等待确认。",
        "依据 E\u200b001 等待确认。",
        "依据 Ｅ００１ 等待确认。",
        "关联 v01、F-01 与 h02。",
        "来源 BB_" + "A" * 64 + "。",
        r"来源 bb\_" + "a" * 64 + "。",
        "依据 sac_" + "a" * 64 + " 综合判断。",
        r"依据 SAS\_" + "A" * 64 + " 综合判断。",
        "依据 E\u034f001 等待确认。",
        "关联 S\ufe0f01:C01 后等待确认。",
        "依据 sac\u034f_" + "a" * 64 + " 综合判断。",
        "依据 E 0 0 1 与 V 0 1 等待确认。",
        "关联 F - 0 1 与 H 0 2 后等待确认。",
        "来源 b b _ " + " ".join("a" * 64) + "。",
        "依据 s a c _ " + " ".join("a" * 64) + " 综合判断。",
        "依据 E&Tab;0&Tab;0&Tab;1 与 V&#9;0&#9;1 等待确认。",
        "关联 F\u1680-\u16800\u16801 与 H\u16800\u16802 后等待确认。",
        "来源 b&Tab;b&Tab;_&Tab;" + "&Tab;".join("a" * 64) + "。",
        "依据 E&NewLine;0&#10;0&#x0d;1 与 V&#13;0&NewLine;1 等待确认。",
        "关联 F&NewLine;-&#10;0&#13;1 与 H&#x0a;0&#x0d;2 后等待确认。",
        "来源 s&NewLine;a&#10;c&#13;_&NewLine;" + "&#10;".join("a" * 64) + "。",
        "Model\ufe0f: test-model，价格突破后等待确认。",
        "S01&colon;C01：仅沿主要趋势方向寻找机会。",
        "S01&#58;C01：仅沿主要趋势方向寻找机会。",
        "S01&#x3a;C01：仅沿主要趋势方向寻找机会。",
    ),
)
def test_every_private_identity_uses_the_browser_visible_detection_view(value: str) -> None:
    assert contains_private_audit_noise(value)
    assert not model_public_rule_representation_is_valid(value)


@pytest.mark.parametrize("prefix", ("bs", "bt", "bp", "bb", "sac", "sas"))
@pytest.mark.parametrize("ignorable", ("\u034f", "\ufe0f"))
def test_every_private_digest_family_rejects_default_ignorable_splits(
    prefix: str, ignorable: str
) -> None:
    value = f"依据 {prefix}{ignorable}_{'a' * 64} 综合判断。"
    assert contains_private_audit_noise(value)
    assert not model_public_rule_representation_is_valid(value)


@pytest.mark.parametrize("prefix", ("bs", "bt", "bp", "bb", "sac", "sas"))
@pytest.mark.parametrize("gap", (" ", "&Tab;", "&#9;", "\u1680", "&NewLine;", "&#10;", "&#13;"))
def test_every_private_digest_family_rejects_browser_visible_whitespace_splits(
    prefix: str, gap: str
) -> None:
    value = f"依据 {gap.join(prefix)}{gap}_{gap}{gap.join('a' * 64)} 综合判断。"
    assert contains_private_audit_noise(value)
    assert not model_public_rule_representation_is_valid(value)


def test_private_identity_grammar_does_not_join_independent_rendered_lines() -> None:
    assert contains_private_audit_noise("普通正文 E\n001 不是同一字段。")
    assert not rendered_contains_private_audit_noise("普通正文 E\n001 不是同一字段。")
    assert rendered_contains_private_audit_noise("普通正文 E&NewLine;001 属于同一字段。")
    assert model_public_rule_representation_is_valid("价格在 01 : 01 时仍需确认结构。")


@pytest.mark.parametrize(
    "value",
    (
        "依据 E\u034f001 等待确认。",
        "依据 V\ufe0f01 等待确认。",
        "依据 F\u034f-01 等待确认。",
        "依据 H\ufe0f02 等待确认。",
    ),
)
def test_every_private_evidence_id_family_rejects_default_ignorable_splits(
    value: str,
) -> None:
    assert contains_private_audit_noise(value)
    assert not model_public_rule_representation_is_valid(value)


@pytest.mark.parametrize("ignorable", ("\u034f", "\ufe0f"))
def test_private_catalog_id_rejects_default_ignorable_splits(ignorable: str) -> None:
    value = f"关联 S{ignorable}01:C01 后等待确认。"
    assert contains_private_catalog_identity(value)
    assert contains_private_audit_noise(value)
    assert not model_public_rule_representation_is_valid(value)


@pytest.mark.parametrize(
    "value",
    (
        "Model\u034f: test-model，价格突破后等待确认。",
        "## Prove\ufe0fnance internal，价格突破后等待确认。",
        "Source\u034f snapshot: internal，价格突破后等待确认。",
    ),
)
def test_private_markers_reject_default_ignorable_splits(value: str) -> None:
    assert contains_private_audit_noise(value)
    assert not model_public_rule_representation_is_valid(value)


@pytest.mark.parametrize(
    "value",
    (
        "Model: test-model，价格突破后等待确认。",
        r"Model\\\\\: test-model，价格突破后等待确认。",
        "## Provenance 价格突破后等待确认。",
        r"\\\\\#\\\\\# Provenance 价格突破后等待确认。",
        "Source snapshot: 私有来源，价格突破后等待确认。",
    ),
)
def test_private_marker_is_rejected_before_and_after_markdown_render(value: str) -> None:
    assert not model_public_rule_representation_is_valid(value)
    rendered = MarkdownRenderer().render(_summary(value))
    assert contains_private_audit_noise(rendered)


def test_untrusted_subject_collision_projects_to_generic_host_subject() -> None:
    for value in (
        "E001",
        "E\u034f001",
        "F-01 交易策略",
        "Model\ufe0f: internal",
        "S\u034f01&colon;C01",
        "E 0 0 1",
        "S 0 1 : C 0 1",
        "b s _ " + " ".join("a" * 64),
        "趋势 E 0&Tab;0 1",
        "S\u16800\u16801\u1680:\u1680M\u16800\u16801",
        "趋势 E&NewLine;0&#10;0&#13;1",
    ):
        assert public_author_subject(value) == "视频"
    assert public_author_subject("罗尼交易指南") == "罗尼交易指南"

    rendered = MarkdownRenderer().render(
        _summary("保持规则语义。").model_copy(update={"subject": public_author_subject("E001")})
    )
    assert rendered.startswith("# 视频：交易思想与策略总结\n")
    assert not contains_private_audit_noise(rendered)


@pytest.mark.parametrize(
    ("value", "expected"),
    (
        ("Follow the market trend and wait for confirmation", "视频"),
        ("Follow The Market Trend", "视频"),
        ("趋势交易 and wait for confirmation", "视频"),
        ("price action", "视频"),
        ("price", "视频"),
        ("Rony Trading", "Rony Trading"),
        ("BTC + EMA20", "BTC + EMA20"),
        ("S&P 500", "S&P 500"),
        ("TradingView", "TradingView"),
        ("iPhone", "iPhone"),
        ("罗尼 BTC 趋势策略", "罗尼 BTC 趋势策略"),
    ),
)
def test_public_subject_language_policy_rejects_prose_but_preserves_names_and_tokens(
    value: str, expected: str
) -> None:
    assert public_author_subject(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    (
        ("Best Strategy", "视频"),
        ("Rony Trading", "视频"),
        ("BTC + EMA20", "视频"),
        ("趋势交易", "趋势交易"),
        ("BTC 趋势交易", "BTC 趋势交易"),
    ),
)
def test_public_search_subject_requires_chinese_facing_query(value: str, expected: str) -> None:
    assert public_search_subject(value) == expected


def test_renderer_enforces_public_subject_language_policy_at_the_h1_sink() -> None:
    rendered = MarkdownRenderer().render(
        _summary("保持规则语义。").model_copy(
            update={"subject": "Follow the market trend and wait for confirmation"}
        )
    )

    assert rendered.startswith("# 视频：交易思想与策略总结\n")
    assert "Follow the market" not in rendered


def test_browser_visible_media_entities_are_rejected_before_and_after_render() -> None:
    value = (
        "当图示 &excl;&lbrack;趋势&rbrack;&lpar;data&colon;image/png;"
        "base64&comma;QUJD&rpar; 出现突破时等待确认。"
    )
    assert not model_public_rule_representation_is_valid(value)
    rendered = MarkdownRenderer().render(_summary(value))
    assert not rendered_public_text_is_valid(rendered)


def test_natural_market_symbol_is_not_a_private_catalog_identity() -> None:
    assert not contains_private_catalog_identity("标普500指数在4小时图上等待确认。")


@pytest.mark.parametrize(
    "body",
    (
        "交易规则：立即买入比特币并设置止损。",
        "做多比特币并把止损设在前低下方。",
        "跌破前低后立即止损。",
        "先运行单元测试",
        "避免吞掉异常",
        "识别未使用变量",
        "优先选择批量接口，避免逐行调用",
        "等待公式重算",
        "避免覆盖标题行",
        "识别重复值",
        "优先选择固定列顺序",
    ),
)
def test_rule_body_is_rendered_once_unchanged_behind_the_host_frame(body: str) -> None:
    rule = _rule(body)
    summary = StrategySummaryV1(
        subject="跨领域规则",
        core_strategies=(rule,),
        methods=(_rule("保留方法语义。"),),
        risk_management=(_rule("保留风险语义。"),),
    )

    rendered = MarkdownRenderer().render(summary)

    assert rendered_summary_structure_is_valid(rendered)
    assert rendered.count(markdown_literal(body)) == 1
    assert f"- {PUBLIC_RULE_FRAME}{markdown_literal(body)}" in rendered
    assert rule.rule_body == body


def test_old_public_rule_wire_field_is_rejected() -> None:
    with pytest.raises(ValidationError):
        PublicRuleV1.model_validate({"text": "旧表示不得兼容。"})


def test_markdown_punctuation_cannot_escape_the_host_owned_bullet() -> None:
    body = "**优先** [批量接口](https://example.invalid)，避免 `逐行` # 调用。"
    rendered = MarkdownRenderer().render(_summary(body))

    assert rendered_summary_structure_is_valid(rendered)
    assert rendered.count("- ") == 3
    assert f"- {PUBLIC_RULE_FRAME}{markdown_literal(body)}" in rendered
    assert "https://example.invalid" not in rendered


def test_rendered_structure_rejects_naked_or_mutated_public_items() -> None:
    valid = MarkdownRenderer().render(_summary("等待确认。"))

    assert rendered_summary_structure_is_valid(valid)
    assert not rendered_summary_structure_is_valid(valid.replace(PUBLIC_RULE_FRAME, "", 1))
    assert not rendered_summary_structure_is_valid(
        valid.replace(f"- {PUBLIC_RULE_FRAME}等待确认。", "- 自定义前缀：等待确认。", 1)
    )
    assert not rendered_summary_structure_is_valid(
        valid.replace(UNVERIFIED_SUMMARY_SCOPE, "仅供参考")
    )


def test_rendered_public_text_rejects_media_markup_but_allows_source_url() -> None:
    assert rendered_public_text_is_valid("Source: https://www.bilibili.com/video/BV1bK411W797")
    assert not rendered_public_text_is_valid("<img src='https://example.invalid/a.png'>")
    assert not rendered_public_text_is_valid("MEDIA:/private/tmp/frame.png")
    assert rendered_public_text_is_valid("方法上：画面显示价格位于压力线下方。")


@pytest.mark.parametrize(
    "claim",
    (
        "该策略年化收益率达到30%。",
        "该策略胜率达到80%。",
        "该区域后续大概率会回补。",
        "这套规则历经各类市场仍然牢不可破。",
    ),
)
def test_document_scope_structurally_governs_arbitrary_unverified_claims(claim: str) -> None:
    rendered = MarkdownRenderer().render(_summary(claim))

    assert rendered_summary_structure_is_valid(rendered)
    assert rendered.count(UNVERIFIED_SUMMARY_SCOPE) == 1
    assert rendered.index(UNVERIFIED_SUMMARY_SCOPE) < rendered.index(markdown_literal(claim))
