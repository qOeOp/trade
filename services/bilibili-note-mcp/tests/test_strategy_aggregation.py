from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from dataclasses import replace
from typing import Any, cast

import httpx
import pytest

import bilibili_note_mcp.adapters.strategy_aggregation as adapter_module
from bilibili_note_mcp.adapters.strategy_aggregation import (
    SiliconFlowStrategySynthesisVerifier,
    SiliconFlowStrategySynthesizer,
)
from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.application.ports import (
    MATERIAL_CONDITION_CLASSES,
    StrategyCatalogItem,
    StrategyEpisodeOmissionVerdict,
    StrategySynthesis,
    StrategySynthesisOutput,
    StrategySynthesisOutputVerdict,
    StrategySynthesisVerification,
)
from bilibili_note_mcp.application.strategy_aggregation import VerifiedStrategySynthesisAggregator
from bilibili_note_mcp.config import ModelProfile
from bilibili_note_mcp.domain.models import PublicRuleV1, StrategySummaryV1


def _rule(body: str) -> PublicRuleV1:
    return PublicRuleV1(rule_body=body)


def _summary(prefix: str) -> StrategySummaryV1:
    return StrategySummaryV1(
        subject=prefix,
        core_strategies=(_rule(f"{prefix}顺势交易。"),),
        methods=(_rule(f"{prefix}等待确认后参与。"),),
        risk_management=(_rule(f"{prefix}跌破失效位置后退出。"),),
    )


def _exact_synthesis(
    catalog: tuple[StrategyCatalogItem, ...], catalog_ref: str
) -> StrategySynthesis:
    return StrategySynthesis(
        catalog_ref=catalog_ref,
        outputs=tuple(
            StrategySynthesisOutput(item.category, item.rule, (item.item_id,)) for item in catalog
        ),
        episode_specific_ids=(),
    )


class _StaticSynthesizer:
    def __init__(
        self, build: Callable[[tuple[StrategyCatalogItem, ...], str], StrategySynthesis]
    ) -> None:
        self._build = build

    async def synthesize(
        self, catalog: tuple[StrategyCatalogItem, ...], catalog_ref: str
    ) -> StrategySynthesis:
        return self._build(catalog, catalog_ref)


class _Verifier:
    def __init__(self, mutation: str | None = None) -> None:
        self.mutation = mutation

    async def verify_synthesis(
        self,
        catalog: tuple[StrategyCatalogItem, ...],
        catalog_ref: str,
        synthesis: StrategySynthesis,
        synthesis_ref: str,
    ) -> StrategySynthesisVerification:
        del catalog
        outputs = tuple(
            StrategySynthesisOutputVerdict(
                output_index=index + (1 if self.mutation == "index" and index == 0 else 0),
                entailed_no_new_claim=(
                    cast(Any, "invalid")
                    if self.mutation == "enum"
                    else "reject"
                    if self.mutation == "invented" and index == 0
                    else "accept"
                ),
                polarity_preserved=(
                    "reject" if self.mutation == "polarity" and index == 0 else "accept"
                ),
                material_conditions_preserved=(
                    "reject"
                    if self.mutation
                    in {
                        "symbol_or_instrument",
                        "timeframe",
                        "level",
                        "threshold",
                        "indicator",
                        "confirmation",
                        "exception",
                        "invalidation",
                    }
                    and synthesis.outputs[index].category == "method"
                    else "accept"
                ),
                reusable_abstraction_acceptable=(
                    "reject" if self.mutation == "abstraction" and index == 0 else "accept"
                ),
                simplified_chinese_language=(
                    "reject" if self.mutation == "language" and index == 0 else "accept"
                ),
            )
            for index, _output in enumerate(synthesis.outputs)
        )
        if self.mutation == "output_length":
            outputs = outputs[:-1]
        episodes = tuple(
            StrategyEpisodeOmissionVerdict(
                item_id=("S03:M99" if self.mutation == "episode_id" else item_id),
                safe_to_omit=("reject" if self.mutation == "unsafe_omission" else "accept"),
            )
            for item_id in synthesis.episode_specific_ids
        )
        if self.mutation == "episode_length":
            episodes = episodes[:-1]
        return StrategySynthesisVerification(
            catalog_ref=("sac_" + "0" * 64 if self.mutation == "catalog_ref" else catalog_ref),
            synthesis_ref=(
                "sas_" + "0" * 64 if self.mutation == "synthesis_ref" else synthesis_ref
            ),
            outputs=outputs,
            episode_specific=episodes,
            complete_coverage="reject" if self.mutation == "coverage" else "accept",
            category_preservation="reject" if self.mutation == "category" else "accept",
            no_duplicate_or_remaining_mergeable_output=(
                "reject" if self.mutation == "mergeable" else "accept"
            ),
            priority_order_acceptable="reject" if self.mutation == "priority" else "accept",
        )


