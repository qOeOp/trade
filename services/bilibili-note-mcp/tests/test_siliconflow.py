from __future__ import annotations

import asyncio
import json
import ssl
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
import pytest

from bilibili_note_mcp.adapters import asr_siliconflow, distillers
from bilibili_note_mcp.adapters.asr_siliconflow import SiliconFlowAsr
from bilibili_note_mcp.adapters.distillers import (
    _CATEGORY_CONTRACT,
    DeterministicDistiller,
    SiliconFlowCandidateVerifier,
    SiliconFlowDistiller,
    _contains_chinese,
)
from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.application.operator_events import operator_run
from bilibili_note_mcp.application.ports import (
    MATERIAL_CONDITION_CLASSES,
    AcquiredSource,
    DistillCandidate,
    FrameAsset,
    TranscriptResult,
    TranscriptSegment,
)
from bilibili_note_mcp.application.progress import NullProgressReporter
from bilibili_note_mcp.config import ModelProfile
from bilibili_note_mcp.domain.models import SourceV1


def _profile() -> ModelProfile:
    return ModelProfile(
        provider="siliconflow",
        base_url="https://example.invalid/v1",
        vision_model="test-vision",
        asr_model="test-asr",
        api_key_env="TEST_SILICONFLOW_KEY",
        timeout_seconds=1,
        max_output_tokens=100,
    )


def test_output_language_gate_requires_actual_chinese() -> None:
    assert _contains_chinese("价格突破 MA20")
    assert not _contains_chinese("English-only research summary")


def _source() -> AcquiredSource:
    return AcquiredSource(
        source=SourceV1(
            platform="bilibili",
            requested_url="https://www.bilibili.com/video/BV1bK411W797?p=1",
            canonical_url="https://www.bilibili.com/video/BV1bK411W797?p=1",
            video_id="BV1bK411W797",
            part_id="1",
            part_index=1,
            title="fixture",
            author_name="fixture",
            published_at="2026-08-11T00:00:00Z",
            duration_ms=30_000,
        ),
        media_path=Path("unused.mp4"),
        transcript=TranscriptResult(
            method="platform_subtitle",
            provider_ref=None,
            language="zh-CN",
            segments=(TranscriptSegment("E001", 0, 30_000, "看这里的支撑区域"),),
        ),
        source_snapshot_ref="bs_" + "a" * 64,
    )


def _frames() -> tuple[FrameAsset, ...]:
    return tuple(
        FrameAsset(
            frame_id=f"F{index:02d}",
            group_id=f"G{index:02d}",
            timestamp_ms=index * 10_000,
            width=1920,
            height=1080,
            png_bytes=b"png",
            asset_ref=str(index) * 64,
            transcript_refs=("E001",),
            selection_reason="deictic_cue",
        )
        for index in (1, 2)
    )


def _ordered_frames() -> tuple[FrameAsset, ...]:
    return tuple(
        FrameAsset(
            frame_id=f"F{index:02d}",
            group_id="G01" if index <= 3 else "G02",
            timestamp_ms=index * 1000,
            width=1920,
            height=1080,
            png_bytes=f"png-{index}".encode(),
            asset_ref=str(index) * 64,
            transcript_refs=("E001",),
            selection_reason=("ordered_relation_cue" if index <= 3 else "coverage"),
        )
        for index in range(1, 5)
    )


def _one_frame_per_group(group_count: int) -> tuple[FrameAsset, ...]:
    return tuple(
        FrameAsset(
            frame_id=f"F{index:02d}",
            group_id=f"G{index:02d}",
            timestamp_ms=index * 10_000,
            width=1920,
            height=1080,
            png_bytes=b"png",
            asset_ref=str(index) * 64,
            transcript_refs=("E001",),
            selection_reason="coverage",
        )
        for index in range(1, group_count + 1)
    )


def _candidate_with_visuals(visuals: list[dict[str, object]]) -> dict[str, object]:
    normalized_visuals: list[dict[str, object]] = []
    for visual in visuals:
        normalized = dict(visual)
        normalized.setdefault(
            "evidence_basis",
            "static_frame" if visual.get("disposition") == "supports_rule" else None,
        )
        normalized_visuals.append(normalized)
    return {
        "rules": [
            {"rule_body": "主要趋势决定方向偏好", "evidence_refs": ["E001"]},
            {"rule_body": "方向不明确时保持观望", "evidence_refs": ["E001"]},
            {"rule_body": "价格跌破失效位置后退出并限制风险敞口", "evidence_refs": ["E001"]},
        ],
        "visuals": normalized_visuals,
    }


def _with_valid_second_visual(visual: dict[str, object]) -> list[dict[str, object]]:
    return [
        visual,
        {
            "disposition": "no_material_increment",
            "rule_index": None,
            "evidence_basis": None,
        },
    ]


def _accepted_rule_verdict(index: int, category: str) -> dict[str, object]:
    return {
        "item_index": index,
        "intelligible": "accept",
        "source_resolvable": "accept",
        "entailed_no_new_claim": "accept",
        "polarity_preserved": "accept",
        "material_conditions_preserved": "accept",
        "reusable_abstraction_acceptable": "accept",
        "simplified_chinese_language": "accept",
        "classified_category": category,
    }


