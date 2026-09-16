//! R&D admission of one exact Backtest Result as the next iteration's proposal basis.
//!
//! This module is effect-free. It proves that one caller-named Result, the R&D-owned TrialFamily
//! evidence locked by the caller's transaction, and one candidate strategy proposal set describe the
//! same experiment, and that the proposal set fits the family's remaining sealed trial budget. It
//! chooses no Decision outcome, next action, Selection, successor Intent, or Replay request, and it
//! performs no write. Positive authority comes only from the Owner readback issued here after the
//! caller has locked every input.
//!
//! An admitted proposal set is a proposal, never membership. The TrialFamily Census Frontier remains
//! the sole authority for the candidates a family actually contains: an admission may only propose
//! candidates that frontier does not already hold, and a later census append alone commits them.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_backtest_owner_contracts::{ReplayNamespaceV2, ReplayResultDtoV2, ReplayTerminalV2};

use crate::{
    IterationExperimentModeV1, iteration_decision::is_valid_iteration_decision_locator_v1,
};

pub const ITERATION_RESULT_ADMITTED_EVENT_V1: &str = "RD_ITERATION_RESULT_ADMITTED_V1";
pub const ITERATION_RESULT_ADMISSION_OPERATION_V1: &str = "iteration_result_admission.admit.v1";
pub const ITERATION_RESULT_ADMISSION_SCHEMA_V1: &str = "rd-iteration-result-admission-v1";
pub const ITERATION_RESULT_ADMISSION_MUTATION_EFFECT_V1: &str =
    "R_AND_D_ITERATION_RESULT_ADMISSION_MUTATION_V1";

const ADMISSION_DOMAIN_V1: &str = "rd.iteration-result-admission.v1";
const ADMISSION_RECEIPT_DOMAIN_V1: &str = "rd.iteration-result-admission-receipt.v1";
const ADMISSION_IDENTITY_PREFIX_V1: &str = "rd-iteration-result-admission-v1";
const ADMISSION_RECEIPT_IDENTITY_PREFIX_V1: &str = "rd-iteration-result-admission-receipt-v1";

/// Upper bound shared with the TrialFamily census frontier.
const MAX_PROPOSALS: usize = 4_096;

/// Caller-owned lookup only. It carries no Result, admission, or Decision authority.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationResultAdmissionLocatorV1 {
    pub trial_family_identity: String,
    pub result_identity: String,
    pub request_identity: String,
    pub attempt_identity: String,
}

/// One caller-proposed next-iteration candidate strategy.
///
/// The proposal names an experiment; it never carries an evaluation, rank, or admissibility.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationResultCandidateProposalV1 {
    pub candidate_identity: String,
    pub candidate_digest: String,
    pub experiment: IterationExperimentModeV1,
}

/// The complete candidate strategy proposal set for the iteration after the admitted Result.
///
/// Members are ordered by strictly ascending `candidate_identity` byte key, so one proposal set has
/// exactly one canonical representation and cannot carry a duplicate member.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationResultCandidateProposalSetV1 {
    pub generation_rule_identity: String,
    pub generation_rule_digest: String,
    pub expected_cardinality: u32,
    pub proposals: Vec<IterationResultCandidateProposalV1>,
}

/// Caller-mintable admission request. It cannot supply Owner evidence or admission authority.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationResultAdmissionOperationRequestV1 {
    pub locator: IterationResultAdmissionLocatorV1,
    pub result_digest: String,
    pub request_meaning_digest: String,
    pub proposals: IterationResultCandidateProposalSetV1,
}

impl IterationResultAdmissionOperationRequestV1 {
    /// Validates locator shape, digest shape, and the canonical proposal-set form.
    ///
    /// # Errors
    ///
    /// Returns [`IterationResultAdmissionErrorV1::InvalidLocator`] for a malformed identity or
    /// digest and [`IterationResultAdmissionErrorV1::NotApplicable`] for a proposal set that is
    /// empty, oversized, misordered, duplicated, or inconsistent with its declared cardinality.
    pub fn validate(&self) -> Result<(), IterationResultAdmissionErrorV1> {
        validate_operation_request(self)
    }
}

/// Exact Backtest facts projected by the R&D Owner from the locked canonical Result bytes.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationResultBacktestBindingV1 {
    pub result_identity: String,
    pub result_digest: String,
    pub request_identity: String,
    pub request_meaning_digest: String,
    pub attempt_identity: String,
    pub namespace: ReplayNamespaceV2,
    pub terminal: ReplayTerminalV2,
    pub result_storage_digest: String,
}

/// Exact R&D TrialFamily facts read under the caller's lock.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationResultTrialFamilyBindingV1 {
    pub trial_family_identity: String,
    pub census_frontier_identity: String,
    pub census_frontier_digest: String,
    pub candidate_set_frontier_identity: String,
    pub candidate_set_frontier_digest: String,
    pub frontier_candidate_identities: Vec<String>,
}

/// The family's sealed trial budget and the budget already consumed by committed attempts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationResultBudgetBindingV1 {
    pub trial_budget: u32,
    pub consumed_trial_budget: u32,
}

impl IterationResultBudgetBindingV1 {
    /// Returns the trial budget still available to the next iteration.
    #[must_use]
    pub const fn remaining_trial_budget(&self) -> u32 {
        self.trial_budget.saturating_sub(self.consumed_trial_budget)
    }
}