def _aggregate_with(
    build: Callable[[tuple[StrategyCatalogItem, ...], str], StrategySynthesis],
    verifier: _Verifier | None = None,
) -> VerifiedStrategySynthesisAggregator:
    return VerifiedStrategySynthesisAggregator(_StaticSynthesizer(build), verifier or _Verifier())


@pytest.mark.parametrize(
    "mutation",
    [
        "catalog_ref",
        "duplicate_id",
        "missing_id",
        "unknown_id",
        "cross_category",
        "support_order",
        "category_block",
        "duplicate_rule",
    ],
)
async def test_synthesis_is_a_closed_typed_ordered_total_partition(mutation: str) -> None:
    def build(catalog: tuple[StrategyCatalogItem, ...], ref: str) -> StrategySynthesis:
        base = _exact_synthesis(catalog, ref)
        outputs = list(base.outputs)
        episodes: tuple[str, ...] = ()
        if mutation == "catalog_ref":
            return replace(base, catalog_ref="sac_" + "0" * 64)
        if mutation == "duplicate_id":
            outputs[1] = replace(outputs[1], support_ids=(outputs[0].support_ids[0],))
        elif mutation == "missing_id":
            outputs.pop()
        elif mutation == "unknown_id":
            outputs[0] = replace(outputs[0], support_ids=("S03:C99",))
        elif mutation == "cross_category":
            outputs[0] = replace(outputs[0], support_ids=(catalog[2].item_id,))
            outputs[2] = replace(outputs[2], support_ids=(catalog[0].item_id,))
        elif mutation == "support_order":
            outputs[0] = replace(outputs[0], support_ids=(catalog[1].item_id, catalog[0].item_id))
            outputs.pop(1)
        elif mutation == "category_block":
            outputs[0], outputs[2] = outputs[2], outputs[0]
        elif mutation == "duplicate_rule":
            outputs[2] = replace(outputs[2], rule=outputs[0].rule)
        return StrategySynthesis(ref, tuple(outputs), episodes)

    with pytest.raises(BilibiliNoteFailure) as failure:
        await _aggregate_with(build).aggregate("主题", (_summary("甲"), _summary("乙")))
    assert failure.value.reason == "strategy_aggregation_response_invalid"


async def test_episode_ids_must_follow_catalog_order_without_category_min_shortcut() -> None:
    source = StrategySummaryV1(
        subject="甲",
        core_strategies=(_rule("甲顺势交易。"),),
        methods=(
            _rule("甲保留执行方法。"),
            _rule("甲当期价格观察。"),
            _rule("甲当期品种展望。"),
        ),
        risk_management=(_rule("甲跌破失效位置后退出。"),),
    )

    def build(catalog: tuple[StrategyCatalogItem, ...], ref: str) -> StrategySynthesis:
        base = _exact_synthesis(catalog, ref)
        return StrategySynthesis(
            ref,
            base.outputs[:2] + base.outputs[4:],
            (catalog[3].item_id, catalog[2].item_id),
        )

    with pytest.raises(BilibiliNoteFailure) as failure:
        await _aggregate_with(build).aggregate("主题", (source,))
    assert failure.value.reason == "strategy_aggregation_response_invalid"


async def test_output_bounds_fail_closed_without_capacity_or_truncation() -> None:
    source = StrategySummaryV1(
        subject="来源",
        core_strategies=tuple(_rule(f"核心规则{index}。") for index in range(4)),
        methods=(_rule("执行方法。"),),
        risk_management=(_rule("风险边界。"),),
    )
    with pytest.raises(BilibiliNoteFailure) as failure:
        await _aggregate_with(_exact_synthesis).aggregate("主题", (source,))
    assert failure.value.reason == "strategy_aggregation_response_invalid"


@pytest.mark.parametrize(
    "mutation,reason",
    [
        ("catalog_ref", "strategy_aggregation_verifier_invalid"),
        ("synthesis_ref", "strategy_aggregation_verifier_invalid"),
        ("index", "strategy_aggregation_verifier_invalid"),
        ("output_length", "strategy_aggregation_verifier_invalid"),
        ("enum", "strategy_aggregation_verifier_invalid"),
        ("invented", "strategy_aggregation_semantics_rejected"),
        ("polarity", "strategy_aggregation_semantics_rejected"),
        ("threshold", "strategy_aggregation_semantics_rejected"),
        ("symbol_or_instrument", "strategy_aggregation_semantics_rejected"),
        ("timeframe", "strategy_aggregation_semantics_rejected"),
        ("level", "strategy_aggregation_semantics_rejected"),
        ("indicator", "strategy_aggregation_semantics_rejected"),
        ("confirmation", "strategy_aggregation_semantics_rejected"),
        ("exception", "strategy_aggregation_semantics_rejected"),
        ("invalidation", "strategy_aggregation_semantics_rejected"),
        ("abstraction", "strategy_aggregation_semantics_rejected"),
        ("language", "strategy_aggregation_semantics_rejected"),
        ("coverage", "strategy_aggregation_semantics_rejected"),
        ("category", "strategy_aggregation_semantics_rejected"),
        ("mergeable", "strategy_aggregation_semantics_rejected"),
        ("priority", "strategy_aggregation_semantics_rejected"),
    ],
)
async def test_verifier_is_exact_total_and_reject_only(mutation: str, reason: str) -> None:
    with pytest.raises(BilibiliNoteFailure) as failure:
        await _aggregate_with(_exact_synthesis, _Verifier(mutation)).aggregate(
            "主题", (_summary("甲"),)
        )
    assert failure.value.reason == reason


