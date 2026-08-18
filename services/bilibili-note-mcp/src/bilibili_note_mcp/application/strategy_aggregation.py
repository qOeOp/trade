from __future__ import annotations

from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.domain.models import StrategySummaryV1, summary_items_are_distinct
from bilibili_note_mcp.domain.refs import domain_ref

from .ports import (
    StrategyCatalogItem,
    StrategyRuleCategory,
    StrategySynthesis,
    StrategySynthesisVerifierPort,
    StrategySynthesizerPort,
)

_CATEGORY_CODE: dict[StrategyRuleCategory, str] = {
    "core_strategy": "C",
    "method": "M",
    "risk_management": "R",
}
_CATEGORY_ORDER: dict[StrategyRuleCategory, int] = {
    "core_strategy": 0,
    "method": 1,
    "risk_management": 2,
}
_CATEGORY_LIMIT: dict[StrategyRuleCategory, int] = {
    "core_strategy": 3,
    "method": 6,
    "risk_management": 4,
}


def _catalog(summaries: tuple[StrategySummaryV1, ...]) -> tuple[StrategyCatalogItem, ...]:
    result: list[StrategyCatalogItem] = []
    categories: tuple[tuple[StrategyRuleCategory, str], ...] = (
        ("core_strategy", "core_strategies"),
        ("method", "methods"),
        ("risk_management", "risk_management"),
    )
    for category, attribute in categories:
        for source_index, summary in enumerate(summaries, start=1):
            if attribute == "core_strategies":
                rules = summary.core_strategies
            elif attribute == "methods":
                rules = summary.methods
            else:
                rules = summary.risk_management
            for rule_index, rule in enumerate(rules, start=1):
                result.append(
                    StrategyCatalogItem(
                        item_id=f"S{source_index:02d}:{_CATEGORY_CODE[category]}{rule_index:02d}",
                        category=category,
                        rule=rule,
                    )
                )
    return tuple(result)


def _catalog_value(catalog: tuple[StrategyCatalogItem, ...]) -> list[dict[str, str]]:
    return [
        {
            "item_id": item.item_id,
            "category": item.category,
            "rule_body": item.rule.rule_body,
        }
        for item in catalog
    ]


def _synthesis_value(synthesis: StrategySynthesis) -> dict[str, object]:
    return {
        "catalog_ref": synthesis.catalog_ref,
        "outputs": [
            {
                "category": output.category,
                "rule_body": output.rule.rule_body,
                "support_ids": list(output.support_ids),
            }
            for output in synthesis.outputs
        ],
        "episode_specific_ids": list(synthesis.episode_specific_ids),
    }


