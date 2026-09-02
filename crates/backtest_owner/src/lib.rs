//! Backtest-owned Replay V2 observations, reconciliation, diagnostics, and sealed results.
//!
//! Public callers can inspect and serialize a committed result but cannot construct, deserialize,
//! or attest any consumed component or diagnostic. Future Native Replay and Sim journal modules must
//! compose inside this crate and call the crate-private commit boundary.

#![expect(
    dead_code,
    reason = "the private construction path is reserved for the four scoped Replay V2 successors"
)]

use std::{collections::BTreeMap, fmt::Display};

use serde::Serialize;
use thiserror::Error;
pub use vibe_backtest_owner_contracts::{
    CanonicalDigestV2, ComponentObservationLocatorV2, ContentIdentityV2, DiagnosticCategoryV2,
    ObservationComponentV2, OpaqueIdentityV2, ReplayAuthorityClaimV2, ReplayNamespaceV2,
    ReplayRequestDtoV2, ReplayRequestV2, ReplayTerminalV2, VersionedIdentityV2,
};
use vibe_backtest_owner_contracts::{ReplayModelProfilesV2, ReplayWindowV2};

mod sealed {
    pub trait Sealed {}
}

mod native_replay;
pub mod postgres;

pub use native_replay::run_stateful_trend_native_replay_v2;

/// Read-only view of an observation created by Backtest's internal composition boundary.
///
/// The private supertrait prevents arbitrary external implementations.
pub trait ReplayConsumptionObservationV2: sealed::Sealed {
    /// Exact request identity under which consumption occurred.
    fn request_identity(&self) -> &OpaqueIdentityV2;
    /// Digest of the complete request meaning under which consumption occurred.
    fn request_meaning_digest(&self) -> &CanonicalDigestV2;
    /// Exact Backtest attempt under which consumption occurred.
    fn attempt_identity(&self) -> &OpaqueIdentityV2;
    /// Component whose actual consumption was observed.
    fn component(&self) -> ObservationComponentV2;
    /// Opaque locator for the producer-owned observation.
    fn locator(&self) -> &ComponentObservationLocatorV2;
    /// Identity of the exact meaning consumed by Backtest.
    fn observed_meaning_identity(&self) -> &OpaqueIdentityV2;
    /// Digest of the exact observed meaning for reconciliation.
    fn observed_meaning_digest(&self) -> &CanonicalDigestV2;
}

/// One Backtest-internal component consumption observation.
#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ConsumedComponentObservationV2 {
    request_identity: OpaqueIdentityV2,
    request_meaning_digest: CanonicalDigestV2,
    attempt_identity: OpaqueIdentityV2,
    component: ObservationComponentV2,
    locator: ComponentObservationLocatorV2,
    observed_meaning_identity: OpaqueIdentityV2,
    observed_meaning_digest: CanonicalDigestV2,
}

impl sealed::Sealed for ConsumedComponentObservationV2 {}

impl ReplayConsumptionObservationV2 for ConsumedComponentObservationV2 {
    fn request_identity(&self) -> &OpaqueIdentityV2 {
        &self.request_identity
    }

    fn request_meaning_digest(&self) -> &CanonicalDigestV2 {
        &self.request_meaning_digest
    }

    fn attempt_identity(&self) -> &OpaqueIdentityV2 {
        &self.attempt_identity
    }

    fn component(&self) -> ObservationComponentV2 {
        self.component
    }

    fn locator(&self) -> &ComponentObservationLocatorV2 {
        &self.locator
    }

    fn observed_meaning_identity(&self) -> &OpaqueIdentityV2 {
        &self.observed_meaning_identity
    }

    fn observed_meaning_digest(&self) -> &CanonicalDigestV2 {
        &self.observed_meaning_digest
    }
}

/// Exact relation between one requested component and its owner-observed consumption.
#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReconciliationAtomV2 {
    component: ObservationComponentV2,
    requested_meaning_identity: OpaqueIdentityV2,
    requested_meaning_digest: CanonicalDigestV2,
    observed_meaning_identity: Option<OpaqueIdentityV2>,
    observed_meaning_digest: Option<CanonicalDigestV2>,
    observation_locator: Option<ComponentObservationLocatorV2>,
    status: ReconciliationStatusV2,
}

impl ReconciliationAtomV2 {
    #[must_use]
    pub const fn component(&self) -> ObservationComponentV2 {
        self.component
    }

    #[must_use]
    pub fn requested_meaning_identity(&self) -> &OpaqueIdentityV2 {
        &self.requested_meaning_identity
    }

    #[must_use]
    pub fn requested_meaning_digest(&self) -> &CanonicalDigestV2 {
        &self.requested_meaning_digest
    }

    #[must_use]
    pub fn observed_meaning_identity(&self) -> Option<&OpaqueIdentityV2> {
        self.observed_meaning_identity.as_ref()
    }

    #[must_use]
    pub fn observed_meaning_digest(&self) -> Option<&CanonicalDigestV2> {
        self.observed_meaning_digest.as_ref()
    }

    #[must_use]
    pub fn observation_locator(&self) -> Option<&ComponentObservationLocatorV2> {
        self.observation_locator.as_ref()
    }

    #[must_use]
    pub const fn status(&self) -> ReconciliationStatusV2 {
        self.status
    }
}

/// Exhaustive comparison outcome for one requested Replay V2 component.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReconciliationStatusV2 {
    Exact,
    Missing,
    Mismatched,
}

/// One Backtest-owned diagnostic classification and its decisive evidence cut.
#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DiagnosticEvidenceV2 {
    request_identity: OpaqueIdentityV2,
    request_meaning_digest: CanonicalDigestV2,
    attempt_identity: OpaqueIdentityV2,
    category: DiagnosticCategoryV2,
    decisive_evidence: ComponentObservationLocatorV2,
}