async def test_verifier_rejects_candidate_that_drops_timeframe_and_confirmation() -> None:
    source = StrategySummaryV1(
        subject="甲",
        core_strategies=(_rule("仅顺主要趋势交易。"),),
        methods=(_rule("4小时收盘站稳关键位后参与。"),),
        risk_management=(_rule("4小时收盘跌破失效位后退出。"),),
    )

    def build(catalog: tuple[StrategyCatalogItem, ...], ref: str) -> StrategySynthesis:
        base = _exact_synthesis(catalog, ref)
        return replace(
            base,
            outputs=(
                base.outputs[0],
                replace(base.outputs[1], rule=_rule("站稳关键位后参与。")),
                base.outputs[2],
            ),
        )

    with pytest.raises(BilibiliNoteFailure) as failure:
        await _aggregate_with(build, _Verifier("timeframe")).aggregate("主题", (source,))
    assert failure.value.reason == "strategy_aggregation_semantics_rejected"


@pytest.mark.parametrize(
    "mutation,reason",
    [
        ("episode_id", "strategy_aggregation_verifier_invalid"),
        ("episode_length", "strategy_aggregation_verifier_invalid"),
        ("unsafe_omission", "strategy_aggregation_semantics_rejected"),
    ],
)
async def test_episode_omission_verdict_is_exact_and_safe(mutation: str, reason: str) -> None:
    def build(catalog: tuple[StrategyCatalogItem, ...], ref: str) -> StrategySynthesis:
        base = _exact_synthesis(catalog, ref)
        return StrategySynthesis(ref, base.outputs[:2] + base.outputs[3:], (catalog[2].item_id,))

    source = StrategySummaryV1(
        subject="甲",
        core_strategies=(_rule("甲顺势交易。"),),
        methods=(
            _rule("甲等待确认后参与。"),
            _rule(
                "4小时收盘站稳关键位后参与。"
                if mutation == "unsafe_omission"
                else "甲当前价格附近观察。"
            ),
        ),
        risk_management=(_rule("甲跌破失效位置后退出。"),),
    )
    with pytest.raises(BilibiliNoteFailure) as failure:
        await _aggregate_with(build, _Verifier(mutation)).aggregate("主题", (source,))
    assert failure.value.reason == reason


async def test_cancellation_between_calls_propagates_without_fallback() -> None:
    started = asyncio.Event()

    class BlockingVerifier(_Verifier):
        async def verify_synthesis(self, *args: object) -> StrategySynthesisVerification:
            started.set()
            await asyncio.Event().wait()
            raise AssertionError("unreachable")

    task = asyncio.create_task(
        _aggregate_with(_exact_synthesis, BlockingVerifier()).aggregate("主题", (_summary("甲"),))
    )
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


def _profile() -> ModelProfile:
    return ModelProfile(
        provider="siliconflow",
        base_url="https://example.invalid/v1",
        vision_model="test-model",
        asr_model="unused",
        api_key_env="TEST_AGGREGATION_KEY",
        timeout_seconds=1,
        max_output_tokens=4096,
    )