def _verification_wire(candidate: DistillCandidate) -> dict[str, object]:
    categorized_rules = tuple(
        "core_strategy" if index < 2 else "method" if index < 5 else "risk_management"
        for index, _item in enumerate(candidate.rules)
    )
    return {
        "source_coverage": "accept",
        "no_duplicate_or_remaining_mergeable_rule": "accept",
        "priority_order_acceptable": "accept",
        "rules": [
            _accepted_rule_verdict(index, category)
            for index, category in enumerate(categorized_rules)
        ],
        "visuals": [
            {
                "group_index": index,
                "rule_index": visual.rule_index,
                "materiality": (
                    "material" if visual.disposition == "supports_rule" else "no_material"
                ),
                "independent_support": (
                    "accept" if visual.disposition == "supports_rule" else "not_applicable"
                ),
                "rule_relation": (
                    "ordered" if visual.evidence_basis == "ordered_relation" else "none"
                ),
                "speech_authorized": (
                    "accept" if visual.evidence_basis == "ordered_relation" else "not_applicable"
                ),
                "same_visual_context": (
                    "accept" if visual.evidence_basis == "ordered_relation" else "not_applicable"
                ),
                "ordered_relation_support": (
                    "accept" if visual.evidence_basis == "ordered_relation" else "not_applicable"
                ),
            }
            for index, visual in enumerate(candidate.visuals)
        ],
    }


def _strict_provider_payload(
    *, model: str, content: dict[str, object], variant: str, nested_key: str
) -> bytes:
    def envelope(content_text: str) -> bytes:
        encoded = json.dumps(content_text, ensure_ascii=False)
        return (f'{{"model":"{model}","choices":[{{"message":{{"content":{encoded}}}}}]}}').encode()

    content_json = json.dumps(content, ensure_ascii=False, separators=(",", ":"))
    encoded_content = json.dumps(content_json, ensure_ascii=False)
    choices = f'"choices":[{{"message":{{"content":{encoded_content}}}}}]'
    if variant == "duplicate_model":
        return f'{{"model":"foreign","\\u006dodel":"{model}",{choices}}}'.encode()
    if variant == "duplicate_content":
        return (
            f'{{"model":"{model}","choices":[{{"message":'
            f'{{"content":"{{}}","\\u0063ontent":{encoded_content}}}}}]}}'
        ).encode()
    if variant == "duplicate_nested":
        duplicate = f'"{nested_key}":"conflict","\\u{ord(nested_key[0]):04x}{nested_key[1:]}":'
        content_json = content_json.replace(f'"{nested_key}":', duplicate, 1)
        encoded_content = json.dumps(content_json, ensure_ascii=False)
        return (
            f'{{"model":"{model}","choices":[{{"message":{{"content":{encoded_content}}}}}]}}'
        ).encode()
    if variant == "nan":
        return f'{{"model":"{model}","usage":{{"total":NaN}},{choices}}}'.encode()
    if variant == "infinity":
        return f'{{"model":"{model}","usage":{{"total":Infinity}},{choices}}}'.encode()
    if variant == "negative_infinity":
        return f'{{"model":"{model}","usage":{{"total":-Infinity}},{choices}}}'.encode()
    if variant == "float_overflow":
        return f'{{"model":"{model}","usage":{{"total":1e400}},{choices}}}'.encode()
    if variant == "content_nan":
        return envelope('{"probe":NaN}')
    if variant == "content_infinity":
        return envelope('{"probe":Infinity}')
    if variant == "content_negative_infinity":
        return envelope('{"probe":-Infinity}')
    if variant == "content_float_overflow":
        return envelope('{"probe":1e400}')
    if variant == "root_array":
        return b"[]"
    if variant == "content_array":
        return envelope("[]")
    if variant == "malformed":
        return b'{"model":'
    if variant == "content_malformed":
        return envelope("{")
    raise AssertionError(f"unknown variant: {variant}")


@pytest.mark.parametrize("role", ("author", "verifier"))
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
async def test_vision_provider_roles_reject_ambiguous_or_nonfinite_json(
    monkeypatch: pytest.MonkeyPatch, role: str, variant: str
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    frames = _frames()
    candidate = await DeterministicDistiller().distill(_source(), frames)
    content = (
        _candidate_with_visuals(
            [
                {"disposition": "no_material_increment", "rule_index": None},
                {"disposition": "no_material_increment", "rule_index": None},
            ]
        )
        if role == "author"
        else _verification_wire(candidate)
    )
    payload = _strict_provider_payload(
        model="test-vision",
        content=content,
        variant=variant,
        nested_key="rule_body" if role == "author" else "intelligible",
    )
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, content=payload))

    with pytest.raises(BilibiliNoteFailure) as failure:
        if role == "author":
            await SiliconFlowDistiller(profile=_profile(), transport=transport).distill(
                _source(), frames
            )
        else:
            await SiliconFlowCandidateVerifier(profile=_profile(), transport=transport).verify(
                _source(), frames, candidate
            )

    assert failure.value.code == "DISTILLATION_FAILED"
    assert failure.value.reason == (
        "model_identity_changed"
        if variant
        in {
            "duplicate_model",
            "duplicate_content",
            "nan",
            "infinity",
            "negative_infinity",
            "float_overflow",
            "root_array",
            "malformed",
        }
        else "model_response_invalid"
        if role == "author"
        else "verifier_response_invalid"
    )