impl DiagnosticEvidenceV2 {
    #[must_use]
    pub fn request_identity(&self) -> &OpaqueIdentityV2 {
        &self.request_identity
    }

    #[must_use]
    pub fn request_meaning_digest(&self) -> &CanonicalDigestV2 {
        &self.request_meaning_digest
    }

    #[must_use]
    pub fn attempt_identity(&self) -> &OpaqueIdentityV2 {
        &self.attempt_identity
    }

    #[must_use]
    pub const fn category(&self) -> DiagnosticCategoryV2 {
        self.category
    }

    #[must_use]
    pub fn decisive_evidence(&self) -> &ComponentObservationLocatorV2 {
        &self.decisive_evidence
    }
}

/// Canonically ordered, complete diagnostic census for a terminal Replay V2 result.
#[derive(Debug, Serialize)]
#[serde(transparent)]
pub struct DiagnosticCensusV2(Vec<DiagnosticEvidenceV2>);

impl DiagnosticCensusV2 {
    #[must_use]
    pub fn as_slice(&self) -> &[DiagnosticEvidenceV2] {
        &self.0
    }
}

/// Serialize-only positive or negative Replay V2 result committed by Backtest.
///
/// It has no public constructor and deliberately does not implement `Deserialize` or `Clone`.
#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SealedReplayResultV2 {
    schema_version: u16,
    result_identity: OpaqueIdentityV2,
    result_digest: CanonicalDigestV2,
    request_identity: OpaqueIdentityV2,
    request_meaning_digest: CanonicalDigestV2,
    namespace: ReplayNamespaceV2,
    replay_authority: ReplayAuthorityClaimV2,
    attempt_identity: OpaqueIdentityV2,
    terminal: ReplayTerminalV2,
    reconciliation: Vec<ReconciliationAtomV2>,
    semantic_trace: Option<ConsumedComponentObservationV2>,
    diagnostic_census: DiagnosticCensusV2,
}

impl SealedReplayResultV2 {
    #[must_use]
    pub fn result_identity(&self) -> &OpaqueIdentityV2 {
        &self.result_identity
    }

    #[must_use]
    pub fn result_digest(&self) -> &CanonicalDigestV2 {
        &self.result_digest
    }

    #[must_use]
    pub fn request_identity(&self) -> &OpaqueIdentityV2 {
        &self.request_identity
    }

    #[must_use]
    pub fn request_meaning_digest(&self) -> &CanonicalDigestV2 {
        &self.request_meaning_digest
    }

    /// Returns the owner-observed namespace committed into this sealed result.
    #[must_use]
    pub const fn namespace(&self) -> ReplayNamespaceV2 {
        self.namespace
    }

    #[must_use]
    pub fn attempt_identity(&self) -> &OpaqueIdentityV2 {
        &self.attempt_identity
    }

    #[must_use]
    pub const fn terminal(&self) -> ReplayTerminalV2 {
        self.terminal
    }

    #[must_use]
    pub fn reconciliation(&self) -> &[ReconciliationAtomV2] {
        &self.reconciliation
    }

    /// Returns Backtest's semantic-trace observation when the run reached that component.
    #[must_use]
    pub const fn semantic_trace(&self) -> Option<&ConsumedComponentObservationV2> {
        self.semantic_trace.as_ref()
    }

    #[must_use]
    pub const fn diagnostic_census(&self) -> &DiagnosticCensusV2 {
        &self.diagnostic_census
    }

    /// Returns canonical result bytes, including the result's content digest.
    ///
    /// # Errors
    ///
    /// Returns an error if result serialization is unavailable.
    pub fn to_canonical_bytes(&self) -> Result<Vec<u8>, ReplayOwnerErrorV2> {
        serde_json::to_vec(self).map_err(|e| encoding_error(&e))
    }
}

/// Typed failures from Backtest's internal Replay V2 composition boundary.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ReplayOwnerErrorV2 {
    #[error("Native Replay omitted required lifecycle event: {0}")]
    MissingLifecycle(&'static str),
    #[error("Native Replay produced no factual Sim Exchange fill")]
    MissingNativeFill,
    #[error("Native Replay omitted its Owner-admitted input cut")]
    MissingOwnerInputCut,
    #[error("Replay V2 observation census is incomplete")]
    IncompleteObservationCensus,
    #[error("Replay V2 observation component is duplicated: {0:?}")]
    DuplicateObservation(ObservationComponentV2),
    #[error("Replay V2 observation component and locator disagree")]
    ObservationLocatorMismatch,
    #[error("Replay V2 observation belongs to a different request")]
    ObservationRequestBindingMismatch,
    #[error("Replay V2 observation belongs to a different attempt")]
    ObservationAttemptBindingMismatch,
    #[error("Replay V2 diagnostic belongs to a different request")]
    DiagnosticRequestBindingMismatch,
    #[error("Replay V2 diagnostic belongs to a different attempt")]
    DiagnosticAttemptBindingMismatch,
    #[error("Replay V2 requested and consumed meaning differ for {0:?}")]
    ConsumptionMismatch(ObservationComponentV2),
    #[error("Replay V2 lineage or authority observation is missing: {0:?}")]
    IncompleteReplayAuthority(ObservationComponentV2),
    #[error("Replay V2 diagnostic census is empty")]
    EmptyDiagnosticCensus,
    #[error("Replay V2 diagnostic category is duplicated: {0:?}")]
    DuplicateDiagnostic(DiagnosticCategoryV2),
    #[error("Replay V2 diagnostic census has incompatible members")]
    IncompatibleDiagnosticCensus,
    #[error("Replay V2 non-terminal result cannot carry a diagnostic census")]
    NonTerminalDiagnosticCensus,
    #[error("Replay V2 canonical encoding unavailable: {0}")]
    CanonicalEncodingUnavailable(String),
}

