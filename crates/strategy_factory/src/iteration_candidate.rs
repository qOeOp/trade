//! R&D-private comparison of the complete next-experiment candidate frontier.
//!
//! These types are not request DTOs. The eventual same-transaction Decision composer supplies
//! them only after resolving R&D-owned interpretation evidence and the canonical TrialFamily
//! Census. This module chooses no policy inputs and performs no write.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::trial_family::{
    TrialFamilyCandidateSetFrontierV2, TrialFamilyCensusReadbackV2, verify_census_v2,
};

const MAX_CANDIDATES: usize = 4_096;
const MAX_TEXT_BYTES: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationEvidenceReferenceV1 {
    pub identity: String,
    pub digest: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IterationHypothesisDimensionV1 {
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
pub struct IterationPreregisteredFiniteJointV1 {
    pub changed_dimensions: Vec<IterationHypothesisDimensionV1>,
    pub bounded_combinations: Vec<IterationEvidenceReferenceV1>,
    pub attribution_rule: IterationEvidenceReferenceV1,
    pub budget: IterationEvidenceReferenceV1,
    pub falsifier: IterationEvidenceReferenceV1,
    pub stop_rule: IterationEvidenceReferenceV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "mode", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IterationExperimentModeV1 {
    SingleDimension {
        changed_dimension: IterationHypothesisDimensionV1,
    },
    PreregisteredFiniteJoint {
        contract: Box<IterationPreregisteredFiniteJointV1>,
    },
}

/// The grid a candidate set is generated from. The Owner expands it, so the set's size and members
/// are computed from it rather than stated beside it.
///
/// Each listed dimension expands to one `SINGLE_DIMENSION` candidate that changes it, and each
/// frozen finite-joint contract to one `PREREGISTERED_FINITE_JOINT` candidate. Both lists are
/// strictly ascending, dimensions in declaration order and contracts by their canonical bytes, so
/// one grid has one representation and lists no member twice. The rule's identity and digest are
/// derived from the grid and are never supplied.
///
/// These are the only two kinds of grid. When the authoring layer adds another, a parameter sweep
/// for instance, it is a new variant of this type with its own named expansion, never a string a
/// caller passes back for the Owner to trust.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CandidateGenerationGridV1 {
    pub single_dimensions: Vec<IterationHypothesisDimensionV1>,
    pub finite_joints: Vec<IterationPreregisteredFiniteJointV1>,
}

/// Why a candidate set is refused against the grid that generates it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum CandidateGenerationRefusalV1 {
    #[error("the candidate generation grid repeats a member or lists one out of order")]
    GridInvalid,
    #[error("the registered candidate count differs from the size of the grid's expansion")]
    CardinalityMismatch,
    #[error("the listed candidates are not the grid's expansion")]
    CandidatesDifferFromRule,
}

impl CandidateGenerationRefusalV1 {
    /// The code a consumer receives.
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::GridInvalid => "CANDIDATE_GENERATION_GRID_INVALID",
            Self::CardinalityMismatch => "CANDIDATE_GENERATION_CARDINALITY_MISMATCH",
            Self::CandidatesDifferFromRule => "CANDIDATE_SET_DIFFERS_FROM_GENERATION_RULE",
        }
    }
}

impl CandidateGenerationGridV1 {
    /// Expands the grid into its candidate experiments, in the grid's own order.
    ///
    /// # Errors
    ///
    /// [`CandidateGenerationRefusalV1::GridInvalid`] when either list repeats a member or is out
    /// of order.
    pub fn expand(&self) -> Result<Vec<IterationExperimentModeV1>, CandidateGenerationRefusalV1> {
        if !self
            .single_dimensions
            .windows(2)
            .all(|pair| pair[0] < pair[1])
        {
            return Err(CandidateGenerationRefusalV1::GridInvalid);
        }
        let joint_keys = self
            .finite_joints
            .iter()
            .map(canonical_bytes)
            .collect::<Vec<_>>();

        if !joint_keys.windows(2).all(|pair| pair[0] < pair[1]) {
            return Err(CandidateGenerationRefusalV1::GridInvalid);
        }
        Ok(self
            .single_dimensions
            .iter()
            .map(|dimension| IterationExperimentModeV1::SingleDimension {
                changed_dimension: *dimension,
            })
            .chain(self.finite_joints.iter().map(|contract| {
                IterationExperimentModeV1::PreregisteredFiniteJoint {
                    contract: Box::new(contract.clone()),
                }
            }))
            .collect())
    }

