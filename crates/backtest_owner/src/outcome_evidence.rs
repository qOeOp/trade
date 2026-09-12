//! Backtest-owned sealing of raw evidence from one actual native replay outcome.

use thiserror::Error;
use vibe_backtest_owner_contracts::{
    BacktestOutcomeEvidenceBindingsV1, BacktestOutcomeEvidenceDtoV1,
    BacktestOutcomeEvidenceErrorV1, CanonicalDigestV2, CanonicalResultBindingDtoV1,
    ContentIdentityV2, ObservationComponentV2, OpaqueIdentityV2,
};
use vibe_strategy_factory::program_host_sim_event_consumer_v1::ProgramHostSimEventReadbackV1;

use crate::{
    ReconciliationStatusV2, ReplayConsumptionObservationV2, SealedReplayResultV2,
    native_replay::SealedNativeReplaySemanticTraceV2,
};

const CANONICAL_RESULT_SCHEMA_V1: &str = "vibe-backtest-result/v1";
const CANONICAL_RESULT_BYTES_DOMAIN_V1: &[u8] = b"vibe.backtest.canonical-result-bytes.v1\0";

/// Owner-sealed outcome evidence and the exact engine result bytes it binds.
///
/// This type has no public constructor, no deserializer, and no clone implementation. It can only
/// be created from the actual EVENT readback and the exact sealed Replay Result of the same run.
pub struct SealedBacktestOutcomeEvidenceV1 {
    evidence: BacktestOutcomeEvidenceDtoV1,
    evidence_canonical_bytes: Vec<u8>,
    canonical_result_bytes: Vec<u8>,
}

impl SealedBacktestOutcomeEvidenceV1 {
    pub(crate) fn seal(
        result: &SealedReplayResultV2,
        execution: &ProgramHostSimEventReadbackV1,
        semantic_trace: &SealedNativeReplaySemanticTraceV2,
    ) -> Result<Self, BacktestOutcomeEvidenceOwnerErrorV1> {
        if !execution.canonical_result_is_exact()
            || result.semantic_trace().map(|value| value.locator())
                != Some(semantic_trace.locator())
        {
            return Err(BacktestOutcomeEvidenceOwnerErrorV1::CrossSplicedRun);
        }
        let frozen_research_intent =
            exact_result_binding(result, ObservationComponentV2::FrozenResearchIntent)?;
        let trial_family_census_frontier =
            exact_result_binding(result, ObservationComponentV2::TrialFamilyCensusFrontier)?;
        let canonical_result_bytes = execution.canonical_result().to_vec();
        let canonical_bytes_digest = canonical_result_bytes_digest(&canonical_result_bytes)?;
        let canonical_bytes_length = u64::try_from(canonical_result_bytes.len())
            .map_err(|_| BacktestOutcomeEvidenceOwnerErrorV1::CanonicalResultUnavailable)?;
        let evidence =
            BacktestOutcomeEvidenceDtoV1::from_bindings(BacktestOutcomeEvidenceBindingsV1 {
                result_identity: result.result_identity().clone(),
                result_digest: result.result_digest().clone(),
                request_identity: result.request_identity().clone(),
                request_meaning_digest: result.request_meaning_digest().clone(),
                attempt_identity: result.attempt_identity().clone(),
                frozen_research_intent,
                trial_family_census_frontier,
                semantic_trace: semantic_trace.locator().clone(),
                canonical_result: CanonicalResultBindingDtoV1 {
                    schema_identity: OpaqueIdentityV2::try_from(
                        CANONICAL_RESULT_SCHEMA_V1.to_owned(),
                    )?,
                    canonical_bytes_digest,
                    canonical_bytes_length,
                },
            })?;
        let evidence_canonical_bytes = evidence.to_canonical_bytes()?;
        Ok(Self {
            evidence,
            evidence_canonical_bytes,
            canonical_result_bytes,
        })
    }

    #[must_use]
    pub fn evidence(&self) -> &BacktestOutcomeEvidenceDtoV1 {
        &self.evidence
    }

    #[must_use]
    pub fn evidence_canonical_bytes(&self) -> &[u8] {
        &self.evidence_canonical_bytes
    }

    #[must_use]
    pub fn canonical_result_bytes(&self) -> &[u8] {
        &self.canonical_result_bytes
    }
}

fn exact_result_binding(
    result: &SealedReplayResultV2,
    component: ObservationComponentV2,
) -> Result<ContentIdentityV2, BacktestOutcomeEvidenceOwnerErrorV1> {
    let mut matches = result
        .reconciliation()
        .iter()
        .filter(|atom| atom.component() == component);
    let atom = matches
        .next()
        .ok_or(BacktestOutcomeEvidenceOwnerErrorV1::MissingResultBinding(
            component,
        ))?;
    if matches.next().is_some()
        || atom.status() != ReconciliationStatusV2::Exact
        || atom.observed_meaning_identity() != Some(atom.requested_meaning_identity())
        || atom.observed_meaning_digest() != Some(atom.requested_meaning_digest())
    {
        return Err(BacktestOutcomeEvidenceOwnerErrorV1::MissingResultBinding(
            component,
        ));
    }
    Ok(ContentIdentityV2 {
        identity: atom.requested_meaning_identity().clone(),
        digest: atom.requested_meaning_digest().clone(),
    })
}

fn canonical_result_bytes_digest(
    bytes: &[u8],
) -> Result<CanonicalDigestV2, BacktestOutcomeEvidenceOwnerErrorV1> {
    if bytes.is_empty() {
        return Err(BacktestOutcomeEvidenceOwnerErrorV1::CanonicalResultUnavailable);
    }
    let mut hasher = blake3::Hasher::new();
    hasher.update(CANONICAL_RESULT_BYTES_DOMAIN_V1);
    hasher.update(bytes);
    CanonicalDigestV2::try_from(format!("blake3:{}", hasher.finalize().to_hex()))
        .map_err(Into::into)
}

/// Fail-closed errors while Backtest creates authoritative outcome evidence.
#[derive(Debug, Error)]
pub enum BacktestOutcomeEvidenceOwnerErrorV1 {
    #[error("native Replay outcome evidence is cross-spliced")]
    CrossSplicedRun,
    #[error("native Replay outcome evidence is missing exact component {0:?}")]
    MissingResultBinding(ObservationComponentV2),
    #[error("canonical Backtest result evidence is unavailable")]
    CanonicalResultUnavailable,
    #[error(transparent)]
    Contract(#[from] BacktestOutcomeEvidenceErrorV1),
    #[error(transparent)]
    ReplayContract(#[from] vibe_backtest_owner_contracts::ReplayContractErrorV2),
}