@pytest.mark.parametrize(
    ("include_model", "model_value"),
    (
        pytest.param(False, None, id="missing"),
        pytest.param(True, None, id="null"),
        pytest.param(True, "", id="empty"),
        pytest.param(True, "different-model", id="mismatched"),
    ),
)
@pytest.mark.parametrize("role", ("author", "verifier"))
async def test_vision_provider_roles_require_explicit_exact_model_identity(
    monkeypatch: pytest.MonkeyPatch,
    include_model: bool,
    model_value: object,
    role: str,
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    frames = _frames()
    candidate = await DeterministicDistiller().distill(_source(), frames)
    content = (
        _candidate_with_visuals(
            [
                {
                    "disposition": "no_material_increment",
                    "rule_index": None,
                },
                {
                    "disposition": "no_material_increment",
                    "rule_index": None,
                },
            ]
        )
        if role == "author"
        else _verification_wire(candidate)
    )

    def respond(_request: httpx.Request) -> httpx.Response:
        envelope: dict[str, object] = {"choices": [{"message": {"content": json.dumps(content)}}]}
        if include_model:
            envelope["model"] = model_value
        return httpx.Response(200, json=envelope)

    transport = httpx.MockTransport(respond)
    with pytest.raises(BilibiliNoteFailure) as failure:
        if role == "author":
            await SiliconFlowDistiller(profile=_profile(), transport=transport).distill(
                _source(), frames
            )
        else:
            await SiliconFlowCandidateVerifier(profile=_profile(), transport=transport).verify(
                _source(), frames, candidate
            )

    assert failure.value.code == "DISTILLATION_FAILED"
    assert failure.value.reason == "model_identity_changed"


async def test_distiller_sends_time_aligned_vision_and_validates_wire(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")

    def respond(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["response_format"]["type"] == "json_schema"
        assert body["response_format"]["json_schema"]["name"] == (
            "bilibili_research_brief_candidate"
        )
        schema = body["response_format"]["json_schema"]["schema"]
        assert schema["additionalProperties"] is False
        assert set(schema["required"]) == {"rules", "visuals"}
        assert schema["properties"]["rules"]["minItems"] == 1
        assert schema["properties"]["rules"]["maxItems"] == 24
        bound_ref_schema = schema["$defs"]["_WireBound"]["properties"]["evidence_refs"]
        assert bound_ref_schema["items"]["pattern"] == r"^E[0-9]{3}$"
        assert set(schema["$defs"]["_WireBound"]["required"]) == {
            "rule_body",
            "evidence_refs",
        }
        assert "text" not in schema["$defs"]["_WireBound"]["properties"]
        visual_schema = schema["$defs"]["_WireSupportsRuleVisual"]
        assert "transcript_refs" not in visual_schema["properties"]
        assert "frame_ids" not in visual_schema["properties"]
        assert "group_id" not in visual_schema["properties"]
        assert "method" not in visual_schema["properties"]
        assert visual_schema["properties"]["rule_index"]["minimum"] == 0
        assert set(visual_schema["required"]) == {
            "disposition",
            "rule_index",
            "evidence_basis",
        }
        assert set(schema["$defs"]["_WireNoMaterialVisual"]["required"]) == {
            "disposition",
            "rule_index",
            "evidence_basis",
        }
        assert schema["properties"]["visuals"]["minItems"] == 2
        assert schema["properties"]["visuals"]["maxItems"] == 2
        content = body["messages"][1]["content"]
        assert len([item for item in content if item["type"] == "image_url"]) == 2
        prompt = content[0]["text"]
        assert "chronological recap" in prompt
        assert "Delete greetings" in prompt
        assert "Return one flat rules catalog without core/method/risk category fields" in prompt
        assert "supports at least one exact visible relation inside that rule" in prompt
        assert "highest cross-context reusable decision value" in prompt
        assert "Preserve its polarity, permission, prohibition, priority" in prompt
        assert "Do not preserve speaker-attribution prefixes" in prompt
        assert "Never infer temporal continuity" in prompt
        assert prompt.count(_CATEGORY_CONTRACT) == 0
        assert all(condition in prompt for condition in MATERIAL_CONDITION_CLASSES)
        assert "verifier is the sole category authority" in prompt
        assert '"transcript_refs":["E001"]' in prompt
        candidate = {
            "rules": [
                {"rule_body": "主要趋势决定方向偏好", "evidence_refs": ["E001"]},
                {
                    "rule_body": "画面补足相对位置；补足口述没有表达的空间关系。",
                    "evidence_refs": ["E001"],
                },
                {
                    "rule_body": "价格跌破失效位置后退出并限制风险敞口",
                    "evidence_refs": ["E001"],
                },
            ],
            "visuals": [
                {
                    "disposition": "supports_rule",
                    "rule_index": 0,
                    "evidence_basis": "static_frame",
                },
                {
                    "disposition": "no_material_increment",
                    "rule_index": None,
                    "evidence_basis": None,
                },
            ],
        }
        return httpx.Response(
            200,
            json={
                "model": "test-vision",
                "choices": [{"message": {"content": json.dumps(candidate)}}],
            },
        )

    frames = _frames()
    result = await SiliconFlowDistiller(
        profile=_profile(), transport=httpx.MockTransport(respond)
    ).distill(_source(), frames)
    assert result.model_ref == "siliconflow:test-vision"
    assert result.rules[0][0].rule_body == "主要趋势决定方向偏好"
    assert result.rules[0][1] == ("E001",)
    assert result.rules[1][1] == ("E001",)
    assert result.visuals[0].rule_index == 0


async def test_distiller_ordered_group_wire_keeps_host_membership_private(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")

    def respond(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        schema = body["response_format"]["json_schema"]["schema"]
        support = schema["$defs"]["_WireSupportsRuleVisual"]
        assert set(support["properties"]) == {
            "disposition",
            "rule_index",
            "evidence_basis",
        }
        assert "group_id" not in json.dumps(support)
        content = body["messages"][1]["content"]
        assert len([item for item in content if item["type"] == "image_url"]) == 4
        prompt = content[0]["text"]
        assert '"group_index":0,"member_index":0,"member_count":3' in prompt
        assert "Never infer temporal continuity" in prompt
        candidate = _candidate_with_visuals(
            [
                {
                    "disposition": "supports_rule",
                    "rule_index": 0,
                    "evidence_basis": "ordered_relation",
                },
                {
                    "disposition": "no_material_increment",
                    "rule_index": None,
                    "evidence_basis": None,
                },
            ]
        )
        return httpx.Response(
            200,
            json={
                "model": "test-vision",
                "choices": [{"message": {"content": json.dumps(candidate)}}],
            },
        )

    result = await SiliconFlowDistiller(
        profile=_profile(), transport=httpx.MockTransport(respond)
    ).distill(_source(), _ordered_frames())

    assert result.visuals[0].evidence_basis == "ordered_relation"
    assert result.visuals[1].evidence_basis is None


async def test_verifier_ordered_group_requires_speech_context_and_relation_guards(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    frames = _ordered_frames()
    candidate = await DeterministicDistiller().distill(_source(), frames)
    categorized_rules = tuple(
        "core_strategy" if index < 2 else "method" if index < 5 else "risk_management"
        for index, _item in enumerate(candidate.rules)
    )

    def respond(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        prompt = body["messages"][1]["content"][0]["text"]
        assert "exact group's transcript_refs explicitly authorize" in prompt
        assert (
            len([item for item in body["messages"][1]["content"] if item["type"] == "image_url"])
            == 4
        )
        verdict = {
            "source_coverage": "accept",
            "no_duplicate_or_remaining_mergeable_rule": "accept",
            "priority_order_acceptable": "accept",
            "rules": [
                _accepted_rule_verdict(index, category)
                for index, category in enumerate(categorized_rules)
            ],
            "visuals": [
                {
                    "group_index": index,
                    "rule_index": visual.rule_index,
                    "materiality": (
                        "material" if visual.disposition == "supports_rule" else "no_material"
                    ),
                    "independent_support": (
                        "accept" if visual.disposition == "supports_rule" else "not_applicable"
                    ),
                    "rule_relation": (
                        "ordered" if visual.evidence_basis == "ordered_relation" else "none"
                    ),
                    "speech_authorized": (
                        "accept"
                        if visual.evidence_basis == "ordered_relation"
                        else "not_applicable"
                    ),
                    "same_visual_context": (
                        "accept"
                        if visual.evidence_basis == "ordered_relation"
                        else "not_applicable"
                    ),
                    "ordered_relation_support": (
                        "accept"
                        if visual.evidence_basis == "ordered_relation"
                        else "not_applicable"
                    ),
                }
                for index, visual in enumerate(candidate.visuals)
            ],
        }
        return httpx.Response(
            200,
            json={
                "model": "test-vision",
                "choices": [{"message": {"content": json.dumps(verdict)}}],
            },
        )

    result = await SiliconFlowCandidateVerifier(
        profile=_profile(), transport=httpx.MockTransport(respond)
    ).verify(_source(), frames, candidate)

    assert result.visuals[0].rule_relation == "ordered"
    assert result.visuals[0].speech_authorized == "accept"


async def test_verifier_uses_exact_positional_schema_and_returns_no_public_prose(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    candidate = await DeterministicDistiller().distill(_source(), _frames())
    expected_categories = tuple(
        "core_strategy" if index < 2 else "method" if index < 5 else "risk_management"
        for index, _item in enumerate(candidate.rules)
    )
    rule_count = len(candidate.rules)

    def respond(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["max_tokens"] == 100
        assert body["response_format"]["json_schema"]["name"] == ("bilibili_candidate_verification")
        schema = body["response_format"]["json_schema"]["schema"]
        assert schema["additionalProperties"] is False
        assert "source_coverage" in schema["required"]
        assert "no_duplicate_or_remaining_mergeable_rule" in schema["required"]
        assert "priority_order_acceptable" in schema["required"]
        assert schema["properties"]["rules"]["minItems"] == rule_count
        assert schema["properties"]["rules"]["maxItems"] == rule_count
        assert schema["properties"]["visuals"]["minItems"] == 2
        assert schema["properties"]["visuals"]["maxItems"] == 2
        assert set(schema["$defs"]["_WireRuleVerdict"]["properties"]) == {
            "item_index",
            "intelligible",
            "source_resolvable",
            "entailed_no_new_claim",
            "polarity_preserved",
            "material_conditions_preserved",
            "reusable_abstraction_acceptable",
            "simplified_chinese_language",
            "classified_category",
        }
        assert set(schema["$defs"]["_WireVisualVerdict"]["properties"]) == {
            "group_index",
            "rule_index",
            "materiality",
            "independent_support",
            "rule_relation",
            "speech_authorized",
            "same_visual_context",
            "ordered_relation_support",
        }
        assert "rule_index" in schema["$defs"]["_WireVisualVerdict"]["required"]
        assert (
            len([item for item in body["messages"][1]["content"] if item["type"] == "image_url"])
            == 2
        )
        prompt = body["messages"][1]["content"][0]["text"]
        assert prompt.count(_CATEGORY_CONTRACT) == 1
        assert "uniquely bound material visual" in prompt
        assert "semantic paraphrases" in prompt
        assert "one-off price narration" in prompt
        assert "same instrument or direction" in prompt
        assert "at least one exact material relation inside the bound rule" in prompt
        assert "threshold" in prompt
        assert all(condition in prompt for condition in MATERIAL_CONDITION_CLASSES)
        assert "English prose sentence or clause" in prompt
        untrusted = json.loads(prompt.split("\nUntrusted source and candidate:\n", 1)[1])
        assert all(
            set(rule) == {"item_index", "rule_body", "evidence_refs"} for rule in untrusted["rules"]
        )
        assert all("category" not in rule for rule in untrusted["rules"])
        assert [visual["transcript_refs"] for visual in untrusted["visuals"]] == [
            ["E001"],
            ["E001"],
        ]
        verdict = {
            "source_coverage": "accept",
            "no_duplicate_or_remaining_mergeable_rule": "accept",
            "priority_order_acceptable": "accept",
            "rules": [
                _accepted_rule_verdict(index, expected_categories[index])
                for index in range(rule_count)
            ],
            "visuals": [
                {
                    "group_index": index,
                    "rule_index": visual.rule_index,
                    "materiality": (
                        "material" if visual.disposition == "supports_rule" else "no_material"
                    ),
                    "independent_support": (
                        "accept" if visual.disposition == "supports_rule" else "not_applicable"
                    ),
                    "rule_relation": (
                        "ordered" if visual.evidence_basis == "ordered_relation" else "none"
                    ),
                    "speech_authorized": (
                        "accept"
                        if visual.evidence_basis == "ordered_relation"
                        else "not_applicable"
                    ),
                    "same_visual_context": (
                        "accept"
                        if visual.evidence_basis == "ordered_relation"
                        else "not_applicable"
                    ),
                    "ordered_relation_support": (
                        "accept"
                        if visual.evidence_basis == "ordered_relation"
                        else "not_applicable"
                    ),
                }
                for index, visual in enumerate(candidate.visuals)
            ],
        }
        return httpx.Response(
            200,
            json={
                "model": "test-vision",
                "choices": [{"message": {"content": json.dumps(verdict)}}],
            },
        )

    result = await SiliconFlowCandidateVerifier(
        profile=_profile(), transport=httpx.MockTransport(respond)
    ).verify(_source(), _frames(), candidate)

    assert [item.item_index for item in result.rules] == list(range(rule_count))
    assert [item.group_index for item in result.visuals] == [0, 1]
    assert all(item.intelligible == "accept" for item in result.rules)
    assert result.source_coverage == "accept"
    assert result.no_duplicate_or_remaining_mergeable_rule == "accept"
    assert result.priority_order_acceptable == "accept"


@pytest.mark.parametrize(
    "mutate",
    (
        lambda value: value["rules"].pop(),
        lambda value: value["rules"][0].update({"explanation": "不得出现解释"}),
        lambda value: value["visuals"][0].pop("rule_index"),
        lambda value: value.pop("source_coverage"),
        lambda value: value.pop("no_duplicate_or_remaining_mergeable_rule"),
        lambda value: value.pop("priority_order_acceptable"),
        lambda value: value["rules"][0].pop("classified_category"),
        lambda value: value["rules"][0].pop("polarity_preserved"),
        lambda value: value["rules"][0].pop("material_conditions_preserved"),
        lambda value: value["rules"][0].pop("simplified_chinese_language"),
        lambda value: value["visuals"][0].pop("materiality"),
    ),
)
async def test_verifier_rejects_missing_or_extra_compatible_representation(
    monkeypatch: pytest.MonkeyPatch,
    mutate: Callable[[dict[str, Any]], object],
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    candidate = await DeterministicDistiller().distill(_source(), _frames())
    categorized_rules = tuple(
        (
            "core_strategy" if index < 2 else "method" if index < 5 else "risk_management",
            item,
        )
        for index, item in enumerate(candidate.rules)
    )
    verdict = {
        "source_coverage": "accept",
        "no_duplicate_or_remaining_mergeable_rule": "accept",
        "priority_order_acceptable": "accept",
        "rules": [
            _accepted_rule_verdict(index, category)
            for index, (category, _item) in enumerate(categorized_rules)
        ],
        "visuals": [
            {
                "group_index": index,
                "rule_index": item.rule_index,
                "materiality": (
                    "material" if item.disposition == "supports_rule" else "no_material"
                ),
                "independent_support": (
                    "accept" if item.disposition == "supports_rule" else "not_applicable"
                ),
                "rule_relation": (
                    "ordered" if item.evidence_basis == "ordered_relation" else "none"
                ),
                "speech_authorized": (
                    "accept" if item.evidence_basis == "ordered_relation" else "not_applicable"
                ),
                "same_visual_context": (
                    "accept" if item.evidence_basis == "ordered_relation" else "not_applicable"
                ),
                "ordered_relation_support": (
                    "accept" if item.evidence_basis == "ordered_relation" else "not_applicable"
                ),
            }
            for index, item in enumerate(candidate.visuals)
        ],
    }
    mutate(verdict)

    def respond(request: httpx.Request) -> httpx.Response:
        del request
        return httpx.Response(
            200,
            json={
                "model": "test-vision",
                "choices": [{"message": {"content": json.dumps(verdict)}}],
            },
        )

    with pytest.raises(BilibiliNoteFailure) as failure:
        await SiliconFlowCandidateVerifier(
            profile=_profile(), transport=httpx.MockTransport(respond)
        ).verify(_source(), _frames(), candidate)

    assert failure.value.reason == "verifier_response_invalid"


def test_old_wire_text_field_is_rejected_without_compatibility() -> None:
    candidate = _candidate_with_visuals(
        _with_valid_second_visual(
            {
                "disposition": "supports_rule",
                "rule_index": 0,
            }
        )
    )
    candidate["rules"] = [{"text": "旧字段", "evidence_refs": ["E001"]}]

    with pytest.raises(ValueError):
        distillers._WireCandidate.model_validate(candidate)


async def test_vision_effect_events_share_request_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    records: list[dict[str, object]] = []

    def write(fd: int, payload: bytes) -> int:
        assert fd == 2
        records.append(json.loads(payload))
        return len(payload)

    def respond(request: httpx.Request) -> httpx.Response:
        del request
        return httpx.Response(
            200,
            json={
                "model": "test-vision",
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                _candidate_with_visuals(
                                    [
                                        {
                                            "disposition": "no_material_increment",
                                            "rule_index": None,
                                        },
                                        {
                                            "disposition": "no_material_increment",
                                            "rule_index": None,
                                        },
                                    ]
                                )
                            )
                        }
                    }
                ],
            },
        )

    monkeypatch.setattr("bilibili_note_mcp.application.operator_events.os.write", write)
    with operator_run({"tool": "fixture", "arguments": {}}):
        await SiliconFlowDistiller(
            profile=_profile(), transport=httpx.MockTransport(respond)
        ).distill(_source(), _frames())

    assert [record["event"] for record in records] == ["vision_started", "vision_completed"]
    assert len({record["run_id"] for record in records}) == 1
    assert len({record["input_ref"] for record in records}) == 1
    assert all(record["groups"] == 2 and record["frames"] == 2 for record in records)


@pytest.mark.parametrize("group_count", (2, 5))
async def test_distiller_locks_visual_wire_to_exact_host_group_count(
    monkeypatch: pytest.MonkeyPatch, group_count: int
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")

    def respond(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        schema = body["response_format"]["json_schema"]["schema"]
        visual_property = schema["properties"]["visuals"]
        assert visual_property["minItems"] == group_count
        assert visual_property["maxItems"] == group_count
        assert "group_id" not in schema["$defs"]["_WireSupportsRuleVisual"]["properties"]
        assert "group_id" not in schema["$defs"]["_WireNoMaterialVisual"]["properties"]
        candidate = _candidate_with_visuals(
            [
                {
                    "disposition": "no_material_increment",
                    "rule_index": None,
                }
                for _ in range(group_count)
            ]
        )
        return httpx.Response(
            200,
            json={
                "model": "test-vision",
                "choices": [{"message": {"content": json.dumps(candidate)}}],
            },
        )

    result = await SiliconFlowDistiller(
        profile=_profile(), transport=httpx.MockTransport(respond)
    ).distill(_source(), _one_frame_per_group(group_count))

    assert len(result.visuals) == group_count


@pytest.mark.parametrize("group_count", (1, 6))
async def test_distiller_rejects_visual_group_count_outside_two_to_five(
    monkeypatch: pytest.MonkeyPatch, group_count: int
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")

    with pytest.raises(BilibiliNoteFailure) as failure:
        await SiliconFlowDistiller(
            profile=_profile(), transport=httpx.MockTransport(lambda _: httpx.Response(500))
        ).distill(_source(), _one_frame_per_group(group_count))

    assert failure.value.reason == "model_visual_groups_invalid"


@pytest.mark.parametrize(
    "visual",
    (
        {"disposition": "supports_rule", "rule_index": -1},
        {"disposition": "supports_rule", "rule_index": "0"},
        {"disposition": "no_material_increment"},
        {"disposition": "no_material_increment", "rule_index": 0},
        {"disposition": "supports_method", "method_index": 0},
        {"disposition": "supports_rule", "rule_index": 0, "method_index": 0},
    ),
)
async def test_distiller_rejects_invalid_or_cross_disposition_rule_index(
    monkeypatch: pytest.MonkeyPatch,
    visual: dict[str, object],
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")

    def respond(request: httpx.Request) -> httpx.Response:
        candidate = _candidate_with_visuals(_with_valid_second_visual(visual))
        return httpx.Response(
            200,
            json={
                "model": "test-vision",
                "choices": [{"message": {"content": json.dumps(candidate)}}],
            },
        )

    with pytest.raises(BilibiliNoteFailure) as failure:
        await SiliconFlowDistiller(
            profile=_profile(), transport=httpx.MockTransport(respond)
        ).distill(_source(), _frames())

    assert failure.value.reason == "model_response_invalid"


async def test_distiller_rejects_rule_index_outside_returned_rule_catalog(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")

    def respond(request: httpx.Request) -> httpx.Response:
        candidate = _candidate_with_visuals(
            _with_valid_second_visual({"disposition": "supports_rule", "rule_index": 10})
        )
        return httpx.Response(
            200,
            json={
                "model": "test-vision",
                "choices": [{"message": {"content": json.dumps(candidate)}}],
            },
        )

    with pytest.raises(BilibiliNoteFailure) as failure:
        await SiliconFlowDistiller(
            profile=_profile(), transport=httpx.MockTransport(respond)
        ).distill(_source(), _frames())

    assert failure.value.reason == "visual_rule_index_invalid"


async def test_distiller_rejects_model_echoed_visual_group_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")

    def respond(request: httpx.Request) -> httpx.Response:
        candidate = _candidate_with_visuals(
            _with_valid_second_visual(
                {
                    "group_id": "G01",
                    "disposition": "no_material_increment",
                    "rule_index": None,
                }
            )
        )
        return httpx.Response(
            200,
            json={
                "model": "test-vision",
                "choices": [{"message": {"content": json.dumps(candidate)}}],
            },
        )

    with pytest.raises(BilibiliNoteFailure) as failure:
        await SiliconFlowDistiller(
            profile=_profile(), transport=httpx.MockTransport(respond)
        ).distill(_source(), _frames())

    assert failure.value.reason == "model_response_invalid"


@pytest.mark.parametrize(
    "private_field",
    ("observation", "contribution", "method", "evidence_refs", "frame_ids"),
)
async def test_visual_wire_rejects_every_separate_private_claim_or_binding(
    monkeypatch: pytest.MonkeyPatch,
    private_field: str,
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")

    def respond(request: httpx.Request) -> httpx.Response:
        visual: dict[str, object] = {
            "disposition": "supports_rule",
            "rule_index": 0,
            private_field: "不得存在的私有事实",
        }
        candidate = _candidate_with_visuals(_with_valid_second_visual(visual))
        return httpx.Response(
            200,
            json={
                "model": "test-vision",
                "choices": [{"message": {"content": json.dumps(candidate)}}],
            },
        )

    with pytest.raises(BilibiliNoteFailure) as failure:
        await SiliconFlowDistiller(
            profile=_profile(), transport=httpx.MockTransport(respond)
        ).distill(_source(), _frames())

    assert failure.value.reason == "model_response_invalid"


async def test_distiller_maps_low_level_tls_failure_to_stable_domain_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")

    def respond(request: httpx.Request) -> httpx.Response:
        raise ssl.SSLError("record layer failure")

    frames = _frames()

    with pytest.raises(BilibiliNoteFailure) as failure:
        await SiliconFlowDistiller(
            profile=_profile(), transport=httpx.MockTransport(respond)
        ).distill(_source(), frames)
    assert failure.value.code == "DISTILLATION_FAILED"
    assert failure.value.reason == "model_response_invalid"


async def test_asr_uses_host_owned_45_second_alignment_windows(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")

    extracted_suffixes: list[str] = []

    async def fake_extract(
        _media_path: Path, output: Path, *, start_ms: int, duration_ms: int
    ) -> None:
        extracted_suffixes.append(output.suffix)
        await asyncio.to_thread(output.write_bytes, f"{start_ms}:{duration_ms}".encode())

    calls = 0

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"text": f"第{calls}段转写"})

    monkeypatch.setattr(asr_siliconflow, "_extract_audio", fake_extract)
    result = await SiliconFlowAsr(
        profile=_profile(), transport=httpx.MockTransport(respond)
    ).transcribe(tmp_path / "source.mp4", 91_000, tmp_path, NullProgressReporter())

    assert [(item.start_ms, item.end_ms) for item in result.segments] == [
        (0, 45_000),
        (45_000, 90_000),
        (90_000, 91_000),
    ]
    assert calls == 3
    assert extracted_suffixes == [".mp3", ".mp3", ".mp3"]


async def test_asr_provider_capacity_is_shared_across_parallel_candidates(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    entered_three = asyncio.Event()
    release = asyncio.Event()
    active = 0
    peak = 0
    calls = 0

    async def fake_extract(
        _media_path: Path, output: Path, *, start_ms: int, duration_ms: int
    ) -> None:
        await asyncio.to_thread(output.write_bytes, f"{start_ms}:{duration_ms}".encode())

    async def respond(request: httpx.Request) -> httpx.Response:
        nonlocal active, peak, calls
        del request
        calls += 1
        active += 1
        peak = max(peak, active)
        if active == 3:
            entered_three.set()
        try:
            await release.wait()
            return httpx.Response(200, json={"text": f"窗口 {calls}"})
        finally:
            active -= 1

    first_workspace = tmp_path / "first"
    second_workspace = tmp_path / "second"
    first_workspace.mkdir()
    second_workspace.mkdir()
    asr = SiliconFlowAsr(profile=_profile(), transport=httpx.MockTransport(respond))
    monkeypatch.setattr(asr_siliconflow, "_extract_audio", fake_extract)

    tasks = (
        asyncio.create_task(
            asr.transcribe(tmp_path / "first.mp4", 135_000, first_workspace, NullProgressReporter())
        ),
        asyncio.create_task(
            asr.transcribe(
                tmp_path / "second.mp4", 135_000, second_workspace, NullProgressReporter()
            )
        ),
    )
    await asyncio.wait_for(entered_three.wait(), timeout=1)
    await asyncio.sleep(0)
    assert active == 3
    release.set()
    results = await asyncio.gather(*tasks)

    assert [len(result.segments) for result in results] == [3, 3]
    assert calls == 6
    assert peak == 3


async def test_asr_retries_one_transient_invalid_response(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    audio = tmp_path / "audio.flac"
    audio.write_bytes(b"audio")
    calls = 0

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(200, content=b"not-json")
        return httpx.Response(200, json={"text": "恢复后的转写"})

    async def no_sleep(_delay: float) -> None:
        return None

    monkeypatch.setattr(asr_siliconflow.asyncio, "sleep", no_sleep)
    text = await SiliconFlowAsr(
        profile=_profile(), transport=httpx.MockTransport(respond)
    )._transcribe_file(audio)

    assert text == "恢复后的转写"
    assert calls == 2


@pytest.mark.parametrize(
    ("status", "payload", "expected_code"),
    [
        (400, {"message": "bad request"}, "TRANSCRIPT_UNAVAILABLE"),
        (200, {"text": ""}, "TRANSCRIPT_UNAVAILABLE"),
        (200, {"text": 123}, "TRANSCRIPT_UNAVAILABLE"),
    ],
)
async def test_asr_does_not_retry_permanent_provider_outcomes(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    status: int,
    payload: dict[str, object],
    expected_code: str,
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    audio = tmp_path / "audio.flac"
    audio.write_bytes(b"audio")
    calls = 0

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(status, json=payload)

    with pytest.raises(BilibiliNoteFailure) as failure:
        await SiliconFlowAsr(
            profile=_profile(), transport=httpx.MockTransport(respond)
        )._transcribe_file(audio)

    assert failure.value.code == expected_code
    assert calls == 1


async def test_asr_retries_rate_limit_and_honors_bounded_recovery(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    audio = tmp_path / "audio.flac"
    audio.write_bytes(b"audio")
    calls = 0
    observed_delays: list[float] = []

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls < 3:
            return httpx.Response(429, headers={"Retry-After": "1"}, json={"message": "slow"})
        return httpx.Response(200, json={"text": "限流后恢复"})

    async def fake_sleep(delay: float) -> None:
        observed_delays.append(delay)

    monkeypatch.setattr(asr_siliconflow.asyncio, "sleep", fake_sleep)
    text = await SiliconFlowAsr(
        profile=_profile(), transport=httpx.MockTransport(respond)
    )._transcribe_file(audio)

    assert text == "限流后恢复"
    assert calls == 3
    assert observed_delays == [1.0, 1.5]


class _ChunkedBytes(httpx.AsyncByteStream):
    def __init__(self, *chunks: bytes) -> None:
        self._chunks = chunks

    async def __aiter__(self):  # type: ignore[no-untyped-def]
        for chunk in self._chunks:
            yield chunk


@pytest.mark.parametrize("declared", [True, False])
async def test_asr_response_body_is_bounded_before_json_parse(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    declared: bool,
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    monkeypatch.setattr(asr_siliconflow, "ASR_RESPONSE_BYTES", 16)
    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"audio")

    def respond(request: httpx.Request) -> httpx.Response:
        payload = b'{"text":"' + b"x" * 20 + b'"}'
        if declared:
            return httpx.Response(200, content=payload)
        return httpx.Response(
            200,
            headers={"Transfer-Encoding": "chunked"},
            stream=_ChunkedBytes(payload[:10], payload[10:]),
        )

    with pytest.raises(BilibiliNoteFailure) as failure:
        await SiliconFlowAsr(
            profile=_profile(), transport=httpx.MockTransport(respond)
        )._transcribe_file(audio)

    assert failure.value.reason == "asr_response_bytes_exceeded"


async def test_asr_normalized_window_text_is_bounded(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    monkeypatch.setattr(asr_siliconflow, "ASR_WINDOW_TEXT_BYTES", 6)
    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"audio")

    with pytest.raises(BilibiliNoteFailure) as failure:
        await SiliconFlowAsr(
            profile=_profile(),
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, json={"text": "价格支撑"})
            ),
        )._transcribe_file(audio)

    assert failure.value.reason == "asr_text_bytes_exceeded"


async def test_asr_reuses_one_client_for_all_windows_and_closes_once(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")

    async def fake_extract(
        _media_path: Path, output: Path, *, start_ms: int, duration_ms: int
    ) -> None:
        await asyncio.to_thread(output.write_bytes, f"{start_ms}:{duration_ms}".encode())

    requests = 0

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal requests
        requests += 1
        return httpx.Response(200, json={"text": f"窗口 {requests}"})

    class TrackingClient(httpx.AsyncClient):
        close_calls = 0

        async def aclose(self) -> None:
            self.close_calls += 1
            await super().aclose()

    client = TrackingClient(transport=httpx.MockTransport(respond), trust_env=False)
    asr = SiliconFlowAsr(profile=_profile())
    monkeypatch.setattr(asr_siliconflow, "_extract_audio", fake_extract)
    monkeypatch.setattr(asr, "_new_client", lambda: client)

    result = await asr.transcribe(tmp_path / "source.mp4", 91_000, tmp_path, NullProgressReporter())

    assert len(result.segments) == 3
    assert requests == 3
    assert client.close_calls == 1
    assert client.is_closed


async def test_asr_repeated_cancellation_waits_for_exactly_one_client_close(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    request_started = asyncio.Event()
    close_started = asyncio.Event()
    allow_close = asyncio.Event()

    async def fake_extract(
        _media_path: Path, output: Path, *, start_ms: int, duration_ms: int
    ) -> None:
        del start_ms, duration_ms
        await asyncio.to_thread(output.write_bytes, b"audio")

    async def respond(request: httpx.Request) -> httpx.Response:
        del request
        request_started.set()
        await asyncio.Event().wait()
        raise AssertionError("unreachable")

    class SlowCloseClient(httpx.AsyncClient):
        close_calls = 0

        async def aclose(self) -> None:
            self.close_calls += 1
            close_started.set()
            await allow_close.wait()
            await super().aclose()

    client = SlowCloseClient(transport=httpx.MockTransport(respond), trust_env=False)
    asr = SiliconFlowAsr(profile=_profile())
    monkeypatch.setattr(asr_siliconflow, "_extract_audio", fake_extract)
    monkeypatch.setattr(asr, "_new_client", lambda: client)
    task = asyncio.create_task(
        asr.transcribe(tmp_path / "source.mp4", 45_000, tmp_path, NullProgressReporter())
    )
    await asyncio.wait_for(request_started.wait(), timeout=1)

    task.cancel()
    await asyncio.wait_for(close_started.wait(), timeout=1)
    task.cancel()
    await asyncio.sleep(0)
    assert not task.done()
    allow_close.set()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert client.close_calls == 1
    assert client.is_closed


async def test_asr_failure_event_is_emitted_only_after_client_close(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")

    async def fake_extract(
        _media_path: Path, output: Path, *, start_ms: int, duration_ms: int
    ) -> None:
        del start_ms, duration_ms
        await asyncio.to_thread(output.write_bytes, b"audio")

    class TrackingClient(httpx.AsyncClient):
        close_calls = 0

        async def aclose(self) -> None:
            self.close_calls += 1
            await super().aclose()

    client = TrackingClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(400, json={})),
        trust_env=False,
    )
    observed: list[str] = []

    def capture(event: str, **fields: object) -> None:
        del fields
        assert client.close_calls == 1
        observed.append(event)

    asr = SiliconFlowAsr(profile=_profile())
    monkeypatch.setattr(asr_siliconflow, "_extract_audio", fake_extract)
    monkeypatch.setattr(asr, "_new_client", lambda: client)
    monkeypatch.setattr(asr_siliconflow, "emit_operator_event", capture)

    with pytest.raises(BilibiliNoteFailure):
        await asr.transcribe(tmp_path / "source.mp4", 45_000, tmp_path, NullProgressReporter())

    assert observed == ["asr_failed"]


async def test_vision_request_is_bounded_before_network(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    monkeypatch.setattr(distillers, "VISION_REQUEST_BYTES", 1)
    called = False

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(500)

    with pytest.raises(BilibiliNoteFailure) as failure:
        await SiliconFlowDistiller(
            profile=_profile(), transport=httpx.MockTransport(respond)
        ).distill(_source(), _frames())

    assert failure.value.reason == "model_request_bytes_exceeded"
    assert called is False


@pytest.mark.parametrize("declared", [True, False])
async def test_vision_response_is_bounded_before_json_parse(
    monkeypatch: pytest.MonkeyPatch, declared: bool
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    monkeypatch.setattr(distillers, "VISION_RESPONSE_BYTES", 16)

    def respond(request: httpx.Request) -> httpx.Response:
        payload = b"x" * 17
        if declared:
            return httpx.Response(200, content=payload)
        return httpx.Response(
            200,
            headers={"Transfer-Encoding": "chunked"},
            stream=_ChunkedBytes(payload[:8], payload[8:]),
        )

    with pytest.raises(BilibiliNoteFailure) as failure:
        await SiliconFlowDistiller(
            profile=_profile(), transport=httpx.MockTransport(respond)
        ).distill(_source(), _frames())

    assert failure.value.reason == "model_response_bytes_exceeded"