/// Complete Owner-locked input for one admission.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationResultAdmissionInputV1 {
    pub backtest: IterationResultBacktestBindingV1,
    pub family: IterationResultTrialFamilyBindingV1,
    pub budget: IterationResultBudgetBindingV1,
    pub proposals: IterationResultCandidateProposalSetV1,
}

/// Immutable R&D admission of one exact Result. Positive authority comes only from Owner readback.
///
/// ```compile_fail
/// use vibe_strategy_factory::iteration_result_admission::IterationResultAdmissionV1;
/// let _: IterationResultAdmissionV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationResultAdmissionV1 {
    schema_version: u16,
    admission_identity: String,
    admission_digest: String,
    locator: IterationResultAdmissionLocatorV1,
    input: IterationResultAdmissionInputV1,
    committed_at_epoch_ms: u64,
}

/// Owner receipt; caller JSON cannot manufacture this positive type.
///
/// ```compile_fail
/// use vibe_strategy_factory::iteration_result_admission::IterationResultAdmissionReceiptV1;
/// let _: IterationResultAdmissionReceiptV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationResultAdmissionReceiptV1 {
    schema_version: u16,
    receipt_identity: String,
    receipt_digest: String,
    admission_identity: String,
    admission_digest: String,
    trial_family_identity: String,
    result_identity: String,
    admitted_proposal_count: u32,
    committed_at_epoch_ms: u64,
}

/// Move-only positive readback reconstructed only after complete storage verification.
///
/// ```compile_fail
/// use vibe_strategy_factory::iteration_result_admission::IterationResultAdmissionReadbackV1;
/// let _: IterationResultAdmissionReadbackV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationResultAdmissionReadbackV1 {
    admission: IterationResultAdmissionV1,
    receipt: IterationResultAdmissionReceiptV1,
}

#[derive(Debug, Error)]
pub enum IterationResultAdmissionErrorV1 {
    #[error("iteration result admission locator is invalid")]
    InvalidLocator,
    #[error("the locked Result cannot be admitted to the next iteration")]
    NotApplicable,
    #[error("the Result, TrialFamily, and proposal set do not name one experiment")]
    IdentityMismatch,
    #[error("the candidate proposal set exceeds the remaining sealed trial budget")]
    BudgetExceeded,
    #[error("iteration result admission conflicts with existing custody")]
    Conflict,
    #[error("iteration result admission Owner custody is unavailable: {0}")]
    Unavailable(String),
    #[error("iteration result admission storage is unavailable: {0}")]
    Storage(String),
}

impl IterationResultAdmissionV1 {
    #[must_use]
    pub fn admission_identity(&self) -> &str {
        &self.admission_identity
    }

    #[must_use]
    pub fn admission_digest(&self) -> &str {
        &self.admission_digest
    }

    #[must_use]
    pub const fn locator(&self) -> &IterationResultAdmissionLocatorV1 {
        &self.locator
    }

    #[must_use]
    pub const fn input(&self) -> &IterationResultAdmissionInputV1 {
        &self.input
    }

    #[must_use]
    pub const fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }

    /// Returns the deterministic bytes retained by R&D-owned append-only custody.
    ///
    /// # Errors
    ///
    /// Returns [`IterationResultAdmissionErrorV1::Storage`] if canonical encoding is unavailable.
    pub fn to_canonical_bytes(&self) -> Result<Vec<u8>, IterationResultAdmissionErrorV1> {
        serde_json::to_vec(self)
            .map_err(|e| IterationResultAdmissionErrorV1::Storage(e.to_string()))
    }
}

impl IterationResultAdmissionReceiptV1 {
    #[must_use]
    pub fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }

    #[must_use]
    pub fn receipt_digest(&self) -> &str {
        &self.receipt_digest
    }

    #[must_use]
    pub const fn admitted_proposal_count(&self) -> u32 {
        self.admitted_proposal_count
    }

    /// Returns the deterministic bytes retained by R&D-owned append-only custody.
    ///
    /// # Errors
    ///
    /// Returns [`IterationResultAdmissionErrorV1::Storage`] if canonical encoding is unavailable.
    pub fn to_canonical_bytes(&self) -> Result<Vec<u8>, IterationResultAdmissionErrorV1> {
        serde_json::to_vec(self)
            .map_err(|e| IterationResultAdmissionErrorV1::Storage(e.to_string()))
    }
}

impl IterationResultAdmissionReadbackV1 {
    #[must_use]
    pub const fn admission(&self) -> &IterationResultAdmissionV1 {
        &self.admission
    }

    #[must_use]
    pub const fn receipt(&self) -> &IterationResultAdmissionReceiptV1 {
        &self.receipt
    }

    /// Returns the caller-visible operation request that reproduces this admission.
    ///
    /// A retry that carries the same request is the same admission; any difference is a conflict.
    #[must_use]
    pub fn operation_request(&self) -> IterationResultAdmissionOperationRequestV1 {
        IterationResultAdmissionOperationRequestV1 {
            locator: self.admission.locator.clone(),
            result_digest: self.admission.input.backtest.result_digest.clone(),
            request_meaning_digest: self.admission.input.backtest.request_meaning_digest.clone(),
            proposals: self.admission.input.proposals.clone(),
        }
    }
}

#[derive(Serialize)]
struct AdmissionMeaningV1<'a> {
    schema_version: u16,
    locator: &'a IterationResultAdmissionLocatorV1,
    input: &'a IterationResultAdmissionInputV1,
    committed_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct AdmissionReceiptMeaningV1<'a> {
    schema_version: u16,
    admission_identity: &'a str,
    admission_digest: &'a str,
    trial_family_identity: &'a str,
    result_identity: &'a str,
    admitted_proposal_count: u32,
    committed_at_epoch_ms: u64,
}