struct OwnerResultDraftV2 {
    attempt_identity: OpaqueIdentityV2,
    terminal: ReplayTerminalV2,
    observations: Vec<ConsumedComponentObservationV2>,
    diagnostics: Vec<DiagnosticEvidenceV2>,
}

fn commit_owner_result(
    request: &ReplayRequestV2,
    draft: OwnerResultDraftV2,
) -> Result<SealedReplayResultV2, ReplayOwnerErrorV2> {
    let requested = requested_component_meanings(request)?;
    let request_meaning_digest = request.meaning_digest().map_err(|e| contract_error(&e))?;
    let mut observed = BTreeMap::new();

    for observation in draft.observations {
        if observation.request_identity != *request.request_identity()
            || observation.request_meaning_digest != request_meaning_digest
        {
            return Err(ReplayOwnerErrorV2::ObservationRequestBindingMismatch);
        }

        if observation.attempt_identity != draft.attempt_identity {
            return Err(ReplayOwnerErrorV2::ObservationAttemptBindingMismatch);
        }

        if observation.locator.component != observation.component {
            return Err(ReplayOwnerErrorV2::ObservationLocatorMismatch);
        }
        let component = observation.component;
        if observed.insert(component, observation).is_some() {
            return Err(ReplayOwnerErrorV2::DuplicateObservation(component));
        }
    }
    let mut reconciliation = Vec::with_capacity(requested.len());
    for (component, requested_meaning) in requested {
        match observed.remove(&component) {
            Some(observation) => {
                let status = if requested_meaning.identity == observation.observed_meaning_identity
                    && requested_meaning.digest == observation.observed_meaning_digest
                {
                    ReconciliationStatusV2::Exact
                } else {
                    ReconciliationStatusV2::Mismatched
                };
                reconciliation.push(ReconciliationAtomV2 {
                    component,
                    requested_meaning_identity: requested_meaning.identity,
                    requested_meaning_digest: requested_meaning.digest,
                    observed_meaning_identity: Some(observation.observed_meaning_identity),
                    observed_meaning_digest: Some(observation.observed_meaning_digest),
                    observation_locator: Some(observation.locator),
                    status,
                });
            }
            None => reconciliation.push(ReconciliationAtomV2 {
                component,
                requested_meaning_identity: requested_meaning.identity,
                requested_meaning_digest: requested_meaning.digest,
                observed_meaning_identity: None,
                observed_meaning_digest: None,
                observation_locator: None,
                status: ReconciliationStatusV2::Missing,
            }),
        }
    }
    let semantic_trace = observed.remove(&ObservationComponentV2::SemanticTrace);

    for component in [
        ObservationComponentV2::FrozenResearchIntent,
        ObservationComponentV2::TrialFamily,
        ObservationComponentV2::TrialFamilyCensusFrontier,
        ObservationComponentV2::ReplayAuthority,
    ] {
        let atom = reconciliation
            .iter()
            .find(|atom| atom.component == component)
            .ok_or(ReplayOwnerErrorV2::IncompleteReplayAuthority(component))?;

        match atom.status {
            ReconciliationStatusV2::Exact => {}
            ReconciliationStatusV2::Missing => {
                return Err(ReplayOwnerErrorV2::IncompleteReplayAuthority(component));
            }
            ReconciliationStatusV2::Mismatched => {
                return Err(ReplayOwnerErrorV2::ConsumptionMismatch(component));
            }
        }
    }

    if draft.terminal == ReplayTerminalV2::TerminalResult {
        if reconciliation
            .iter()
            .any(|atom| atom.status == ReconciliationStatusV2::Missing)
        {
            return Err(ReplayOwnerErrorV2::IncompleteObservationCensus);
        }

        if let Some(atom) = reconciliation
            .iter()
            .find(|atom| atom.status == ReconciliationStatusV2::Mismatched)
        {
            return Err(ReplayOwnerErrorV2::ConsumptionMismatch(atom.component));
        }

        if semantic_trace.is_none() {
            return Err(ReplayOwnerErrorV2::IncompleteObservationCensus);
        }
    }

    let diagnostic_census = validate_diagnostics(
        draft.terminal,
        request.request_identity(),
        &request_meaning_digest,
        &draft.attempt_identity,
        draft.diagnostics,
    )?;
    let provisional = ProvisionalResultV2 {
        schema_version: 2,
        request_identity: request.request_identity(),
        request_meaning_digest: &request_meaning_digest,
        namespace: request.namespace(),
        replay_authority: &request.as_dto().replay_authority,
        attempt_identity: &draft.attempt_identity,
        terminal: draft.terminal,
        reconciliation: &reconciliation,
        semantic_trace: semantic_trace.as_ref(),
        diagnostic_census: &diagnostic_census,
    };
    let result_digest = digest_serialized("vibe.backtest.replay-result.v2", &provisional)?;
    let result_identity = OpaqueIdentityV2::try_from(format!(
        "backtest-replay-result-v2-{}",
        result_digest.as_str().trim_start_matches("blake3:")
    ))
    .map_err(|e| contract_error(&e))?;

    Ok(SealedReplayResultV2 {
        schema_version: 2,
        result_identity,
        result_digest,
        request_identity: request.request_identity().clone(),
        request_meaning_digest,
        namespace: request.namespace(),
        replay_authority: request.as_dto().replay_authority.clone(),
        attempt_identity: draft.attempt_identity,
        terminal: draft.terminal,
        reconciliation,
        semantic_trace,
        diagnostic_census,
    })
}

