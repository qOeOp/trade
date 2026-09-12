//! R&D-private comparison of the complete next-experiment candidate frontier.
//!
//! These types are not request DTOs. The eventual same-transaction Decision composer supplies
//! them only after resolving R&D-owned interpretation evidence and the canonical TrialFamily
//! Census. This module chooses no policy inputs and performs no write.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::trial_family::{
    TrialFamilyCandidateSetFrontierV2, TrialFamilyCensusReadbackV2, verify_census_v2,
};

const MAX_CANDIDATES: usize = 4_096;
const MAX_TEXT_BYTES: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct IterationEvidenceReferenceV1 {
    pub(crate) identity: String,
    pub(crate) digest: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum IterationHypothesisDimensionV1 {
    ReturnMechanism,
    MarketRegime,
    InstrumentScope,
    FeatureSignal,
    EntryRule,
    ExitRule,
    PositionAndHolding,
    FrequencyAndCost,
    CapacityAndPortfolioRole,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct IterationPreregisteredFiniteJointV1 {
    pub(crate) changed_dimensions: Vec<IterationHypothesisDimensionV1>,
    pub(crate) bounded_combinations: Vec<IterationEvidenceReferenceV1>,
    pub(crate) attribution_rule: IterationEvidenceReferenceV1,
    pub(crate) budget: IterationEvidenceReferenceV1,
    pub(crate) falsifier: IterationEvidenceReferenceV1,
    pub(crate) stop_rule: IterationEvidenceReferenceV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "mode", rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum IterationExperimentModeV1 {
    SingleDimension {
        changed_dimension: IterationHypothesisDimensionV1,
    },
    PreregisteredFiniteJoint {
        contract: Box<IterationPreregisteredFiniteJointV1>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum IterationCandidateInadmissibilityV1 {
    BudgetExceeded,
    MissingBinding,
    NotPreregistered,
    AttributionUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(
    tag = "status",
    content = "reason",
    rename_all = "SCREAMING_SNAKE_CASE"
)]
pub(crate) enum IterationCandidateAdmissibilityV1 {
    AdmissibleAboveThreshold,
    AdmissibleBelowThreshold,
    Inadmissible(IterationCandidateInadmissibilityV1),
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct IterationInformationValueEvidenceV1 {
    pub(crate) decision_uncertainty: IterationEvidenceReferenceV1,
    pub(crate) distinguishing_observation_or_falsifier: IterationEvidenceReferenceV1,
    pub(crate) result_to_action_map: IterationEvidenceReferenceV1,
    pub(crate) bounded_acquisition_cost: IterationEvidenceReferenceV1,
    pub(crate) remaining_family_budget_effect: IterationEvidenceReferenceV1,
    pub(crate) competing_alternatives: Vec<IterationEvidenceReferenceV1>,
    pub(crate) ordinal_rationale: IterationEvidenceReferenceV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct IterationCandidateEvaluationV1 {
    pub(crate) candidate_identity: String,
    pub(crate) candidate_digest: String,
    pub(crate) admissibility: IterationCandidateAdmissibilityV1,
    pub(crate) information_value: IterationInformationValueEvidenceV1,
    pub(crate) uncertainty_reduction_rank: u32,
    pub(crate) tie_break_key: String,
    pub(crate) experiment: IterationExperimentModeV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct IterationCandidateEvaluationSetV1 {
    pub(crate) frontier_identity: String,
    pub(crate) frontier_digest: String,
    pub(crate) generation_rule_identity: String,
    pub(crate) generation_rule_digest: String,
    pub(crate) expected_cardinality: u32,
    pub(crate) threshold: IterationEvidenceReferenceV1,
    pub(crate) candidates: Vec<IterationCandidateEvaluationV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "comparison", rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum IterationCandidateComparisonV1 {
    Winner {
        candidate: Box<IterationCandidateEvaluationV1>,
    },
    AllBelowThreshold {
        threshold: IterationEvidenceReferenceV1,
    },
    NoDecision {
        reason: IterationCandidateNoDecisionReasonV1,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum IterationCandidateNoDecisionReasonV1 {
    EmptyOrIncompleteCensus,
    UnknownAdmissibility,
    InadmissibleCandidate,
    NoAdmissibleWinner,
}

#[derive(Debug, Error)]
pub(crate) enum IterationCandidateErrorV1 {
    #[error("R&D TrialFamily Census is unavailable: {0}")]
    Census(String),
    #[error("R&D candidate comparison is unavailable: {0}")]
    Invalid(&'static str),
}

/// Compares a complete R&D-owned evaluation set against the exact canonical Census frontier.
pub(crate) fn compare_iteration_candidates_v1(
    census: &TrialFamilyCensusReadbackV2,
    evaluations: IterationCandidateEvaluationSetV1,
) -> Result<IterationCandidateComparisonV1, IterationCandidateErrorV1> {
    verify_census_v2(census)
        .map_err(|error| IterationCandidateErrorV1::Census(error.to_string()))?;
    compare_bound_candidate_set_v1(&census.candidate_set_frontier, evaluations)
}

fn compare_bound_candidate_set_v1(
    frontier: &TrialFamilyCandidateSetFrontierV2,
    evaluations: IterationCandidateEvaluationSetV1,
) -> Result<IterationCandidateComparisonV1, IterationCandidateErrorV1> {
    let frontier = CandidateFrontierViewV1 {
        frontier_identity: frontier.frontier_identity().to_string(),
        frontier_digest: frontier.frontier_digest().to_string(),
        generation_rule_identity: frontier.generation_rule_identity().to_string(),
        generation_rule_digest: frontier.generation_rule_digest().to_string(),
        expected_cardinality: frontier.expected_cardinality(),
        candidates: frontier
            .candidates()
            .iter()
            .map(|candidate| {
                (
                    candidate.candidate_identity().to_string(),
                    candidate.candidate_digest().to_string(),
                )
            })
            .collect(),
    };
    compare_candidate_evaluations_v1(&frontier, evaluations)
}

struct CandidateFrontierViewV1 {
    frontier_identity: String,
    frontier_digest: String,
    generation_rule_identity: String,
    generation_rule_digest: String,
    expected_cardinality: u32,
    candidates: Vec<(String, String)>,
}

fn compare_candidate_evaluations_v1(
    frontier: &CandidateFrontierViewV1,
    evaluations: IterationCandidateEvaluationSetV1,
) -> Result<IterationCandidateComparisonV1, IterationCandidateErrorV1> {
    validate_reference(&evaluations.threshold)?;
    if evaluations.frontier_identity != frontier.frontier_identity
        || evaluations.frontier_digest != frontier.frontier_digest
        || evaluations.generation_rule_identity != frontier.generation_rule_identity
        || evaluations.generation_rule_digest != frontier.generation_rule_digest
        || evaluations.expected_cardinality != frontier.expected_cardinality
        || evaluations.candidates.len() != frontier.candidates.len()
        || evaluations.candidates.len() > MAX_CANDIDATES
    {
        return Err(IterationCandidateErrorV1::Invalid(
            "candidate evaluation set does not bind the canonical frontier",
        ));
    }
    if evaluations.expected_cardinality == 0 {
        return Ok(IterationCandidateComparisonV1::NoDecision {
            reason: IterationCandidateNoDecisionReasonV1::EmptyOrIncompleteCensus,
        });
    }

    let mut identities = BTreeSet::new();
    let mut digests = BTreeSet::new();
    let mut comparison_keys = BTreeSet::new();
    for candidate in &evaluations.candidates {
        validate_candidate(candidate)?;
        if !identities.insert(candidate.candidate_identity.as_str())
            || !digests.insert(candidate.candidate_digest.as_str())
            || !comparison_keys.insert((
                admissibility_order(&candidate.admissibility),
                candidate.uncertainty_reduction_rank,
                candidate.tie_break_key.as_str(),
                candidate.candidate_identity.as_str(),
                candidate.candidate_digest.as_str(),
            ))
        {
            return Err(IterationCandidateErrorV1::Invalid(
                "candidate identity, digest, or comparison key collides",
            ));
        }
    }
    let frontier_members = frontier
        .candidates
        .iter()
        .map(|(identity, digest)| (identity.as_str(), digest.as_str()))
        .collect::<BTreeSet<_>>();
    let evaluated_members = evaluations
        .candidates
        .iter()
        .map(|candidate| {
            (
                candidate.candidate_identity.as_str(),
                candidate.candidate_digest.as_str(),
            )
        })
        .collect::<BTreeSet<_>>();
    if frontier_members != evaluated_members {
        return Err(IterationCandidateErrorV1::Invalid(
            "candidate evaluation membership is incomplete or cross-spliced",
        ));
    }
    if evaluations
        .candidates
        .iter()
        .any(|candidate| candidate.admissibility == IterationCandidateAdmissibilityV1::Unknown)
    {
        return Ok(IterationCandidateComparisonV1::NoDecision {
            reason: IterationCandidateNoDecisionReasonV1::UnknownAdmissibility,
        });
    }
    if evaluations.candidates.iter().any(|candidate| {
        matches!(
            candidate.admissibility,
            IterationCandidateAdmissibilityV1::Inadmissible(_)
        )
    }) {
        return Ok(IterationCandidateComparisonV1::NoDecision {
            reason: IterationCandidateNoDecisionReasonV1::InadmissibleCandidate,
        });
    }

    let mut above_threshold = evaluations
        .candidates
        .iter()
        .filter(|candidate| {
            candidate.admissibility == IterationCandidateAdmissibilityV1::AdmissibleAboveThreshold
        })
        .cloned()
        .collect::<Vec<_>>();
    above_threshold.sort_by(|left, right| {
        (
            left.uncertainty_reduction_rank,
            &left.tie_break_key,
            &left.candidate_identity,
            &left.candidate_digest,
        )
            .cmp(&(
                right.uncertainty_reduction_rank,
                &right.tie_break_key,
                &right.candidate_identity,
                &right.candidate_digest,
            ))
    });
    if let Some(candidate) = above_threshold.into_iter().next() {
        return Ok(IterationCandidateComparisonV1::Winner {
            candidate: Box::new(candidate),
        });
    }
    if evaluations.candidates.iter().all(|candidate| {
        candidate.admissibility == IterationCandidateAdmissibilityV1::AdmissibleBelowThreshold
    }) {
        return Ok(IterationCandidateComparisonV1::AllBelowThreshold {
            threshold: evaluations.threshold,
        });
    }
    Ok(IterationCandidateComparisonV1::NoDecision {
        reason: IterationCandidateNoDecisionReasonV1::NoAdmissibleWinner,
    })
}

fn validate_candidate(
    candidate: &IterationCandidateEvaluationV1,
) -> Result<(), IterationCandidateErrorV1> {
    validate_text(&candidate.candidate_identity)?;
    validate_digest(&candidate.candidate_digest)?;
    validate_text(&candidate.tie_break_key)?;
    validate_information_value(&candidate.information_value)?;
    validate_experiment(&candidate.experiment)
}

fn validate_information_value(
    evidence: &IterationInformationValueEvidenceV1,
) -> Result<(), IterationCandidateErrorV1> {
    for reference in [
        &evidence.decision_uncertainty,
        &evidence.distinguishing_observation_or_falsifier,
        &evidence.result_to_action_map,
        &evidence.bounded_acquisition_cost,
        &evidence.remaining_family_budget_effect,
        &evidence.ordinal_rationale,
    ] {
        validate_reference(reference)?;
    }
    if evidence.competing_alternatives.is_empty()
        || evidence.competing_alternatives.len() > MAX_CANDIDATES
    {
        return Err(IterationCandidateErrorV1::Invalid(
            "competing alternatives are incomplete",
        ));
    }
    let mut alternatives = BTreeSet::new();
    for alternative in &evidence.competing_alternatives {
        validate_reference(alternative)?;
        if !alternatives.insert((alternative.identity.as_str(), alternative.digest.as_str())) {
            return Err(IterationCandidateErrorV1::Invalid(
                "competing alternative is duplicated",
            ));
        }
    }
    Ok(())
}

fn validate_experiment(
    experiment: &IterationExperimentModeV1,
) -> Result<(), IterationCandidateErrorV1> {
    let IterationExperimentModeV1::PreregisteredFiniteJoint { contract } = experiment else {
        return Ok(());
    };
    let dimensions = contract
        .changed_dimensions
        .iter()
        .copied()
        .collect::<BTreeSet<_>>();
    if dimensions.len() != contract.changed_dimensions.len()
        || !(2..=9).contains(&dimensions.len())
        || contract.bounded_combinations.is_empty()
        || contract.bounded_combinations.len() > MAX_CANDIDATES
    {
        return Err(IterationCandidateErrorV1::Invalid(
            "preregistered finite joint is incomplete",
        ));
    }
    for reference in contract.bounded_combinations.iter().chain([
        &contract.attribution_rule,
        &contract.budget,
        &contract.falsifier,
        &contract.stop_rule,
    ]) {
        validate_reference(reference)?;
    }
    Ok(())
}

fn validate_reference(
    reference: &IterationEvidenceReferenceV1,
) -> Result<(), IterationCandidateErrorV1> {
    validate_text(&reference.identity)?;
    validate_digest(&reference.digest)
}

fn validate_text(value: &str) -> Result<(), IterationCandidateErrorV1> {
    if !value.is_empty()
        && value.len() <= MAX_TEXT_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
    {
        Ok(())
    } else {
        Err(IterationCandidateErrorV1::Invalid(
            "candidate comparison text is invalid",
        ))
    }
}

fn validate_digest(value: &str) -> Result<(), IterationCandidateErrorV1> {
    if value.len() == 71
        && value.starts_with("sha256:")
        && value[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        Ok(())
    } else {
        Err(IterationCandidateErrorV1::Invalid(
            "candidate comparison digest is invalid",
        ))
    }
}

const fn admissibility_order(value: &IterationCandidateAdmissibilityV1) -> u8 {
    match value {
        IterationCandidateAdmissibilityV1::AdmissibleAboveThreshold => 0,
        IterationCandidateAdmissibilityV1::AdmissibleBelowThreshold => 1,
        IterationCandidateAdmissibilityV1::Inadmissible(_) => 2,
        IterationCandidateAdmissibilityV1::Unknown => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn digest(byte: char) -> String {
        format!("sha256:{}", byte.to_string().repeat(64))
    }

    fn reference(identity: &str, byte: char) -> IterationEvidenceReferenceV1 {
        IterationEvidenceReferenceV1 {
            identity: identity.to_string(),
            digest: digest(byte),
        }
    }

    fn candidate(
        identity: &str,
        byte: char,
        admissibility: IterationCandidateAdmissibilityV1,
        rank: u32,
    ) -> IterationCandidateEvaluationV1 {
        IterationCandidateEvaluationV1 {
            candidate_identity: identity.to_string(),
            candidate_digest: digest(byte),
            admissibility,
            information_value: IterationInformationValueEvidenceV1 {
                decision_uncertainty: reference("uncertainty", '1'),
                distinguishing_observation_or_falsifier: reference("falsifier", '2'),
                result_to_action_map: reference("action-map", '3'),
                bounded_acquisition_cost: reference("cost-bound", '4'),
                remaining_family_budget_effect: reference("budget-effect", '5'),
                competing_alternatives: vec![reference("alternative", '6')],
                ordinal_rationale: reference("ordinal-rationale", '7'),
            },
            uncertainty_reduction_rank: rank,
            tie_break_key: identity.to_string(),
            experiment: IterationExperimentModeV1::SingleDimension {
                changed_dimension: IterationHypothesisDimensionV1::ReturnMechanism,
            },
        }
    }

    fn frontier(candidates: &[IterationCandidateEvaluationV1]) -> CandidateFrontierViewV1 {
        CandidateFrontierViewV1 {
            frontier_identity: "candidate-frontier".to_string(),
            generation_rule_identity: "generation-rule".to_string(),
            generation_rule_digest: digest('8'),
            expected_cardinality: u32::try_from(candidates.len()).expect("bounded fixture"),
            candidates: candidates
                .iter()
                .map(|candidate| {
                    (
                        candidate.candidate_identity.clone(),
                        candidate.candidate_digest.clone(),
                    )
                })
                .collect(),
            frontier_digest: digest('9'),
        }
    }

    fn set(candidates: Vec<IterationCandidateEvaluationV1>) -> IterationCandidateEvaluationSetV1 {
        IterationCandidateEvaluationSetV1 {
            frontier_identity: "candidate-frontier".to_string(),
            frontier_digest: digest('9'),
            generation_rule_identity: "generation-rule".to_string(),
            generation_rule_digest: digest('8'),
            expected_cardinality: u32::try_from(candidates.len()).expect("bounded fixture"),
            threshold: reference("information-threshold", 'a'),
            candidates,
        }
    }

    #[test]
    fn unique_highest_ranked_admissible_candidate_wins() {
        let candidates = vec![
            candidate(
                "candidate-lower",
                'b',
                IterationCandidateAdmissibilityV1::AdmissibleAboveThreshold,
                2,
            ),
            candidate(
                "candidate-winner",
                'c',
                IterationCandidateAdmissibilityV1::AdmissibleAboveThreshold,
                1,
            ),
        ];
        let comparison = compare_candidate_evaluations_v1(&frontier(&candidates), set(candidates))
            .expect("complete comparison");
        let IterationCandidateComparisonV1::Winner { candidate } = comparison else {
            panic!("expected winner");
        };
        assert_eq!(candidate.candidate_identity, "candidate-winner");
    }

    #[test]
    fn low_information_stop_requires_complete_all_below_threshold_census() {
        let candidates = vec![candidate(
            "candidate-below",
            'b',
            IterationCandidateAdmissibilityV1::AdmissibleBelowThreshold,
            1,
        )];
        assert!(matches!(
            compare_candidate_evaluations_v1(&frontier(&candidates), set(candidates))
                .expect("complete comparison"),
            IterationCandidateComparisonV1::AllBelowThreshold { .. }
        ));

        let candidates = vec![candidate(
            "candidate-unknown",
            'c',
            IterationCandidateAdmissibilityV1::Unknown,
            1,
        )];
        assert!(matches!(
            compare_candidate_evaluations_v1(&frontier(&candidates), set(candidates))
                .expect("classified no-decision"),
            IterationCandidateComparisonV1::NoDecision {
                reason: IterationCandidateNoDecisionReasonV1::UnknownAdmissibility
            }
        ));
    }

    #[test]
    fn cross_spliced_candidate_membership_is_rejected() {
        let frontier_candidates = vec![candidate(
            "candidate-frontier-member",
            'b',
            IterationCandidateAdmissibilityV1::AdmissibleAboveThreshold,
            1,
        )];
        let evaluated = vec![candidate(
            "candidate-other-member",
            'c',
            IterationCandidateAdmissibilityV1::AdmissibleAboveThreshold,
            1,
        )];
        assert!(matches!(
            compare_candidate_evaluations_v1(&frontier(&frontier_candidates), set(evaluated)),
            Err(IterationCandidateErrorV1::Invalid(
                "candidate evaluation membership is incomplete or cross-spliced"
            ))
        ));
    }

    #[test]
    fn inadmissible_member_prevents_another_member_from_winning() {
        let candidates = vec![
            candidate(
                "candidate-above",
                'b',
                IterationCandidateAdmissibilityV1::AdmissibleAboveThreshold,
                1,
            ),
            candidate(
                "candidate-missing-binding",
                'c',
                IterationCandidateAdmissibilityV1::Inadmissible(
                    IterationCandidateInadmissibilityV1::MissingBinding,
                ),
                2,
            ),
        ];
        assert!(matches!(
            compare_candidate_evaluations_v1(&frontier(&candidates), set(candidates))
                .expect("classified no-decision"),
            IterationCandidateComparisonV1::NoDecision {
                reason: IterationCandidateNoDecisionReasonV1::InadmissibleCandidate
            }
        ));
    }
}