/// Projects the exact locked Backtest Result the next iteration may be admitted against.
///
/// # Errors
///
/// Returns [`IterationResultAdmissionErrorV1::NotApplicable`] when the Result is not an exploratory
/// terminal Result, and [`IterationResultAdmissionErrorV1::InvalidLocator`] for a malformed
/// identity or digest.
pub(crate) fn project_locked_backtest_result_v1(
    result: &ReplayResultDtoV2,
    result_storage_digest: &str,
) -> Result<IterationResultBacktestBindingV1, IterationResultAdmissionErrorV1> {
    if result.namespace != ReplayNamespaceV2::Exploratory
        || result.terminal != ReplayTerminalV2::TerminalResult
    {
        return Err(IterationResultAdmissionErrorV1::NotApplicable);
    }
    let binding = IterationResultBacktestBindingV1 {
        result_identity: result.result_identity.as_str().to_owned(),
        result_digest: result.result_digest.as_str().to_owned(),
        request_identity: result.request_identity.as_str().to_owned(),
        request_meaning_digest: result.request_meaning_digest.as_str().to_owned(),
        attempt_identity: result.attempt_identity.as_str().to_owned(),
        namespace: result.namespace,
        terminal: result.terminal,
        result_storage_digest: result_storage_digest.to_owned(),
    };

    if !is_valid_iteration_decision_locator_v1(&binding.result_identity)
        || !is_valid_iteration_decision_locator_v1(&binding.request_identity)
        || !is_valid_iteration_decision_locator_v1(&binding.attempt_identity)
        || !is_canonical_backtest_digest(&binding.result_digest)
        || !is_canonical_backtest_digest(&binding.request_meaning_digest)
        || !is_blake3_digest(&binding.result_storage_digest)
    {
        return Err(IterationResultAdmissionErrorV1::InvalidLocator);
    }
    Ok(binding)
}

/// Issues the only legal admission for one exact Result under complete Owner-locked evidence.
///
/// # Errors
///
/// Returns the identity, applicability, budget, or encoding error that closed the admission.
pub(crate) fn issue_iteration_result_admission_v1(
    request: &IterationResultAdmissionOperationRequestV1,
    input: IterationResultAdmissionInputV1,
    committed_at_epoch_ms: u64,
) -> Result<IterationResultAdmissionReadbackV1, IterationResultAdmissionErrorV1> {
    validate_operation_request(request)?;
    verify_admission_identity_v1(request, &input)?;
    verify_admission_budget_v1(&input)?;

    let locator = request.locator.clone();
    let admission_digest = canonical_digest(
        ADMISSION_DOMAIN_V1,
        &AdmissionMeaningV1 {
            schema_version: 1,
            locator: &locator,
            input: &input,
            committed_at_epoch_ms,
        },
    )?;
    let admission_identity = identity(ADMISSION_IDENTITY_PREFIX_V1, &admission_digest);
    let admitted_proposal_count = input.proposals.expected_cardinality;
    let receipt_digest = canonical_digest(
        ADMISSION_RECEIPT_DOMAIN_V1,
        &AdmissionReceiptMeaningV1 {
            schema_version: 1,
            admission_identity: &admission_identity,
            admission_digest: &admission_digest,
            trial_family_identity: &locator.trial_family_identity,
            result_identity: &locator.result_identity,
            admitted_proposal_count,
            committed_at_epoch_ms,
        },
    )?;
    Ok(IterationResultAdmissionReadbackV1 {
        receipt: IterationResultAdmissionReceiptV1 {
            schema_version: 1,
            receipt_identity: identity(ADMISSION_RECEIPT_IDENTITY_PREFIX_V1, &receipt_digest),
            receipt_digest,
            admission_identity: admission_identity.clone(),
            admission_digest: admission_digest.clone(),
            trial_family_identity: locator.trial_family_identity.clone(),
            result_identity: locator.result_identity.clone(),
            admitted_proposal_count,
            committed_at_epoch_ms,
        },
        admission: IterationResultAdmissionV1 {
            schema_version: 1,
            admission_identity,
            admission_digest,
            locator,
            input,
            committed_at_epoch_ms,
        },
    })
}

/// Admits a retry only when it reproduces the stored admission exactly.
///
/// # Errors
///
/// Returns [`IterationResultAdmissionErrorV1::Conflict`] when the retry names the same Result with
/// a different digest, proposal set, or family.
pub(crate) fn ensure_same_admission_request_v1(
    existing: &IterationResultAdmissionReadbackV1,
    request: &IterationResultAdmissionOperationRequestV1,
) -> Result<(), IterationResultAdmissionErrorV1> {
    if existing.operation_request() == *request {
        Ok(())
    } else {
        Err(IterationResultAdmissionErrorV1::Conflict)
    }
}