def _strict_provider_payload(*, content: dict[str, object], variant: str, nested_key: str) -> bytes:
    content_json = json.dumps(content, ensure_ascii=False, separators=(",", ":"))
    encoded_content = json.dumps(content_json, ensure_ascii=False)
    choices = f'"choices":[{{"message":{{"content":{encoded_content}}}}}]'
    if variant == "duplicate_model":
        return f'{{"model":"foreign","\\u006dodel":"test-model",{choices}}}'.encode()
    if variant == "duplicate_content":
        return (
            '{"model":"test-model","choices":[{"message":'
            f'{{"content":"{{}}","\\u0063ontent":{encoded_content}}}}}]}}'
        ).encode()
    if variant == "duplicate_nested":
        duplicate = f'"{nested_key}":"conflict","\\u{ord(nested_key[0]):04x}{nested_key[1:]}":'
        content_json = content_json.replace(f'"{nested_key}":', duplicate, 1)
        encoded_content = json.dumps(content_json, ensure_ascii=False)
        return (
            f'{{"model":"test-model","choices":[{{"message":{{"content":{encoded_content}}}}}]}}'
        ).encode()
    if variant == "nan":
        return f'{{"model":"test-model","usage":{{"total":NaN}},{choices}}}'.encode()
    if variant == "infinity":
        return f'{{"model":"test-model","usage":{{"total":Infinity}},{choices}}}'.encode()
    if variant == "negative_infinity":
        return f'{{"model":"test-model","usage":{{"total":-Infinity}},{choices}}}'.encode()
    if variant == "float_overflow":
        return f'{{"model":"test-model","usage":{{"total":1e400}},{choices}}}'.encode()
    if variant == "content_nan":
        return b'{"model":"test-model","choices":[{"message":{"content":"{\\"probe\\":NaN}"}}]}'
    if variant == "content_infinity":
        return (
            b'{"model":"test-model","choices":[{"message":{"content":"{\\"probe\\":Infinity}"}}]}'
        )
    if variant == "content_negative_infinity":
        return (
            b'{"model":"test-model","choices":[{"message":{"content":"{\\"probe\\":-Infinity}"}}]}'
        )
    if variant == "content_float_overflow":
        return b'{"model":"test-model","choices":[{"message":{"content":"{\\"probe\\":1e400}"}}]}'
    if variant == "root_array":
        return b"[]"
    if variant == "content_array":
        return b'{"model":"test-model","choices":[{"message":{"content":"[]"}}]}'
    if variant == "malformed":
        return b'{"model":'
    if variant == "content_malformed":
        return b'{"model":"test-model","choices":[{"message":{"content":"{"}}]}'
    raise AssertionError(f"unknown variant: {variant}")


@pytest.mark.parametrize("role", ("synthesis", "verifier"))
@pytest.mark.parametrize(
    "variant",
    (
        "duplicate_model",
        "duplicate_content",
        "duplicate_nested",
        "nan",
        "infinity",
        "negative_infinity",
        "float_overflow",
        "content_nan",
        "content_infinity",
        "content_negative_infinity",
        "content_float_overflow",
        "root_array",
        "content_array",
        "malformed",
        "content_malformed",
    ),
)
async def test_strategy_provider_roles_reject_ambiguous_or_nonfinite_json(
    monkeypatch: pytest.MonkeyPatch, role: str, variant: str
) -> None:
    monkeypatch.setenv("TEST_AGGREGATION_KEY", "secret")
    catalog = (
        StrategyCatalogItem("S01:C01", "core_strategy", _rule("顺势交易。")),
        StrategyCatalogItem("S01:M01", "method", _rule("等待确认。")),
        StrategyCatalogItem("S01:R01", "risk_management", _rule("失效后退出。")),
    )
    catalog_ref = "sac_" + "1" * 64
    synthesis = _exact_synthesis(catalog, catalog_ref)
    synthesis_ref = "sas_" + "2" * 64
    if role == "synthesis":
        content: dict[str, object] = {
            "catalog_ref": catalog_ref,
            "outputs": [
                {
                    "category": item.category,
                    "rule_body": item.rule.rule_body,
                    "support_ids": [item.item_id],
                }
                for item in catalog
            ],
            "episode_specific_ids": [],
        }
        nested_key = "rule_body"
    else:
        content = {
            "catalog_ref": catalog_ref,
            "synthesis_ref": synthesis_ref,
            "outputs": [
                {
                    "output_index": index,
                    "entailed_no_new_claim": "accept",
                    "polarity_preserved": "accept",
                    "material_conditions_preserved": "accept",
                    "reusable_abstraction_acceptable": "accept",
                    "simplified_chinese_language": "accept",
                }
                for index, _output in enumerate(synthesis.outputs)
            ],
            "episode_specific": [],
            "complete_coverage": "accept",
            "category_preservation": "accept",
            "no_duplicate_or_remaining_mergeable_output": "accept",
            "priority_order_acceptable": "accept",
        }
        nested_key = "entailed_no_new_claim"
    payload = _strict_provider_payload(content=content, variant=variant, nested_key=nested_key)
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, content=payload))

    with pytest.raises(BilibiliNoteFailure) as failure:
        if role == "synthesis":
            await SiliconFlowStrategySynthesizer(_profile(), transport).synthesize(
                catalog, catalog_ref
            )
        else:
            await SiliconFlowStrategySynthesisVerifier(_profile(), transport).verify_synthesis(
                catalog, catalog_ref, synthesis, synthesis_ref
            )

    assert failure.value.code == "DISTILLATION_FAILED"
    assert failure.value.reason == (
        "strategy_aggregation_response_invalid"
        if role == "synthesis"
        else "strategy_aggregation_verifier_invalid"
    )