#[derive(Serialize)]
struct ProvisionalResultV2<'a> {
    schema_version: u16,
    request_identity: &'a OpaqueIdentityV2,
    request_meaning_digest: &'a CanonicalDigestV2,
    namespace: ReplayNamespaceV2,
    replay_authority: &'a ReplayAuthorityClaimV2,
    attempt_identity: &'a OpaqueIdentityV2,
    terminal: ReplayTerminalV2,
    reconciliation: &'a [ReconciliationAtomV2],
    semantic_trace: Option<&'a ConsumedComponentObservationV2>,
    diagnostic_census: &'a DiagnosticCensusV2,
}

#[derive(Clone)]
struct ComponentMeaningV2 {
    identity: OpaqueIdentityV2,
    digest: CanonicalDigestV2,
}

fn requested_component_meanings(
    request: &ReplayRequestV2,
) -> Result<BTreeMap<ObservationComponentV2, ComponentMeaningV2>, ReplayOwnerErrorV2> {
    let dto = request.as_dto();
    let mut values = BTreeMap::new();
    insert_content(
        &mut values,
        ObservationComponentV2::FrozenResearchIntent,
        &dto.frozen_research_intent,
    );
    insert_content(
        &mut values,
        ObservationComponentV2::TrialFamily,
        &dto.trial_family,
    );
    insert_content(
        &mut values,
        ObservationComponentV2::TrialFamilyCensusFrontier,
        &dto.trial_family_census_frontier,
    );
    insert_serialized(
        &mut values,
        ObservationComponentV2::ReplayAuthority,
        &dto.replay_authority,
    )?;
    insert_content(
        &mut values,
        ObservationComponentV2::StrategyDesign,
        &dto.strategy_design,
    );
    insert_content(
        &mut values,
        ObservationComponentV2::StrategyPlan,
        &dto.strategy_plan,
    );
    insert_content(&mut values, ObservationComponentV2::Artifact, &dto.artifact);
    insert_content(
        &mut values,
        ObservationComponentV2::ResolvedOwnerInputs,
        &dto.resolved_owner_inputs,
    );
    insert_content(
        &mut values,
        ObservationComponentV2::PitScope,
        &dto.pit_scope,
    );
    insert_content(
        &mut values,
        ObservationComponentV2::PitSnapshot,
        &dto.pit_snapshot,
    );
    insert_content(
        &mut values,
        ObservationComponentV2::UniverseSelection,
        &dto.universe_selection,
    );
    insert_versioned(
        &mut values,
        ObservationComponentV2::CorrectionRule,
        &dto.correction_rule,
    )?;
    insert_versioned(
        &mut values,
        ObservationComponentV2::MarketSemantics,
        &dto.market_semantics,
    )?;
    insert_content(
        &mut values,
        ObservationComponentV2::ReplayConfiguration,
        &dto.replay_configuration,
    );
    insert_versioned(
        &mut values,
        ObservationComponentV2::RuntimeKernel,
        &dto.models.runtime_kernel,
    )?;
    insert_versioned(
        &mut values,
        ObservationComponentV2::Simulator,
        &dto.models.simulator,
    )?;
    insert_versioned(
        &mut values,
        ObservationComponentV2::CostModel,
        &dto.models.cost,
    )?;
    insert_versioned(
        &mut values,
        ObservationComponentV2::SlippageModel,
        &dto.models.slippage,
    )?;
    insert_versioned(
        &mut values,
        ObservationComponentV2::CapacityModel,
        &dto.models.capacity,
    )?;
    insert_versioned(
        &mut values,
        ObservationComponentV2::RunnerOperationalProfile,
        &dto.runner_operational_profile,
    )?;
    insert_versioned(
        &mut values,
        ObservationComponentV2::DiagnosticPolicy,
        &dto.diagnostic_policy,
    )?;
    insert_serialized(
        &mut values,
        ObservationComponentV2::DeterministicSeed,
        &dto.deterministic_seed,
    )?;
    insert_serialized(
        &mut values,
        ObservationComponentV2::ReplayWindow,
        &dto.window,
    )?;
    insert_versioned(&mut values, ObservationComponentV2::Calendar, &dto.calendar)?;
    insert_versioned(&mut values, ObservationComponentV2::Session, &dto.session)?;
    insert_versioned(
        &mut values,
        ObservationComponentV2::TimeZone,
        &dto.time_zone,
    )?;
    insert_content(
        &mut values,
        ObservationComponentV2::CorporateActionCut,
        &dto.corporate_action_cut,
    );
    insert_content(
        &mut values,
        ObservationComponentV2::HistoricalMembershipCut,
        &dto.historical_membership_cut,
    );
    Ok(values)
}

fn insert_content(
    values: &mut BTreeMap<ObservationComponentV2, ComponentMeaningV2>,
    component: ObservationComponentV2,
    value: &ContentIdentityV2,
) {
    values.insert(
        component,
        ComponentMeaningV2 {
            identity: value.identity.clone(),
            digest: value.digest.clone(),
        },
    );
}

fn insert_versioned(
    values: &mut BTreeMap<ObservationComponentV2, ComponentMeaningV2>,
    component: ObservationComponentV2,
    value: &VersionedIdentityV2,
) -> Result<(), ReplayOwnerErrorV2> {
    values.insert(
        component,
        ComponentMeaningV2 {
            identity: value.version.clone(),
            digest: digest_serialized("vibe.backtest.request-component.v2", value)?,
        },
    );
    Ok(())
}