    /// The canonical grid whose expansion is exactly these experiments, for fixtures that list
    /// their candidates first.
    #[cfg(test)]
    pub(crate) fn covering<'a>(
        experiments: impl IntoIterator<Item = &'a IterationExperimentModeV1>,
    ) -> Self {
        let mut grid = Self::default();

        for experiment in experiments {
            match experiment {
                IterationExperimentModeV1::SingleDimension { changed_dimension } => {
                    grid.single_dimensions.push(*changed_dimension);
                }
                IterationExperimentModeV1::PreregisteredFiniteJoint { contract } => {
                    grid.finite_joints.push((**contract).clone());
                }
            }
        }
        grid.single_dimensions.sort_unstable();
        grid.finite_joints.sort_by_key(canonical_bytes);
        grid
    }

    /// The rule's digest, computed from the grid.
    #[must_use]
    pub fn rule_digest(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(b"rd.candidate-generation-grid.v1");
        hasher.update([0]);
        hasher.update(canonical_bytes(self));
        format!("sha256:{:x}", hasher.finalize())
    }

    /// The rule's identity, computed from its digest.
    #[must_use]
    pub fn rule_identity(&self) -> String {
        format!(
            "rd-candidate-generation-grid-v1-{}",
            self.rule_digest().trim_start_matches("sha256:")
        )
    }

    /// Admits a candidate set against this grid: the registered count must be the expansion's
    /// size, and the listed experiments must be exactly the expansion, in any order.
    ///
    /// # Errors
    ///
    /// The refusal that names which of the grid, the count or the listed candidates disagrees.
    pub fn admit_candidates<'a>(
        &self,
        expected_cardinality: u32,
        experiments: impl IntoIterator<Item = &'a IterationExperimentModeV1>,
    ) -> Result<(), CandidateGenerationRefusalV1> {
        let mut expansion = self
            .expand()?
            .iter()
            .map(canonical_bytes)
            .collect::<Vec<_>>();

        if usize::try_from(expected_cardinality).ok() != Some(expansion.len()) {
            return Err(CandidateGenerationRefusalV1::CardinalityMismatch);
        }
        let mut listed = experiments
            .into_iter()
            .map(canonical_bytes)
            .collect::<Vec<_>>();
        expansion.sort_unstable();
        listed.sort_unstable();

        if listed != expansion {
            return Err(CandidateGenerationRefusalV1::CandidatesDifferFromRule);
        }
        Ok(())
    }
}