fn verify_admission_identity_v1(
    request: &IterationResultAdmissionOperationRequestV1,
    input: &IterationResultAdmissionInputV1,
) -> Result<(), IterationResultAdmissionErrorV1> {
    let locator = &request.locator;
    let backtest = &input.backtest;
    if backtest.result_identity != locator.result_identity
        || backtest.request_identity != locator.request_identity
        || backtest.attempt_identity != locator.attempt_identity
        || backtest.result_digest != request.result_digest
        || backtest.request_meaning_digest != request.request_meaning_digest
        || input.family.trial_family_identity != locator.trial_family_identity
        || input.proposals != request.proposals
    {
        return Err(IterationResultAdmissionErrorV1::IdentityMismatch);
    }

    if backtest.namespace != ReplayNamespaceV2::Exploratory
        || backtest.terminal != ReplayTerminalV2::TerminalResult
    {
        return Err(IterationResultAdmissionErrorV1::NotApplicable);
    }

    if !is_valid_iteration_decision_locator_v1(&input.family.census_frontier_identity)
        || !is_valid_iteration_decision_locator_v1(&input.family.candidate_set_frontier_identity)
        || !is_sha256_digest(&input.family.census_frontier_digest)
        || !is_sha256_digest(&input.family.candidate_set_frontier_digest)
        || !is_blake3_digest(&backtest.result_storage_digest)
        || !is_canonical_backtest_digest(&backtest.result_digest)
        || !is_canonical_backtest_digest(&backtest.request_meaning_digest)
    {
        return Err(IterationResultAdmissionErrorV1::InvalidLocator);
    }

    if input.proposals.proposals.iter().any(|proposal| {
        input
            .family
            .frontier_candidate_identities
            .contains(&proposal.candidate_identity)
    }) {
        return Err(IterationResultAdmissionErrorV1::IdentityMismatch);
    }
    Ok(())
}

fn verify_admission_budget_v1(
    input: &IterationResultAdmissionInputV1,
) -> Result<(), IterationResultAdmissionErrorV1> {
    if input.budget.trial_budget == 0
        || input.budget.consumed_trial_budget > input.budget.trial_budget
    {
        return Err(IterationResultAdmissionErrorV1::NotApplicable);
    }

    if input.proposals.expected_cardinality > input.budget.remaining_trial_budget() {
        return Err(IterationResultAdmissionErrorV1::BudgetExceeded);
    }
    Ok(())
}

fn validate_operation_request(
    request: &IterationResultAdmissionOperationRequestV1,
) -> Result<(), IterationResultAdmissionErrorV1> {
    validate_locator(&request.locator)?;
    if !is_canonical_backtest_digest(&request.result_digest)
        || !is_canonical_backtest_digest(&request.request_meaning_digest)
    {
        return Err(IterationResultAdmissionErrorV1::InvalidLocator);
    }
    validate_proposal_set(&request.proposals)
}

pub(crate) fn validate_locator(
    locator: &IterationResultAdmissionLocatorV1,
) -> Result<(), IterationResultAdmissionErrorV1> {
    if [
        locator.trial_family_identity.as_str(),
        locator.result_identity.as_str(),
        locator.request_identity.as_str(),
        locator.attempt_identity.as_str(),
    ]
    .into_iter()
    .any(|value| !is_valid_iteration_decision_locator_v1(value))
    {
        return Err(IterationResultAdmissionErrorV1::InvalidLocator);
    }
    Ok(())
}

fn validate_proposal_set(
    proposals: &IterationResultCandidateProposalSetV1,
) -> Result<(), IterationResultAdmissionErrorV1> {
    if !is_valid_iteration_decision_locator_v1(&proposals.generation_rule_identity)
        || !is_sha256_digest(&proposals.generation_rule_digest)
    {
        return Err(IterationResultAdmissionErrorV1::InvalidLocator);
    }

    if proposals.proposals.is_empty()
        || proposals.proposals.len() > MAX_PROPOSALS
        || usize::try_from(proposals.expected_cardinality)
            .map_err(|e| IterationResultAdmissionErrorV1::Unavailable(e.to_string()))?
            != proposals.proposals.len()
    {
        return Err(IterationResultAdmissionErrorV1::NotApplicable);
    }
    let mut previous: Option<&str> = None;

    for proposal in &proposals.proposals {
        if !is_valid_iteration_decision_locator_v1(&proposal.candidate_identity)
            || !is_sha256_digest(&proposal.candidate_digest)
        {
            return Err(IterationResultAdmissionErrorV1::InvalidLocator);
        }

        if previous.is_some_and(|previous| previous >= proposal.candidate_identity.as_str()) {
            return Err(IterationResultAdmissionErrorV1::NotApplicable);
        }
        validate_experiment(&proposal.experiment)?;
        previous = Some(&proposal.candidate_identity);
    }
    Ok(())
}

fn validate_experiment(
    experiment: &IterationExperimentModeV1,
) -> Result<(), IterationResultAdmissionErrorV1> {
    let IterationExperimentModeV1::PreregisteredFiniteJoint { contract } = experiment else {
        return Ok(());
    };

    if contract.changed_dimensions.is_empty() || contract.bounded_combinations.is_empty() {
        return Err(IterationResultAdmissionErrorV1::NotApplicable);
    }
    let mut dimensions = contract.changed_dimensions.clone();
    dimensions.sort_unstable();
    dimensions.dedup();
    if dimensions.len() != contract.changed_dimensions.len() {
        return Err(IterationResultAdmissionErrorV1::NotApplicable);
    }
    Ok(())
}

pub(crate) fn canonical_digest(
    domain: &str,
    value: &impl Serialize,
) -> Result<String, IterationResultAdmissionErrorV1> {
    let bytes = serde_json::to_vec(value)
        .map_err(|e| IterationResultAdmissionErrorV1::Storage(e.to_string()))?;
    let mut hasher = Sha256::new();
    hasher.update(domain.as_bytes());
    hasher.update([0]);
    hasher.update(bytes);
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

pub(crate) fn owner_storage_digest(domain: &str, bytes: &[u8]) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain.as_bytes());
    hasher.update(&[0]);
    hasher.update(bytes);
    format!("blake3:{}", hasher.finalize().to_hex())
}