def _daily_summaries() -> tuple[StrategySummaryV1, ...]:
    return tuple(
        StrategySummaryV1(
            subject=f"绝密标题{day}",
            core_strategies=(_rule(f"第{day}期主张仅顺主要趋势交易。"),),
            methods=(
                _rule(f"第{day}期先判断4小时趋势方向。"),
                _rule(f"第{day}期等待关键位4小时收盘确认后参与。"),
                _rule(f"8月{day}日比特币当前价格附近继续观察。"),
            ),
            risk_management=(_rule(f"第{day}期4小时收盘跌破失效位后退出。"),),
        )
        for day in (13, 14, 15)
    )


async def test_three_video_provider_synthesizes_reusable_rules_and_omits_episodes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TEST_AGGREGATION_KEY", "secret")
    requests: list[dict[str, object]] = []

    def respond(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        requests.append(payload)
        supplied = json.loads(payload["messages"][1]["content"].split("\n", 1)[1])
        if len(requests) == 1:
            result = {
                "catalog_ref": supplied["catalog_ref"],
                "outputs": [
                    {
                        "category": "core_strategy",
                        "rule_body": "仅沿主要趋势方向寻找交易机会。",
                        "support_ids": ["S01:C01", "S02:C01", "S03:C01"],
                    },
                    {
                        "category": "method",
                        "rule_body": "等待关键位置出现4小时收盘确认后再参与。",
                        "support_ids": ["S01:M02", "S02:M02", "S03:M02"],
                    },
                    {
                        "category": "method",
                        "rule_body": "先用4小时趋势方向过滤交易机会。",
                        "support_ids": ["S01:M01", "S02:M01", "S03:M01"],
                    },
                    {
                        "category": "risk_management",
                        "rule_body": "价格4小时收盘跌破预设失效位置后退出。",
                        "support_ids": ["S01:R01", "S02:R01", "S03:R01"],
                    },
                ],
                "episode_specific_ids": ["S01:M03", "S02:M03", "S03:M03"],
            }
        else:
            result = {
                "catalog_ref": supplied["catalog_ref"],
                "synthesis_ref": supplied["synthesis_ref"],
                "outputs": [
                    {
                        "output_index": index,
                        "entailed_no_new_claim": "accept",
                        "polarity_preserved": "accept",
                        "material_conditions_preserved": "accept",
                        "reusable_abstraction_acceptable": "accept",
                        "simplified_chinese_language": "accept",
                    }
                    for index in range(4)
                ],
                "episode_specific": [
                    {"item_id": item_id, "safe_to_omit": "accept"}
                    for item_id in supplied["synthesis"]["episode_specific_ids"]
                ],
                "complete_coverage": "accept",
                "category_preservation": "accept",
                "no_duplicate_or_remaining_mergeable_output": "accept",
                "priority_order_acceptable": "accept",
            }
        return httpx.Response(
            200,
            json={
                "model": "test-model",
                "choices": [{"message": {"content": json.dumps(result, ensure_ascii=False)}}],
            },
        )

    transport = httpx.MockTransport(respond)
    aggregator = VerifiedStrategySynthesisAggregator(
        SiliconFlowStrategySynthesizer(_profile(), transport),
        SiliconFlowStrategySynthesisVerifier(_profile(), transport),
    )
    summary = await aggregator.aggregate("绝不能发给模型的查询主题", _daily_summaries())

    assert len(requests) == 2
    synthesis_input = json.loads(requests[0]["messages"][1]["content"].split("\n", 1)[1])
    assert len(synthesis_input["catalog"]) == 15
    assert len({item["item_id"] for item in synthesis_input["catalog"]}) == 15
    assert summary.subject == "绝不能发给模型的查询主题"
    assert tuple(rule.rule_body for rule in summary.methods) == (
        "等待关键位置出现4小时收盘确认后再参与。",
        "先用4小时趋势方向过滤交易机会。",
    )
    assert summary.risk_management[0].rule_body == "价格4小时收盘跌破预设失效位置后退出。"
    public = json.dumps(summary.model_dump(), ensure_ascii=False)
    assert "8月" not in public and "比特币当前价格" not in public
    private = json.dumps(requests, ensure_ascii=False)
    assert "绝不能发给模型的查询主题" not in private
    assert "绝密标题" not in private
    assert "image_url" not in private
    verifier_prompt = requests[1]["messages"][1]["content"]
    assert "rule_body contains any catalog or support ID" in verifier_prompt
    synthesis_prompt = requests[0]["messages"][1]["content"]
    for condition in MATERIAL_CONDITION_CLASSES:
        assert condition in synthesis_prompt
        assert condition in verifier_prompt
    assert "English prose sentence or clause" in verifier_prompt


@pytest.mark.parametrize(
    ("condition_class", "source_rule", "dropped_rule"),
    (
        ("symbol or instrument", "仅在BTC的4小时趋势向上时参与。", "仅在4小时趋势向上时参与。"),
        ("timeframe", "仅在BTC的4小时趋势向上时参与。", "仅在BTC趋势向上时参与。"),
        (
            "market regime or context",
            "仅在单边趋势市场中顺势参与。",
            "沿当前方向参与。",
        ),
        ("volatility", "仅在波动率放大后等待突破。", "等待突破。"),
        ("liquidity", "仅在流动性充足时跟随突破。", "跟随突破。"),
        ("trading session", "仅在美盘时段等待突破。", "等待突破。"),
        ("level", "价格回踩前高位置后参与。", "价格回踩后参与。"),
        ("threshold", "涨幅超过3%后参与。", "价格上涨后参与。"),
        ("indicator", "MA20向上时寻找机会。", "趋势向上时寻找机会。"),
        ("confirmation", "等待4小时收盘确认后参与。", "价格触及后参与。"),
        ("exception", "除非成交量萎缩，否则突破后参与。", "突破后参与。"),
        ("invalidation", "跌破前低则规则失效并退出。", "价格回落时退出。"),
    ),
)
async def test_provider_bound_search_verifier_rejects_every_material_condition_class(
    monkeypatch: pytest.MonkeyPatch,
    condition_class: str,
    source_rule: str,
    dropped_rule: str,
) -> None:
    monkeypatch.setenv("TEST_AGGREGATION_KEY", "secret")
    requests: list[dict[str, object]] = []

    def respond(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        requests.append(payload)
        supplied = json.loads(payload["messages"][1]["content"].split("\n", 1)[1])
        if len(requests) == 1:
            catalog = supplied["catalog"]
            result = {
                "catalog_ref": supplied["catalog_ref"],
                "outputs": [
                    {
                        "category": item["category"],
                        "rule_body": dropped_rule
                        if item["category"] == "method"
                        else item["rule_body"],
                        "support_ids": [item["item_id"]],
                    }
                    for item in catalog
                ],
                "episode_specific_ids": [],
            }
        else:
            result = {
                "catalog_ref": supplied["catalog_ref"],
                "synthesis_ref": supplied["synthesis_ref"],
                "outputs": [
                    {
                        "output_index": index,
                        "entailed_no_new_claim": "accept",
                        "polarity_preserved": "accept",
                        "material_conditions_preserved": (
                            "reject" if output["category"] == "method" else "accept"
                        ),
                        "reusable_abstraction_acceptable": "accept",
                        "simplified_chinese_language": "accept",
                    }
                    for index, output in enumerate(supplied["synthesis"]["outputs"])
                ],
                "episode_specific": [],
                "complete_coverage": "accept",
                "category_preservation": "accept",
                "no_duplicate_or_remaining_mergeable_output": "accept",
                "priority_order_acceptable": "accept",
            }
        return httpx.Response(
            200,
            json={
                "model": "test-model",
                "choices": [{"message": {"content": json.dumps(result, ensure_ascii=False)}}],
            },
        )

    summary = StrategySummaryV1(
        subject="来源",
        core_strategies=(_rule("仅顺主要趋势交易。"),),
        methods=(_rule(source_rule),),
        risk_management=(_rule("风险敞口必须预设上限。"),),
    )
    transport = httpx.MockTransport(respond)
    aggregator = VerifiedStrategySynthesisAggregator(
        SiliconFlowStrategySynthesizer(_profile(), transport),
        SiliconFlowStrategySynthesisVerifier(_profile(), transport),
    )

    with pytest.raises(BilibiliNoteFailure) as failure:
        await aggregator.aggregate("主题", (summary,))

    assert failure.value.reason == "strategy_aggregation_semantics_rejected"
    assert len(requests) == 2
    for request in requests:
        prompt = request["messages"][1]["content"]
        assert condition_class in prompt
        assert all(item in prompt for item in MATERIAL_CONDITION_CLASSES)


async def test_provider_bound_search_verifier_rejects_mixed_english_prose(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TEST_AGGREGATION_KEY", "secret")
    requests = 0

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal requests
        requests += 1
        payload = json.loads(request.content)
        supplied = json.loads(payload["messages"][1]["content"].split("\n", 1)[1])
        if requests == 1:
            result = {
                "catalog_ref": supplied["catalog_ref"],
                "outputs": [
                    {
                        "category": item["category"],
                        "rule_body": (
                            "核心原则：Follow the market trend and wait for confirmation."
                            if item["category"] == "core_strategy"
                            else item["rule_body"]
                        ),
                        "support_ids": [item["item_id"]],
                    }
                    for item in supplied["catalog"]
                ],
                "episode_specific_ids": [],
            }
        else:
            result = {
                "catalog_ref": supplied["catalog_ref"],
                "synthesis_ref": supplied["synthesis_ref"],
                "outputs": [
                    {
                        "output_index": index,
                        "entailed_no_new_claim": "accept",
                        "polarity_preserved": "accept",
                        "material_conditions_preserved": "accept",
                        "reusable_abstraction_acceptable": "accept",
                        "simplified_chinese_language": (
                            "reject" if output["category"] == "core_strategy" else "accept"
                        ),
                    }
                    for index, output in enumerate(supplied["synthesis"]["outputs"])
                ],
                "episode_specific": [],
                "complete_coverage": "accept",
                "category_preservation": "accept",
                "no_duplicate_or_remaining_mergeable_output": "accept",
                "priority_order_acceptable": "accept",
            }
        return httpx.Response(
            200,
            json={
                "model": "test-model",
                "choices": [{"message": {"content": json.dumps(result, ensure_ascii=False)}}],
            },
        )

    transport = httpx.MockTransport(respond)
    aggregator = VerifiedStrategySynthesisAggregator(
        SiliconFlowStrategySynthesizer(_profile(), transport),
        SiliconFlowStrategySynthesisVerifier(_profile(), transport),
    )
    with pytest.raises(BilibiliNoteFailure) as failure:
        await aggregator.aggregate("主题", (_summary("甲"),))

    assert failure.value.reason == "strategy_aggregation_semantics_rejected"
    assert requests == 2


@pytest.mark.parametrize(
    "comparison",
    (
        "当 EMA5 < EMA20 > EMA60 时，保持观望并等待结构确认。",
        "当 0 < time > 1 时，等待结构确认。",
    ),
)
async def test_provider_synthesizer_accepts_technical_comparison_rule(
    monkeypatch: pytest.MonkeyPatch, comparison: str
) -> None:
    monkeypatch.setenv("TEST_AGGREGATION_KEY", "secret")
    catalog = (
        StrategyCatalogItem("S01:C01", "core_strategy", _rule(comparison)),
        StrategyCatalogItem("S01:M01", "method", _rule("等待结构确认后参与。")),
        StrategyCatalogItem("S01:R01", "risk_management", _rule("结构失效后退出。")),
    )
    catalog_ref = "sac_" + "1" * 64

    def respond(_request: httpx.Request) -> httpx.Response:
        result = {
            "catalog_ref": catalog_ref,
            "outputs": [
                {
                    "category": item.category,
                    "rule_body": item.rule.rule_body,
                    "support_ids": [item.item_id],
                }
                for item in catalog
            ],
            "episode_specific_ids": [],
        }
        return httpx.Response(
            200,
            json={
                "model": "test-model",
                "choices": [{"message": {"content": json.dumps(result, ensure_ascii=False)}}],
            },
        )

    synthesis = await SiliconFlowStrategySynthesizer(
        _profile(), httpx.MockTransport(respond)
    ).synthesize(catalog, catalog_ref)

    assert synthesis.outputs[0].rule.rule_body == comparison


@pytest.mark.parametrize(
    ("include_model", "model_value"),
    (
        pytest.param(False, None, id="missing"),
        pytest.param(True, None, id="null"),
        pytest.param(True, "", id="empty"),
        pytest.param(True, "different-model", id="mismatched"),
    ),
)
@pytest.mark.parametrize("stage", ("synthesis", "verifier"))
async def test_provider_roles_require_explicit_exact_model_identity(
    monkeypatch: pytest.MonkeyPatch,
    include_model: bool,
    model_value: object,
    stage: str,
) -> None:
    monkeypatch.setenv("TEST_AGGREGATION_KEY", "secret")
    calls = 0

    def respond(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        envelope: dict[str, object] = {"choices": [{"message": {"content": json.dumps({})}}]}
        if include_model:
            envelope["model"] = model_value
        return httpx.Response(200, json=envelope)

    catalog = (
        StrategyCatalogItem("S01:C01", "core_strategy", _rule("顺势交易。")),
        StrategyCatalogItem("S01:M01", "method", _rule("等待确认。")),
        StrategyCatalogItem("S01:R01", "risk_management", _rule("失效后退出。")),
    )
    catalog_ref = "sac_" + "1" * 64
    synthesis = _exact_synthesis(catalog, catalog_ref)
    transport = httpx.MockTransport(respond)

    with pytest.raises(BilibiliNoteFailure) as failure:
        if stage == "synthesis":
            await SiliconFlowStrategySynthesizer(_profile(), transport).synthesize(
                catalog, catalog_ref
            )
        else:
            await SiliconFlowStrategySynthesisVerifier(_profile(), transport).verify_synthesis(
                catalog, catalog_ref, synthesis, "sas_" + "2" * 64
            )

    expected_reason = (
        "strategy_aggregation_response_invalid"
        if stage == "synthesis"
        else "strategy_aggregation_verifier_invalid"
    )
    assert failure.value.code == "DISTILLATION_FAILED"
    assert failure.value.reason == expected_reason
    assert calls == 1


@pytest.mark.parametrize(
    "leaked_rule",
    (
        r"S01\\:C01：仅沿主要趋势方向寻找机会。",
        "s01:c01：仅沿主要趋势方向寻找机会。",
        "S01:\u200bC01：仅沿主要趋势方向寻找机会。",
        "依据 sac_" + "1" * 64 + " 综合后等待确认。",
        r"依据 SAC\_" + "A" * 64 + " 综合后等待确认。",
        "Model: test-model，等待价格确认。",
    ),
)
async def test_synthesizer_rejects_private_catalog_identity_in_rule_body(
    monkeypatch: pytest.MonkeyPatch, leaked_rule: str
) -> None:
    monkeypatch.setenv("TEST_AGGREGATION_KEY", "secret")
    catalog_ref = "sac_" + "1" * 64
    catalog = (
        StrategyCatalogItem("S01:C01", "core_strategy", _rule("顺势交易。")),
        StrategyCatalogItem("S01:M01", "method", _rule("等待确认。")),
        StrategyCatalogItem("S01:R01", "risk_management", _rule("失效后退出。")),
    )

    def respond(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        prompt = body["messages"][1]["content"]
        assert "Never copy a catalog or support ID into rule_body" in prompt
        result = {
            "catalog_ref": catalog_ref,
            "outputs": [
                {
                    "category": item.category,
                    "rule_body": (
                        leaked_rule if item.item_id == "S01:C01" else item.rule.rule_body
                    ),
                    "support_ids": [item.item_id],
                }
                for item in catalog
            ],
            "episode_specific_ids": [],
        }
        return httpx.Response(
            200,
            json={
                "model": "test-model",
                "choices": [{"message": {"content": json.dumps(result, ensure_ascii=False)}}],
            },
        )

    with pytest.raises(BilibiliNoteFailure) as failure:
        await SiliconFlowStrategySynthesizer(_profile(), httpx.MockTransport(respond)).synthesize(
            catalog, catalog_ref
        )

    assert failure.value.code == "DISTILLATION_FAILED"
    assert failure.value.reason == "strategy_aggregation_response_invalid"


@pytest.mark.parametrize(
    "stage,reason",
    [
        ("synthesis", "strategy_aggregation_timeout"),
        ("verifier", "strategy_aggregation_verifier_timeout"),
    ],
)
async def test_provider_timeout_is_stage_specific(
    monkeypatch: pytest.MonkeyPatch, stage: str, reason: str
) -> None:
    monkeypatch.setenv("TEST_AGGREGATION_KEY", "secret")

    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    transport = httpx.MockTransport(timeout)
    catalog = (
        StrategyCatalogItem("S01:C01", "core_strategy", _rule("顺势交易。")),
        StrategyCatalogItem("S01:M01", "method", _rule("等待确认。")),
        StrategyCatalogItem("S01:R01", "risk_management", _rule("失效后退出。")),
    )
    synthesis = _exact_synthesis(catalog, "sac_" + "1" * 64)
    with pytest.raises(BilibiliNoteFailure) as failure:
        if stage == "synthesis":
            await SiliconFlowStrategySynthesizer(_profile(), transport).synthesize(
                catalog, synthesis.catalog_ref
            )
        else:
            await SiliconFlowStrategySynthesisVerifier(_profile(), transport).verify_synthesis(
                catalog, synthesis.catalog_ref, synthesis, "sas_" + "2" * 64
            )
    assert failure.value.code == "DEADLINE_EXCEEDED"
    assert failure.value.reason == reason


async def test_provider_response_body_limit_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TEST_AGGREGATION_KEY", "secret")
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(200, stream=httpx.ByteStream(b"x" * 262_145))
    )
    catalog = (
        StrategyCatalogItem("S01:C01", "core_strategy", _rule("顺势交易。")),
        StrategyCatalogItem("S01:M01", "method", _rule("等待确认。")),
        StrategyCatalogItem("S01:R01", "risk_management", _rule("失效后退出。")),
    )
    with pytest.raises(BilibiliNoteFailure) as failure:
        await SiliconFlowStrategySynthesizer(_profile(), transport).synthesize(
            catalog, "sac_" + "1" * 64
        )
    assert failure.value.reason == "strategy_aggregation_response_invalid"


async def test_provider_request_limit_fails_before_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TEST_AGGREGATION_KEY", "secret")
    monkeypatch.setattr(adapter_module, "_AGGREGATION_REQUEST_BYTES", 1)
    calls = 0

    def respond(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(500)

    catalog = (
        StrategyCatalogItem("S01:C01", "core_strategy", _rule("顺势交易。")),
        StrategyCatalogItem("S01:M01", "method", _rule("等待确认。")),
        StrategyCatalogItem("S01:R01", "risk_management", _rule("失效后退出。")),
    )
    with pytest.raises(BilibiliNoteFailure) as failure:
        await SiliconFlowStrategySynthesizer(_profile(), httpx.MockTransport(respond)).synthesize(
            catalog, "sac_" + "1" * 64
        )
    assert failure.value.reason == "strategy_aggregation_response_invalid"
    assert calls == 0