class VerifiedStrategySynthesisAggregator:
    """Admit a bounded synthesized strategy only after closed host and verifier checks."""

    def __init__(
        self,
        synthesizer: StrategySynthesizerPort,
        verifier: StrategySynthesisVerifierPort,
    ) -> None:
        self._synthesizer = synthesizer
        self._verifier = verifier

    async def aggregate(
        self,
        subject: str,
        summaries: tuple[StrategySummaryV1, ...],
    ) -> StrategySummaryV1:
        if not 1 <= len(summaries) <= 3:
            raise BilibiliNoteFailure(
                "DISTILLATION_FAILED", "strategy_aggregation_source_count_invalid"
            )
        catalog = _catalog(summaries)
        catalog_value = _catalog_value(catalog)
        catalog_ref = domain_ref("sac_", "bilibili-note/strategy-catalog/v1", catalog_value)
        synthesis = await self._synthesizer.synthesize(catalog, catalog_ref)
        self._validate_synthesis(catalog, catalog_ref, synthesis)
        synthesis_ref = domain_ref(
            "sas_",
            "bilibili-note/strategy-synthesis/v1",
            {"catalog": catalog_value, "synthesis": _synthesis_value(synthesis)},
        )
        verification = await self._verifier.verify_synthesis(
            catalog, catalog_ref, synthesis, synthesis_ref
        )
        verdict_values = {"accept", "reject"}
        if (
            verification.catalog_ref != catalog_ref
            or verification.synthesis_ref != synthesis_ref
            or len(verification.outputs) != len(synthesis.outputs)
            or any(
                verdict.output_index != index for index, verdict in enumerate(verification.outputs)
            )
            or len(verification.episode_specific) != len(synthesis.episode_specific_ids)
            or any(
                verdict.item_id != item_id
                for verdict, item_id in zip(
                    verification.episode_specific,
                    synthesis.episode_specific_ids,
                    strict=True,
                )
            )
            or any(
                value not in verdict_values
                for value in (
                    verification.complete_coverage,
                    verification.category_preservation,
                    verification.no_duplicate_or_remaining_mergeable_output,
                    verification.priority_order_acceptable,
                )
            )
            or any(
                value not in verdict_values
                for verdict in verification.outputs
                for value in (
                    verdict.entailed_no_new_claim,
                    verdict.polarity_preserved,
                    verdict.material_conditions_preserved,
                    verdict.reusable_abstraction_acceptable,
                    verdict.simplified_chinese_language,
                )
            )
            or any(
                verdict.safe_to_omit not in verdict_values
                for verdict in verification.episode_specific
            )
        ):
            raise BilibiliNoteFailure(
                "DISTILLATION_FAILED", "strategy_aggregation_verifier_invalid"
            )
        if (
            "reject"
            in (
                verification.complete_coverage,
                verification.category_preservation,
                verification.no_duplicate_or_remaining_mergeable_output,
                verification.priority_order_acceptable,
            )
            or any(
                "reject"
                in (
                    verdict.entailed_no_new_claim,
                    verdict.polarity_preserved,
                    verdict.material_conditions_preserved,
                    verdict.reusable_abstraction_acceptable,
                    verdict.simplified_chinese_language,
                )
                for verdict in verification.outputs
            )
            or any(verdict.safe_to_omit == "reject" for verdict in verification.episode_specific)
        ):
            raise BilibiliNoteFailure(
                "DISTILLATION_FAILED", "strategy_aggregation_semantics_rejected"
            )

        selected = {
            category: tuple(
                output.rule for output in synthesis.outputs if output.category == category
            )
            for category in _CATEGORY_ORDER
        }
        return StrategySummaryV1(
            subject=subject,
            core_strategies=selected["core_strategy"],
            methods=selected["method"],
            risk_management=selected["risk_management"],
        )

    @staticmethod
    def _validate_synthesis(
        catalog: tuple[StrategyCatalogItem, ...],
        catalog_ref: str,
        synthesis: StrategySynthesis,
    ) -> None:
        if synthesis.catalog_ref != catalog_ref:
            VerifiedStrategySynthesisAggregator._invalid_synthesis()
        ordered_ids = tuple(item.item_id for item in catalog)
        known_ids = set(ordered_ids)
        index_by_id = {item_id: index for index, item_id in enumerate(ordered_ids)}
        by_id = {item.item_id: item for item in catalog}

        category_counts = {
            category: sum(output.category == category for output in synthesis.outputs)
            for category in _CATEGORY_ORDER
        }
        if any(output.category not in _CATEGORY_ORDER for output in synthesis.outputs):
            VerifiedStrategySynthesisAggregator._invalid_synthesis()
        if any(
            not 1 <= category_counts[category] <= limit
            for category, limit in _CATEGORY_LIMIT.items()
        ):
            VerifiedStrategySynthesisAggregator._invalid_synthesis()
        categories = tuple(output.category for output in synthesis.outputs)
        if categories != tuple(sorted(categories, key=_CATEGORY_ORDER.__getitem__)):
            VerifiedStrategySynthesisAggregator._invalid_synthesis()
        if not summary_items_are_distinct(tuple(output.rule for output in synthesis.outputs)):
            VerifiedStrategySynthesisAggregator._invalid_synthesis()

        claimed_ids = tuple(
            item_id for output in synthesis.outputs for item_id in output.support_ids
        )
        all_ids = (*claimed_ids, *synthesis.episode_specific_ids)
        if (
            len(all_ids) != len(set(all_ids))
            or set(all_ids) != known_ids
            or tuple(index_by_id[item_id] for item_id in synthesis.episode_specific_ids)
            != tuple(sorted(index_by_id[item_id] for item_id in synthesis.episode_specific_ids))
        ):
            VerifiedStrategySynthesisAggregator._invalid_synthesis()

        for output in synthesis.outputs:
            if not output.support_ids or any(
                by_id[item_id].category != output.category for item_id in output.support_ids
            ):
                VerifiedStrategySynthesisAggregator._invalid_synthesis()
            indices = tuple(index_by_id[item_id] for item_id in output.support_ids)
            if indices != tuple(sorted(indices)):
                VerifiedStrategySynthesisAggregator._invalid_synthesis()

    @staticmethod
    def _invalid_synthesis() -> None:
        raise BilibiliNoteFailure("DISTILLATION_FAILED", "strategy_aggregation_response_invalid")