pub(crate) fn identity(prefix: &str, digest: &str) -> String {
    format!("{prefix}-{}", digest.trim_start_matches("sha256:"))
}

/// R&D mints every fact digest it owns as `sha256`.
fn is_sha256_digest(value: &str) -> bool {
    is_digest_with_prefix(value, "sha256:")
}

/// R&D-owned storage digests are `blake3` over canonical bytes.
fn is_blake3_digest(value: &str) -> bool {
    is_digest_with_prefix(value, "blake3:")
}

/// Backtest's canonical Replay vocabulary admits either algorithm, so R&D must accept both.
fn is_canonical_backtest_digest(value: &str) -> bool {
    is_sha256_digest(value) || is_blake3_digest(value)
}

fn is_digest_with_prefix(value: &str, prefix: &str) -> bool {
    value.strip_prefix(prefix).is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use rstest::rstest;
    use vibe_backtest_owner_contracts::{
        CanonicalDigestV2, OpaqueIdentityV2, ReplayAuthorityClaimV2,
    };

    use super::*;
    use crate::{
        IterationEvidenceReferenceV1, IterationHypothesisDimensionV1,
        IterationPreregisteredFiniteJointV1,
    };

    const COMMITTED_AT: u64 = 1_700_000_000_000;

    fn sha(byte: char) -> String {
        format!("sha256:{}", byte.to_string().repeat(64))
    }

    fn blake(byte: char) -> String {
        format!("blake3:{}", byte.to_string().repeat(64))
    }

    fn opaque(value: &str) -> OpaqueIdentityV2 {
        value.to_owned().try_into().expect("valid identity")
    }

    fn canonical(value: String) -> CanonicalDigestV2 {
        value.try_into().expect("valid digest")
    }

    fn locator() -> IterationResultAdmissionLocatorV1 {
        IterationResultAdmissionLocatorV1 {
            trial_family_identity: "rd-trial-family-1".to_owned(),
            result_identity: "backtest-result-1".to_owned(),
            request_identity: "exploratory-request-1".to_owned(),
            attempt_identity: "backtest-attempt-1".to_owned(),
        }
    }

    fn result_dto() -> ReplayResultDtoV2 {
        ReplayResultDtoV2 {
            schema_version: 2,
            result_identity: opaque("backtest-result-1"),
            result_digest: canonical(blake('3')),
            request_identity: opaque("exploratory-request-1"),
            request_meaning_digest: canonical(blake('2')),
            namespace: ReplayNamespaceV2::Exploratory,
            replay_authority: ReplayAuthorityClaimV2::Exploratory,
            attempt_identity: opaque("backtest-attempt-1"),
            terminal: ReplayTerminalV2::TerminalResult,
            reconciliation: Vec::new(),
            semantic_trace: None,
            diagnostic_census: Vec::new(),
        }
    }

    fn backtest_binding() -> IterationResultBacktestBindingV1 {
        project_locked_backtest_result_v1(&result_dto(), &blake('a'))
            .expect("exact exploratory terminal Result")
    }

    fn proposal(candidate_identity: &str, digest_byte: char) -> IterationResultCandidateProposalV1 {
        IterationResultCandidateProposalV1 {
            candidate_identity: candidate_identity.to_owned(),
            candidate_digest: sha(digest_byte),
            experiment: IterationExperimentModeV1::SingleDimension {
                changed_dimension: IterationHypothesisDimensionV1::ReturnMechanism,
            },
        }
    }

    fn proposal_set() -> IterationResultCandidateProposalSetV1 {
        IterationResultCandidateProposalSetV1 {
            generation_rule_identity: "rd-generation-rule-1".to_owned(),
            generation_rule_digest: sha('4'),
            expected_cardinality: 2,
            proposals: vec![proposal("candidate-1", '1'), proposal("candidate-2", '2')],
        }
    }

    fn family_binding() -> IterationResultTrialFamilyBindingV1 {
        IterationResultTrialFamilyBindingV1 {
            trial_family_identity: "rd-trial-family-1".to_owned(),
            census_frontier_identity: "rd-census-frontier-1".to_owned(),
            census_frontier_digest: sha('5'),
            candidate_set_frontier_identity: "rd-candidate-set-frontier-1".to_owned(),
            candidate_set_frontier_digest: sha('6'),
            frontier_candidate_identities: vec!["candidate-0".to_owned()],
        }
    }

    fn budget_binding() -> IterationResultBudgetBindingV1 {
        IterationResultBudgetBindingV1 {
            trial_budget: 8,
            consumed_trial_budget: 3,
        }
    }

    fn request() -> IterationResultAdmissionOperationRequestV1 {
        IterationResultAdmissionOperationRequestV1 {
            locator: locator(),
            result_digest: blake('3'),
            request_meaning_digest: blake('2'),
            proposals: proposal_set(),
        }
    }

    fn input() -> IterationResultAdmissionInputV1 {
        IterationResultAdmissionInputV1 {
            backtest: backtest_binding(),
            family: family_binding(),
            budget: budget_binding(),
            proposals: proposal_set(),
        }
    }

    fn admit() -> IterationResultAdmissionReadbackV1 {
        issue_iteration_result_admission_v1(&request(), input(), COMMITTED_AT)
            .expect("complete Owner-locked admission")
    }

    /// One complete Owner-issued admission for the custody module's storage tests.
    pub(crate) fn admission_fixture() -> IterationResultAdmissionReadbackV1 {
        admit()
    }

    /// The exact operation request that reproduces [`admission_fixture`].
    pub(crate) fn admission_request_fixture() -> IterationResultAdmissionOperationRequestV1 {
        request()
    }

    #[rstest]
    fn admitted_event_and_operation_have_one_frozen_name() {
        assert_eq!(
            ITERATION_RESULT_ADMITTED_EVENT_V1,
            "RD_ITERATION_RESULT_ADMITTED_V1"
        );
        assert_eq!(
            ITERATION_RESULT_ADMISSION_OPERATION_V1,
            "iteration_result_admission.admit.v1"
        );
    }

    #[rstest]
    fn admission_binds_the_exact_result_family_and_proposal_set() {
        let readback = admit();
        let admission = readback.admission();
        assert_eq!(admission.locator(), &locator());
        assert_eq!(admission.input().backtest.result_digest, blake('3'));
        assert_eq!(admission.input().proposals, proposal_set());
        assert_eq!(admission.committed_at_epoch_ms(), COMMITTED_AT);
        assert_eq!(readback.receipt().admitted_proposal_count(), 2);
        assert!(
            admission
                .admission_identity()
                .starts_with("rd-iteration-result-admission-v1-")
        );
        assert!(admission.admission_digest().starts_with("sha256:"));
        assert!(
            readback
                .receipt()
                .receipt_identity()
                .starts_with("rd-iteration-result-admission-receipt-v1-")
        );
    }

    #[rstest]
    fn identity_and_digest_are_deterministic_and_bound_to_the_commit_instant() {
        let first = admit();
        let second = admit();
        assert_eq!(
            first.admission().admission_identity(),
            second.admission().admission_identity()
        );
        assert_eq!(
            first.receipt().receipt_digest(),
            second.receipt().receipt_digest()
        );

        let later = issue_iteration_result_admission_v1(&request(), input(), COMMITTED_AT + 1)
            .expect("later admission");
        assert_ne!(
            first.admission().admission_digest(),
            later.admission().admission_digest()
        );
        assert_ne!(
            first.receipt().receipt_identity(),
            later.receipt().receipt_identity()
        );
    }

    #[rstest]
    fn admission_digest_covers_every_locked_input_field() {
        let baseline = admit().admission().admission_digest().to_owned();

        let mut budget_changed = input();
        budget_changed.budget.consumed_trial_budget = 4;
        let changed = issue_iteration_result_admission_v1(&request(), budget_changed, COMMITTED_AT)
            .expect("admission under a different consumed budget");
        assert_ne!(baseline, changed.admission().admission_digest());

        let mut family_changed = input();
        family_changed.family.census_frontier_digest = sha('7');
        let changed = issue_iteration_result_admission_v1(&request(), family_changed, COMMITTED_AT)
            .expect("admission under a different census frontier");
        assert_ne!(baseline, changed.admission().admission_digest());
    }

    #[rstest]
    #[case::result_identity("backtest-result-2", None, None)]
    #[case::request_identity("backtest-result-1", Some("exploratory-request-2"), None)]
    #[case::attempt_identity("backtest-result-1", None, Some("backtest-attempt-2"))]
    fn a_result_that_is_not_the_located_one_closes_the_admission(
        #[case] result_identity: &str,
        #[case] request_identity: Option<&str>,
        #[case] attempt_identity: Option<&str>,
    ) {
        let mut input = input();
        input.backtest.result_identity = result_identity.to_owned();
        if let Some(value) = request_identity {
            input.backtest.request_identity = value.to_owned();
        }

        if let Some(value) = attempt_identity {
            input.backtest.attempt_identity = value.to_owned();
        }
        assert!(matches!(
            issue_iteration_result_admission_v1(&request(), input, COMMITTED_AT),
            Err(IterationResultAdmissionErrorV1::IdentityMismatch)
        ));
    }

    #[rstest]
    fn a_claimed_result_digest_that_is_not_the_locked_one_closes_the_admission() {
        let mut request = request();
        request.result_digest = blake('9');
        assert!(matches!(
            issue_iteration_result_admission_v1(&request, input(), COMMITTED_AT),
            Err(IterationResultAdmissionErrorV1::IdentityMismatch)
        ));

        let mut request = self::request();
        request.request_meaning_digest = blake('9');
        assert!(matches!(
            issue_iteration_result_admission_v1(&request, input(), COMMITTED_AT),
            Err(IterationResultAdmissionErrorV1::IdentityMismatch)
        ));
    }

    #[rstest]
    fn a_result_from_another_family_closes_the_admission() {
        let mut input = input();
        input.family.trial_family_identity = "rd-trial-family-2".to_owned();
        assert!(matches!(
            issue_iteration_result_admission_v1(&request(), input, COMMITTED_AT),
            Err(IterationResultAdmissionErrorV1::IdentityMismatch)
        ));
    }

    #[rstest]
    fn a_proposal_set_the_caller_did_not_request_closes_the_admission() {
        let mut input = input();
        input.proposals.proposals[1] = proposal("candidate-3", '2');
        assert!(matches!(
            issue_iteration_result_admission_v1(&request(), input, COMMITTED_AT),
            Err(IterationResultAdmissionErrorV1::IdentityMismatch)
        ));
    }

    #[rstest]
    fn a_committed_frontier_member_cannot_be_reproposed() {
        let mut input = input();
        input.family.frontier_candidate_identities = vec!["candidate-2".to_owned()];
        assert!(matches!(
            issue_iteration_result_admission_v1(&request(), input, COMMITTED_AT),
            Err(IterationResultAdmissionErrorV1::IdentityMismatch)
        ));
    }

    #[rstest]
    #[case::protected(ReplayNamespaceV2::Protected, ReplayTerminalV2::TerminalResult)]
    #[case::in_progress(ReplayNamespaceV2::Exploratory, ReplayTerminalV2::InProgressOrUnknown)]
    #[case::rejected(ReplayNamespaceV2::Exploratory, ReplayTerminalV2::RunRejected)]
    #[case::invalid(
        ReplayNamespaceV2::Exploratory,
        ReplayTerminalV2::InvalidReplayEvidence
    )]
    fn only_an_exploratory_terminal_result_reaches_the_next_iteration(
        #[case] namespace: ReplayNamespaceV2,
        #[case] terminal: ReplayTerminalV2,
    ) {
        let mut result = result_dto();
        result.namespace = namespace;
        result.terminal = terminal;
        assert!(matches!(
            project_locked_backtest_result_v1(&result, &blake('a')),
            Err(IterationResultAdmissionErrorV1::NotApplicable)
        ));

        let mut input = input();
        input.backtest.namespace = namespace;
        input.backtest.terminal = terminal;
        assert!(matches!(
            issue_iteration_result_admission_v1(&request(), input, COMMITTED_AT),
            Err(IterationResultAdmissionErrorV1::NotApplicable)
        ));
    }

    #[rstest]
    fn a_locked_result_projects_both_canonical_digest_algorithms() {
        let mut result = result_dto();
        result.result_digest = canonical(sha('3'));
        let binding = project_locked_backtest_result_v1(&result, &blake('a'))
            .expect("sha256 Backtest digests are canonical");
        assert_eq!(binding.result_digest, sha('3'));

        assert!(matches!(
            project_locked_backtest_result_v1(&result_dto(), "sha256:not-a-storage-digest"),
            Err(IterationResultAdmissionErrorV1::InvalidLocator)
        ));
    }

    #[rstest]
    #[case::exactly_remaining(5, 5)]
    #[case::below_remaining(5, 1)]
    fn a_proposal_set_within_the_remaining_budget_is_admitted(
        #[case] consumed: u32,
        #[case] proposals: u32,
    ) {
        let mut input = input();
        input.budget = IterationResultBudgetBindingV1 {
            trial_budget: 10,
            consumed_trial_budget: consumed,
        };
        let mut request = request();
        set_cardinality(&mut request.proposals, proposals);
        input.proposals = request.proposals.clone();
        assert_eq!(input.budget.remaining_trial_budget(), 10 - consumed);
        let readback = issue_iteration_result_admission_v1(&request, input, COMMITTED_AT)
            .expect("proposal set fits the remaining sealed budget");
        assert_eq!(readback.receipt().admitted_proposal_count(), proposals);
    }

    #[rstest]
    fn a_proposal_set_beyond_the_remaining_budget_is_refused() {
        let mut input = input();
        input.budget = IterationResultBudgetBindingV1 {
            trial_budget: 4,
            consumed_trial_budget: 3,
        };
        assert!(matches!(
            issue_iteration_result_admission_v1(&request(), input, COMMITTED_AT),
            Err(IterationResultAdmissionErrorV1::BudgetExceeded)
        ));
    }

    #[rstest]
    #[case::unsealed_budget(0, 0)]
    #[case::overconsumed_budget(4, 5)]
    fn an_unusable_sealed_budget_is_not_applicable(
        #[case] trial_budget: u32,
        #[case] consumed_trial_budget: u32,
    ) {
        let mut input = input();
        input.budget = IterationResultBudgetBindingV1 {
            trial_budget,
            consumed_trial_budget,
        };
        assert!(matches!(
            issue_iteration_result_admission_v1(&request(), input, COMMITTED_AT),
            Err(IterationResultAdmissionErrorV1::NotApplicable)
        ));
    }

    #[rstest]
    fn a_retry_that_repeats_the_request_is_the_same_admission() {
        let committed = admit();
        assert_eq!(committed.operation_request(), request());
        assert!(ensure_same_admission_request_v1(&committed, &request()).is_ok());
    }

    #[rstest]
    fn a_retry_that_changes_the_request_conflicts() {
        let committed = admit();

        let mut changed_proposals = request();
        changed_proposals.proposals.proposals[0] = proposal("candidate-1", '9');
        assert!(matches!(
            ensure_same_admission_request_v1(&committed, &changed_proposals),
            Err(IterationResultAdmissionErrorV1::Conflict)
        ));

        let mut changed_digest = request();
        changed_digest.result_digest = blake('9');
        assert!(matches!(
            ensure_same_admission_request_v1(&committed, &changed_digest),
            Err(IterationResultAdmissionErrorV1::Conflict)
        ));

        let mut changed_family = request();
        changed_family.locator.trial_family_identity = "rd-trial-family-2".to_owned();
        assert!(matches!(
            ensure_same_admission_request_v1(&committed, &changed_family),
            Err(IterationResultAdmissionErrorV1::Conflict)
        ));
    }

    #[rstest]
    fn a_proposal_set_must_be_ordered_by_its_canonical_byte_key() {
        let mut request = request();
        request.proposals.proposals.swap(0, 1);
        assert!(matches!(
            request.validate(),
            Err(IterationResultAdmissionErrorV1::NotApplicable)
        ));

        let mut duplicated = self::request();
        duplicated.proposals.proposals[1] = proposal("candidate-1", '2');
        assert!(matches!(
            duplicated.validate(),
            Err(IterationResultAdmissionErrorV1::NotApplicable)
        ));
    }

    #[rstest]
    #[case::empty(0)]
    #[case::understated(1)]
    #[case::overstated(3)]
    fn a_proposal_set_must_declare_its_own_cardinality(#[case] expected_cardinality: u32) {
        let mut request = request();
        request.proposals.expected_cardinality = expected_cardinality;
        if expected_cardinality == 0 {
            request.proposals.proposals.clear();
        }
        assert!(matches!(
            request.validate(),
            Err(IterationResultAdmissionErrorV1::NotApplicable)
        ));
    }

    #[rstest]
    fn a_preregistered_joint_experiment_must_name_distinct_bounded_dimensions() {
        let contract = |dimensions: Vec<IterationHypothesisDimensionV1>| {
            IterationExperimentModeV1::PreregisteredFiniteJoint {
                contract: Box::new(IterationPreregisteredFiniteJointV1 {
                    changed_dimensions: dimensions,
                    bounded_combinations: vec![reference()],
                    attribution_rule: reference(),
                    budget: reference(),
                    falsifier: reference(),
                    stop_rule: reference(),
                }),
            }
        };
        let mut request = request();
        request.proposals.proposals[0].experiment = contract(vec![
            IterationHypothesisDimensionV1::EntryRule,
            IterationHypothesisDimensionV1::ExitRule,
        ]);
        assert!(request.validate().is_ok());

        request.proposals.proposals[0].experiment = contract(vec![
            IterationHypothesisDimensionV1::EntryRule,
            IterationHypothesisDimensionV1::EntryRule,
        ]);
        assert!(matches!(
            request.validate(),
            Err(IterationResultAdmissionErrorV1::NotApplicable)
        ));

        request.proposals.proposals[0].experiment = contract(Vec::new());
        assert!(matches!(
            request.validate(),
            Err(IterationResultAdmissionErrorV1::NotApplicable)
        ));
    }

    fn reference() -> IterationEvidenceReferenceV1 {
        IterationEvidenceReferenceV1 {
            identity: "rd-evidence-1".to_owned(),
            digest: sha('8'),
        }
    }

    #[rstest]
    fn a_malformed_locator_or_digest_never_reaches_owner_evidence() {
        let mut empty_family = request();
        empty_family.locator.trial_family_identity = String::new();
        assert!(matches!(
            empty_family.validate(),
            Err(IterationResultAdmissionErrorV1::InvalidLocator)
        ));

        let mut spaced_result = request();
        spaced_result.locator.result_identity = "backtest result 1".to_owned();
        assert!(matches!(
            spaced_result.validate(),
            Err(IterationResultAdmissionErrorV1::InvalidLocator)
        ));

        let mut short_digest = request();
        short_digest.result_digest = format!("sha256:{}", "3".repeat(63));
        assert!(matches!(
            short_digest.validate(),
            Err(IterationResultAdmissionErrorV1::InvalidLocator)
        ));

        let mut unprefixed_digest = request();
        unprefixed_digest.proposals.generation_rule_digest = "3".repeat(64);
        assert!(matches!(
            unprefixed_digest.validate(),
            Err(IterationResultAdmissionErrorV1::InvalidLocator)
        ));

        let mut nonhex_candidate = request();
        nonhex_candidate.proposals.proposals[0].candidate_digest =
            format!("sha256:{}", "z".repeat(64));
        assert!(matches!(
            nonhex_candidate.validate(),
            Err(IterationResultAdmissionErrorV1::InvalidLocator)
        ));
    }

    #[rstest]
    fn the_caller_seam_admits_only_the_exact_operation_request_shape() {
        let canonical_request =
            serde_json::to_value(request()).expect("caller-mintable request JSON");
        assert_eq!(
            serde_json::from_value::<IterationResultAdmissionOperationRequestV1>(
                canonical_request.clone()
            )
            .expect("exact request shape"),
            request()
        );

        let mut widened = canonical_request;
        widened["admission_identity"] =
            serde_json::json!("rd-iteration-result-admission-v1-forged");
        assert!(
            serde_json::from_value::<IterationResultAdmissionOperationRequestV1>(widened).is_err()
        );
    }

    #[rstest]
    fn owner_storage_and_canonical_digests_are_domain_separated() {
        let bytes = admit()
            .admission()
            .to_canonical_bytes()
            .expect("canonical admission bytes");
        assert_ne!(
            owner_storage_digest("rd.iteration-result-admission.storage.v1", &bytes),
            owner_storage_digest("rd.iteration-result-admission-receipt.storage.v1", &bytes)
        );
        assert_ne!(
            canonical_digest(ADMISSION_DOMAIN_V1, &request()).expect("admission domain digest"),
            canonical_digest(ADMISSION_RECEIPT_DOMAIN_V1, &request())
                .expect("receipt domain digest")
        );
        assert_eq!(
            identity(ADMISSION_IDENTITY_PREFIX_V1, &sha('1')),
            format!("{ADMISSION_IDENTITY_PREFIX_V1}-{}", "1".repeat(64))
        );
    }

    fn set_cardinality(proposals: &mut IterationResultCandidateProposalSetV1, cardinality: u32) {
        proposals.expected_cardinality = cardinality;
        proposals.proposals = (0..cardinality)
            .map(|ordinal| proposal(&format!("candidate-{ordinal:04}"), '1'))
            .collect();
    }
}