fn insert_serialized<T: Serialize>(
    values: &mut BTreeMap<ObservationComponentV2, ComponentMeaningV2>,
    component: ObservationComponentV2,
    value: &T,
) -> Result<(), ReplayOwnerErrorV2> {
    let digest = digest_serialized("vibe.backtest.request-component.v2", value)?;
    let identity_digest = digest_serialized(
        "vibe.backtest.request-component-identity.v2",
        &(component, &digest),
    )?;
    let identity = OpaqueIdentityV2::try_from(format!(
        "backtest-request-component-v2-{}",
        identity_digest.as_str().trim_start_matches("blake3:")
    ))
    .map_err(|e| contract_error(&e))?;
    values.insert(component, ComponentMeaningV2 { identity, digest });
    Ok(())
}

fn validate_diagnostics(
    terminal: ReplayTerminalV2,
    request_identity: &OpaqueIdentityV2,
    request_meaning_digest: &CanonicalDigestV2,
    attempt_identity: &OpaqueIdentityV2,
    mut diagnostics: Vec<DiagnosticEvidenceV2>,
) -> Result<DiagnosticCensusV2, ReplayOwnerErrorV2> {
    if terminal == ReplayTerminalV2::InProgressOrUnknown {
        return if diagnostics.is_empty() {
            Ok(DiagnosticCensusV2(diagnostics))
        } else {
            Err(ReplayOwnerErrorV2::NonTerminalDiagnosticCensus)
        };
    }

    if diagnostics.is_empty() {
        return Err(ReplayOwnerErrorV2::EmptyDiagnosticCensus);
    }

    if diagnostics.iter().any(|diagnostic| {
        diagnostic.request_identity != *request_identity
            || diagnostic.request_meaning_digest != *request_meaning_digest
    }) {
        return Err(ReplayOwnerErrorV2::DiagnosticRequestBindingMismatch);
    }

    if diagnostics
        .iter()
        .any(|diagnostic| diagnostic.attempt_identity != *attempt_identity)
    {
        return Err(ReplayOwnerErrorV2::DiagnosticAttemptBindingMismatch);
    }
    diagnostics.sort_by_key(DiagnosticEvidenceV2::category);
    for pair in diagnostics.windows(2) {
        if pair[0].category == pair[1].category {
            return Err(ReplayOwnerErrorV2::DuplicateDiagnostic(pair[0].category));
        }
    }
    let has_no_defect = diagnostics
        .iter()
        .any(|value| value.category == DiagnosticCategoryV2::NoExecutionDefect);
    let has_unresolved = diagnostics
        .iter()
        .any(|value| value.category == DiagnosticCategoryV2::UnresolvedFailure);
    if (has_no_defect && diagnostics.len() != 1) || (has_unresolved && diagnostics.len() != 1) {
        return Err(ReplayOwnerErrorV2::IncompatibleDiagnosticCensus);
    }
    Ok(DiagnosticCensusV2(diagnostics))
}

fn digest_serialized<T: Serialize>(
    domain: &str,
    value: &T,
) -> Result<CanonicalDigestV2, ReplayOwnerErrorV2> {
    let bytes = serde_json::to_vec(value).map_err(|e| encoding_error(&e))?;
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain.as_bytes());
    hasher.update(b"\0");
    hasher.update(&bytes);
    CanonicalDigestV2::try_from(format!("blake3:{}", hasher.finalize().to_hex()))
        .map_err(|e| contract_error(&e))
}

fn contract_error(error: &impl Display) -> ReplayOwnerErrorV2 {
    ReplayOwnerErrorV2::CanonicalEncodingUnavailable(error.to_string())
}