/// The canonical JSON of a value whose serialization cannot fail: plain structs and enums of
/// strings, integers and vectors.
fn canonical_bytes(value: &impl Serialize) -> Vec<u8> {
    serde_json::to_vec(value).expect("a candidate experiment serializes")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IterationCandidateInadmissibilityV1 {
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
pub enum IterationCandidateAdmissibilityV1 {
    AdmissibleAboveThreshold,
    AdmissibleBelowThreshold,
    Inadmissible(IterationCandidateInadmissibilityV1),
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationInformationValueEvidenceV1 {
    pub decision_uncertainty: IterationEvidenceReferenceV1,
    pub distinguishing_observation_or_falsifier: IterationEvidenceReferenceV1,
    pub result_to_action_map: IterationEvidenceReferenceV1,
    pub bounded_acquisition_cost: IterationEvidenceReferenceV1,
    pub remaining_family_budget_effect: IterationEvidenceReferenceV1,
    pub competing_alternatives: Vec<IterationEvidenceReferenceV1>,
    pub ordinal_rationale: IterationEvidenceReferenceV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationCandidateEvaluationV1 {
    pub candidate_identity: String,
    pub candidate_digest: String,
    pub admissibility: IterationCandidateAdmissibilityV1,
    pub information_value: IterationInformationValueEvidenceV1,
    pub uncertainty_reduction_rank: u32,
    pub tie_break_key: String,
    pub experiment: IterationExperimentModeV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationCandidateEvaluationSetV1 {
    pub frontier_identity: String,
    pub frontier_digest: String,
    pub generation_rule_identity: String,
    pub generation_rule_digest: String,
    pub expected_cardinality: u32,
    pub threshold: IterationEvidenceReferenceV1,
    pub candidates: Vec<IterationCandidateEvaluationV1>,
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
    verify_census_v2(census).map_err(|e| IterationCandidateErrorV1::Census(e.to_string()))?;
    let decision_policy = census
        .decision_policy_v1()
        .ok_or(IterationCandidateErrorV1::Invalid(
            "frozen candidate comparison policy is unavailable",
        ))?;
    let expected_threshold_digest = format!(
        "sha256:{}",
        decision_policy
            .information_value_threshold_digest()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    );

    if evaluations.threshold.identity != decision_policy.information_value_threshold_identity()
        || evaluations.threshold.digest != expected_threshold_digest
    {
        return Err(IterationCandidateErrorV1::Invalid(
            "candidate evaluation threshold does not match the frozen policy",
        ));
    }
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

    fn single(dimension: IterationHypothesisDimensionV1) -> IterationExperimentModeV1 {
        IterationExperimentModeV1::SingleDimension {
            changed_dimension: dimension,
        }
    }

    fn joint(byte: char) -> IterationPreregisteredFiniteJointV1 {
        IterationPreregisteredFiniteJointV1 {
            changed_dimensions: vec![
                IterationHypothesisDimensionV1::EntryRule,
                IterationHypothesisDimensionV1::ExitRule,
            ],
            bounded_combinations: vec![reference("combination", byte)],
            attribution_rule: reference("attribution", byte),
            budget: reference("budget", byte),
            falsifier: reference("falsifier", byte),
            stop_rule: reference("stop", byte),
        }
    }

    fn grid() -> CandidateGenerationGridV1 {
        let mut joints = vec![joint('a'), joint('b')];
        joints.sort_by_key(canonical_bytes);
        CandidateGenerationGridV1 {
            single_dimensions: vec![
                IterationHypothesisDimensionV1::MarketRegime,
                IterationHypothesisDimensionV1::ExitRule,
            ],
            finite_joints: joints,
        }
    }

    #[rstest::rstest]
    fn a_grid_expands_to_one_candidate_per_member_in_its_own_order() {
        let grid = grid();
        let expansion = grid.expand().expect("canonical grid");
        assert_eq!(expansion.len(), 4);
        assert_eq!(
            expansion[..2],
            [
                single(IterationHypothesisDimensionV1::MarketRegime),
                single(IterationHypothesisDimensionV1::ExitRule),
            ]
        );
        assert_eq!(
            expansion[2..],
            grid.finite_joints
                .iter()
                .map(
                    |contract| IterationExperimentModeV1::PreregisteredFiniteJoint {
                        contract: Box::new(contract.clone()),
                    }
                )
                .collect::<Vec<_>>()[..]
        );
        assert_eq!(
            CandidateGenerationGridV1::default().expand(),
            Ok(Vec::new())
        );
    }

    #[rstest::rstest]
    fn a_grid_that_repeats_or_misorders_a_member_is_refused() {
        let mut repeated = grid();
        repeated
            .single_dimensions
            .push(IterationHypothesisDimensionV1::ExitRule);
        let mut misordered = grid();
        misordered.single_dimensions.reverse();
        let mut repeated_joint = grid();
        repeated_joint.finite_joints.push(joint('b'));
        let mut misordered_joint = grid();
        misordered_joint.finite_joints.reverse();

        for refused in [repeated, misordered, repeated_joint, misordered_joint] {
            assert_eq!(
                refused.expand(),
                Err(CandidateGenerationRefusalV1::GridInvalid)
            );
        }
    }

    #[rstest::rstest]
    fn the_count_and_the_candidates_are_held_to_the_expansion() {
        let grid = grid();
        let expansion = grid.expand().expect("canonical grid");
        let reversed = expansion.iter().rev().collect::<Vec<_>>();
        assert_eq!(grid.admit_candidates(4, reversed), Ok(()));
        assert_eq!(
            grid.admit_candidates(3, &expansion),
            Err(CandidateGenerationRefusalV1::CardinalityMismatch)
        );
        assert_eq!(
            grid.admit_candidates(4, &expansion[..3]),
            Err(CandidateGenerationRefusalV1::CandidatesDifferFromRule)
        );
        let mut substituted = expansion.clone();
        substituted[0] = single(IterationHypothesisDimensionV1::ReturnMechanism);
        assert_eq!(
            grid.admit_candidates(4, &substituted),
            Err(CandidateGenerationRefusalV1::CandidatesDifferFromRule)
        );
    }

    #[rstest::rstest]
    fn the_rule_identity_and_digest_are_the_grids_own() {
        let grid = grid();
        let mut other = grid.clone();
        other.single_dimensions.pop();
        assert_eq!(grid.rule_digest(), self::grid().rule_digest());
        assert_ne!(grid.rule_digest(), other.rule_digest());
        assert_eq!(
            grid.rule_identity(),
            format!(
                "rd-candidate-generation-grid-v1-{}",
                grid.rule_digest().trim_start_matches("sha256:")
            )
        );
        assert!(grid.rule_digest().starts_with("sha256:") && grid.rule_digest().len() == 71);
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

    #[rstest::rstest]
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

    #[rstest::rstest]
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

    #[rstest::rstest]
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

    #[rstest::rstest]
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