fn encoding_error(error: &serde_json::Error) -> ReplayOwnerErrorV2 {
    ReplayOwnerErrorV2::CanonicalEncodingUnavailable(error.to_string())
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;
    use vibe_backtest_owner_contracts::{
        ContentIdentityV2, ReplayModelProfilesV2, ReplayWindowV2, VersionedIdentityV2,
    };

    fn identity(value: &str) -> OpaqueIdentityV2 {
        OpaqueIdentityV2::try_from(value.to_string()).expect("fixture identity must be valid")
    }

    fn digest(byte: char) -> CanonicalDigestV2 {
        CanonicalDigestV2::try_from(format!("sha256:{}", byte.to_string().repeat(64)))
            .expect("fixture digest must be valid")
    }

    fn content(name: &str, byte: char) -> ContentIdentityV2 {
        ContentIdentityV2 {
            identity: identity(name),
            digest: digest(byte),
        }
    }

    fn version(name: &str) -> VersionedIdentityV2 {
        VersionedIdentityV2 {
            identity: identity(name),
            version: identity("v2"),
        }
    }

    fn request() -> ReplayRequestV2 {
        ReplayRequestV2::try_from(ReplayRequestDtoV2 {
            schema_version: 2,
            request_identity: identity("request"),
            frozen_research_intent: content("frozen-research-intent", 'b'),
            trial_family: content("trial-family", 'c'),
            trial_family_census_frontier: content("trial-family-census-frontier", 'd'),
            replay_authority: ReplayAuthorityClaimV2::Exploratory,
            strategy_design: content("design", '1'),
            strategy_plan: content("plan", '2'),
            artifact: content("artifact", '3'),
            resolved_owner_inputs: content("owner-inputs", '4'),
            pit_scope: content("pit-scope", '5'),
            pit_snapshot: content("pit-snapshot", '6'),
            universe_selection: content("universe", '7'),
            correction_rule: version("correction"),
            market_semantics: version("market-semantics"),
            replay_configuration: content("replay-config", '8'),
            models: ReplayModelProfilesV2 {
                runtime_kernel: version("runtime-kernel"),
                simulator: version("simulator"),
                cost: version("cost"),
                slippage: version("slippage"),
                capacity: version("capacity"),
            },
            runner_operational_profile: version("operational-profile"),
            diagnostic_policy: version("diagnostic-policy"),
            deterministic_seed: 7,
            window: ReplayWindowV2 {
                start_event_ns: 1,
                end_event_ns_exclusive: 2,
            },
            calendar: version("calendar"),
            session: version("session"),
            time_zone: version("time-zone"),
            corporate_action_cut: content("corporate-actions", '9'),
            historical_membership_cut: content("membership", 'a'),
        })
        .expect("fixture request must be valid")
    }

    fn locator(component: ObservationComponentV2, byte: char) -> ComponentObservationLocatorV2 {
        ComponentObservationLocatorV2 {
            component,
            reference: identity(&format!("observation-{component:?}")),
            digest: digest(byte),
        }
    }

    fn observations(request: &ReplayRequestV2) -> Vec<ConsumedComponentObservationV2> {
        let request_meaning_digest = request
            .meaning_digest()
            .expect("fixture request must have canonical meaning");
        let attempt_identity = identity("attempt");
        let mut observations: Vec<_> = requested_component_meanings(request)
            .expect("fixture request components must hash")
            .into_iter()
            .map(
                |(component, observed_meaning)| ConsumedComponentObservationV2 {
                    request_identity: request.request_identity().clone(),
                    request_meaning_digest: request_meaning_digest.clone(),
                    attempt_identity: attempt_identity.clone(),
                    component,
                    locator: locator(component, 'b'),
                    observed_meaning_identity: observed_meaning.identity,
                    observed_meaning_digest: observed_meaning.digest,
                },
            )
            .collect();
        observations.push(ConsumedComponentObservationV2 {
            request_identity: request.request_identity().clone(),
            request_meaning_digest,
            attempt_identity,
            component: ObservationComponentV2::SemanticTrace,
            locator: locator(ObservationComponentV2::SemanticTrace, 'b'),
            observed_meaning_identity: identity("semantic-trace"),
            observed_meaning_digest: digest('c'),
        });
        observations
    }

    fn diagnostic(
        request: &ReplayRequestV2,
        category: DiagnosticCategoryV2,
        component: ObservationComponentV2,
        byte: char,
    ) -> DiagnosticEvidenceV2 {
        DiagnosticEvidenceV2 {
            request_identity: request.request_identity().clone(),
            request_meaning_digest: request
                .meaning_digest()
                .expect("fixture request must have canonical meaning"),
            attempt_identity: identity("attempt"),
            category,
            decisive_evidence: locator(component, byte),
        }
    }

    fn diagnostics(request: &ReplayRequestV2) -> Vec<DiagnosticEvidenceV2> {
        vec![DiagnosticEvidenceV2 {
            request_identity: request.request_identity().clone(),
            request_meaning_digest: request
                .meaning_digest()
                .expect("fixture request must have canonical meaning"),
            attempt_identity: identity("attempt"),
            category: DiagnosticCategoryV2::NoExecutionDefect,
            decisive_evidence: locator(ObservationComponentV2::SemanticTrace, 'c'),
        }]
    }

    fn draft(request: &ReplayRequestV2) -> OwnerResultDraftV2 {
        OwnerResultDraftV2 {
            attempt_identity: identity("attempt"),
            terminal: ReplayTerminalV2::TerminalResult,
            observations: observations(request),
            diagnostics: diagnostics(request),
        }
    }

    #[rstest]
    fn canonical_owner_result_is_stable_and_complete() {
        let request = request();
        let first = commit_owner_result(&request, draft(&request))
            .expect("complete owner observations must commit");
        let second = commit_owner_result(&request, draft(&request))
            .expect("identical owner observations must commit");
        assert_eq!(
            first.to_canonical_bytes().expect("result must encode"),
            second.to_canonical_bytes().expect("result must encode")
        );
        assert_eq!(first.namespace(), ReplayNamespaceV2::Exploratory);
        assert_eq!(first.reconciliation().len(), 28);
        assert!(first.semantic_trace().is_some());
        assert_eq!(first.diagnostic_census().as_slice().len(), 1);
    }

    #[rstest]
    fn every_component_mutation_fails_reconciliation() {
        let request = request();
        for index in 0..ObservationComponentV2::REQUESTED_MEANING.len() {
            let mut changed = draft(&request);
            changed.observations[index].observed_meaning_digest = digest('f');
            assert!(matches!(
                commit_owner_result(&request, changed),
                Err(ReplayOwnerErrorV2::ConsumptionMismatch(_))
            ));
        }
    }

    #[rstest]
    fn every_consumed_identity_substitution_fails_reconciliation() {
        let request = request();
        for index in 0..ObservationComponentV2::REQUESTED_MEANING.len() {
            let mut changed = draft(&request);
            changed.observations[index].observed_meaning_identity =
                identity(&format!("substituted-identity-{index}"));
            assert!(matches!(
                commit_owner_result(&request, changed),
                Err(ReplayOwnerErrorV2::ConsumptionMismatch(_))
            ));
        }
    }

    #[rstest]
    fn semantic_trace_is_observed_output_not_caller_requested_meaning() {
        let request = request();
        let baseline = commit_owner_result(&request, draft(&request))
            .expect("baseline owner result must commit");
        let mut changed = draft(&request);
        let semantic_trace = changed
            .observations
            .iter_mut()
            .find(|value| value.component == ObservationComponentV2::SemanticTrace)
            .expect("fixture must contain semantic trace");
        semantic_trace.observed_meaning_digest = digest('f');
        let changed = commit_owner_result(&request, changed)
            .expect("a different observed trace remains owner-produced evidence");
        assert_ne!(baseline.result_digest(), changed.result_digest());
    }

    #[rstest]
    fn incomplete_duplicate_and_locator_mismatched_observations_fail_closed() {
        let request = request();

        let mut incomplete = draft(&request);
        incomplete.observations.pop();
        assert_eq!(
            commit_owner_result(&request, incomplete)
                .expect_err("terminal result must be complete"),
            ReplayOwnerErrorV2::IncompleteObservationCensus
        );

        let mut duplicate = draft(&request);
        let component = duplicate.observations[0].component;
        duplicate.observations.push(ConsumedComponentObservationV2 {
            request_identity: duplicate.observations[0].request_identity.clone(),
            request_meaning_digest: duplicate.observations[0].request_meaning_digest.clone(),
            attempt_identity: duplicate.observations[0].attempt_identity.clone(),
            component,
            locator: locator(component, 'd'),
            observed_meaning_identity: duplicate.observations[0].observed_meaning_identity.clone(),
            observed_meaning_digest: duplicate.observations[0].observed_meaning_digest.clone(),
        });
        assert_eq!(
            commit_owner_result(&request, duplicate).expect_err("duplicate must fail"),
            ReplayOwnerErrorV2::DuplicateObservation(component)
        );

        let mut mismatched = draft(&request);
        mismatched.observations[0].locator.component = ObservationComponentV2::SemanticTrace;
        assert_eq!(
            commit_owner_result(&request, mismatched).expect_err("locator mismatch must fail"),
            ReplayOwnerErrorV2::ObservationLocatorMismatch
        );
    }

    #[rstest]
    fn invalid_evidence_preserves_complete_reconciliation_with_missing_atoms() {
        let request = request();
        let mut invalid = draft(&request);
        invalid.terminal = ReplayTerminalV2::InvalidReplayEvidence;
        invalid
            .observations
            .retain(|observation| observation.component != ObservationComponentV2::Artifact);

        let result = commit_owner_result(&request, invalid)
            .expect("a negative result must preserve rather than erase missing consumption");
        assert_eq!(result.reconciliation().len(), 28);
        assert_eq!(
            result
                .reconciliation()
                .iter()
                .filter(|atom| atom.status() == ReconciliationStatusV2::Missing)
                .count(),
            1
        );
    }

    #[rstest]
    fn diagnostic_census_preserves_supported_defects_and_rejects_ambiguity() {
        let request = request();
        let mut simultaneous = draft(&request);
        simultaneous.diagnostics = vec![
            diagnostic(
                &request,
                DiagnosticCategoryV2::MarketData,
                ObservationComponentV2::PitSnapshot,
                'd',
            ),
            diagnostic(
                &request,
                DiagnosticCategoryV2::Simulator,
                ObservationComponentV2::Simulator,
                'e',
            ),
        ];
        let result = commit_owner_result(&request, simultaneous)
            .expect("simultaneous supported defects must be preserved");
        assert_eq!(result.diagnostic_census().as_slice().len(), 2);

        let mut contradictory = draft(&request);
        contradictory.diagnostics.push(diagnostic(
            &request,
            DiagnosticCategoryV2::Simulator,
            ObservationComponentV2::Simulator,
            'e',
        ));
        assert_eq!(
            commit_owner_result(&request, contradictory)
                .expect_err("contradictory diagnostics must fail"),
            ReplayOwnerErrorV2::IncompatibleDiagnosticCensus
        );

        let mut duplicate = draft(&request);
        duplicate.diagnostics.push(diagnostic(
            &request,
            DiagnosticCategoryV2::NoExecutionDefect,
            ObservationComponentV2::SemanticTrace,
            'f',
        ));
        assert_eq!(
            commit_owner_result(&request, duplicate)
                .expect_err("duplicate diagnostic categories must fail"),
            ReplayOwnerErrorV2::DuplicateDiagnostic(DiagnosticCategoryV2::NoExecutionDefect)
        );

        let mut unresolved_with_peer = draft(&request);
        unresolved_with_peer.diagnostics = vec![
            diagnostic(
                &request,
                DiagnosticCategoryV2::UnresolvedFailure,
                ObservationComponentV2::SemanticTrace,
                'd',
            ),
            diagnostic(
                &request,
                DiagnosticCategoryV2::ValidEconomicFailure,
                ObservationComponentV2::SemanticTrace,
                'e',
            ),
        ];
        assert_eq!(
            commit_owner_result(&request, unresolved_with_peer)
                .expect_err("unresolved must remain singleton"),
            ReplayOwnerErrorV2::IncompatibleDiagnosticCensus
        );
    }

    #[rstest]
    fn exploratory_and_protected_authority_are_not_interchangeable() {
        let exploratory = request();
        let mut protected_dto = exploratory.as_dto().clone();
        protected_dto.request_identity = identity("protected-request");
        protected_dto.replay_authority = ReplayAuthorityClaimV2::Protected {
            qualification_candidate_intake: content("candidate-intake", 'e'),
            holdout_reservation: content("holdout-reservation", 'f'),
            protected_replay_plan: content("protected-plan", '0'),
            protected_plan_cell: content("protected-plan-cell", '1'),
        };
        let protected = ReplayRequestV2::try_from(protected_dto)
            .expect("protected fixture request must be valid");

        let protected_result = commit_owner_result(&protected, draft(&protected))
            .expect("exact owner-observed protected authority must commit");
        assert_eq!(protected_result.namespace(), ReplayNamespaceV2::Protected);

        assert_eq!(
            commit_owner_result(&exploratory, draft(&protected))
                .expect_err("protected observations cannot authorize exploratory replay"),
            ReplayOwnerErrorV2::ObservationRequestBindingMismatch
        );
        let exploratory_result = commit_owner_result(&exploratory, draft(&exploratory))
            .expect("exploratory authority must commit without holdout evidence");
        let encoded = String::from_utf8(
            exploratory_result
                .to_canonical_bytes()
                .expect("exploratory result must encode"),
        )
        .expect("canonical JSON is UTF-8");
        assert!(!encoded.contains("holdout_reservation"));
    }

    #[rstest]
    fn every_result_requires_owner_observed_lineage_and_authority() {
        let request = request();

        for component in [
            ObservationComponentV2::FrozenResearchIntent,
            ObservationComponentV2::TrialFamily,
            ObservationComponentV2::TrialFamilyCensusFrontier,
            ObservationComponentV2::ReplayAuthority,
        ] {
            let mut changed = draft(&request);
            changed.terminal = ReplayTerminalV2::InvalidReplayEvidence;
            changed
                .observations
                .retain(|observation| observation.component != component);
            assert_eq!(
                commit_owner_result(&request, changed)
                    .expect_err("result authority must never be inferred from caller claims"),
                ReplayOwnerErrorV2::IncompleteReplayAuthority(component)
            );
        }
    }

    #[rstest]
    fn observations_cannot_be_replayed_across_request_or_attempt_identity() {
        let request_a = request();
        let mut request_b_dto = request_a.as_dto().clone();
        request_b_dto.request_identity = identity("request-b");
        let request_b = ReplayRequestV2::try_from(request_b_dto).expect("request B must validate");

        assert_eq!(
            commit_owner_result(&request_b, draft(&request_a))
                .expect_err("request A observations must not authorize request B"),
            ReplayOwnerErrorV2::ObservationRequestBindingMismatch
        );

        let mut different_attempt = draft(&request_a);
        different_attempt.attempt_identity = identity("attempt-b");
        assert_eq!(
            commit_owner_result(&request_a, different_attempt)
                .expect_err("observations from one attempt must not authorize another attempt"),
            ReplayOwnerErrorV2::ObservationAttemptBindingMismatch
        );

        let mut substituted_request_identity = draft(&request_a);
        substituted_request_identity.observations[0].request_identity = identity("request-b");
        assert_eq!(
            commit_owner_result(&request_a, substituted_request_identity)
                .expect_err("an observation request identity cannot be substituted"),
            ReplayOwnerErrorV2::ObservationRequestBindingMismatch
        );

        let mut substituted_request_digest = draft(&request_a);
        substituted_request_digest.observations[0].request_meaning_digest = digest('f');
        assert_eq!(
            commit_owner_result(&request_a, substituted_request_digest)
                .expect_err("an observation request digest cannot be substituted"),
            ReplayOwnerErrorV2::ObservationRequestBindingMismatch
        );

        let mut substituted_attempt_identity = draft(&request_a);
        substituted_attempt_identity.observations[0].attempt_identity = identity("attempt-b");
        assert_eq!(
            commit_owner_result(&request_a, substituted_attempt_identity)
                .expect_err("an observation attempt identity cannot be substituted"),
            ReplayOwnerErrorV2::ObservationAttemptBindingMismatch
        );
    }

    #[rstest]
    fn diagnostics_cannot_be_replayed_across_request_or_attempt_identity() {
        let request_a = request();
        let mut request_b_dto = request_a.as_dto().clone();
        request_b_dto.request_identity = identity("request-b");
        let request_b = ReplayRequestV2::try_from(request_b_dto).expect("request B must validate");

        let stale_request_diagnostics = draft(&request_a).diagnostics;
        let mut request_b_draft = draft(&request_b);
        request_b_draft.diagnostics = stale_request_diagnostics;
        assert_eq!(
            commit_owner_result(&request_b, request_b_draft)
                .expect_err("request A diagnostics must not authorize request B"),
            ReplayOwnerErrorV2::DiagnosticRequestBindingMismatch
        );

        let stale_attempt_diagnostics = draft(&request_a).diagnostics;
        let mut attempt_b_draft = draft(&request_a);
        attempt_b_draft.attempt_identity = identity("attempt-b");
        for observation in &mut attempt_b_draft.observations {
            observation.attempt_identity = identity("attempt-b");
        }
        attempt_b_draft.diagnostics = stale_attempt_diagnostics;
        assert_eq!(
            commit_owner_result(&request_a, attempt_b_draft)
                .expect_err("attempt A diagnostics must not authorize attempt B"),
            ReplayOwnerErrorV2::DiagnosticAttemptBindingMismatch
        );

        let mut substituted_request_identity = draft(&request_a);
        substituted_request_identity.diagnostics[0].request_identity = identity("request-b");
        assert_eq!(
            commit_owner_result(&request_a, substituted_request_identity)
                .expect_err("a diagnostic request identity cannot be substituted"),
            ReplayOwnerErrorV2::DiagnosticRequestBindingMismatch
        );

        let mut substituted_request_digest = draft(&request_a);
        substituted_request_digest.diagnostics[0].request_meaning_digest = digest('f');
        assert_eq!(
            commit_owner_result(&request_a, substituted_request_digest)
                .expect_err("a diagnostic request digest cannot be substituted"),
            ReplayOwnerErrorV2::DiagnosticRequestBindingMismatch
        );

        let mut substituted_attempt_identity = draft(&request_a);
        substituted_attempt_identity.diagnostics[0].attempt_identity = identity("attempt-b");
        assert_eq!(
            commit_owner_result(&request_a, substituted_attempt_identity)
                .expect_err("a diagnostic attempt identity cannot be substituted"),
            ReplayOwnerErrorV2::DiagnosticAttemptBindingMismatch
        );
    }
}
