//! Effect-free R&D request for Market Data repair.

use serde::Serialize;
use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_backtest_owner_contracts::{
    DiagnosticCategoryV2, ObservationComponentV2, ReplayRequestV2, ReplayResultDtoV2,
};
use vibe_data::owner::{
    native_replay_scheduling_v1::MarketDataRepairSourceV1,
    pit_snapshot::UntrustedPitSnapshotTimeEvidence, shared_time_evidence::ClockHeadHandoff,
    source_binding::BindingDigest,
};

use crate::{
    iteration_decision::{
        IterationDecisionEvidenceCutV1, IterationDecisionOutcomeV1, IterationRepairCategoryV1,
        IterationRepairTargetV1, RepairInputIterationDecisionReadbackV1,
    },
    repair_action::RepairActionRequestReadbackV1,
};

/// A committed R&D request to repair the exact evidence that failed an exploratory replay.
///
/// This value contains no transport or Market Data mutation capability and cannot be deserialized
/// into positive custody.
#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MarketDataRepairRequestV1 {
    schema_version: u16,
    request_identity: String,
    request_digest: String,
    correlation_identity: BindingDigest,
    action_request_identity: String,
    action_request_digest: String,
    decision_identity: String,
    decision_digest: String,
    decision_evidence_cut: IterationDecisionEvidenceCutV1,
    replay_request_identity: String,
    replay_request_digest: String,
    result_identity: String,
    result_digest: String,
    attempt_identity: String,
    category: IterationRepairCategoryV1,
    target: IterationRepairTargetV1,
    bounded_reason: MarketDataRepairReasonV1,
    decisive_evidence_component: ObservationComponentV2,
    decisive_evidence_reference: String,
    decisive_evidence_digest: String,
    original_pit_request_identity: BindingDigest,
    original_pit_request_digest: BindingDigest,
    original_pit_snapshot_identity: BindingDigest,
    original_pit_proof_digest: BindingDigest,
    instrument_scope_identity: String,
    instrument_scope_digest: BindingDigest,
    universe_selection_identity: String,
    universe_selection_digest: BindingDigest,
    instrument_master_digest: BindingDigest,
    provenance_binding_identity: BindingDigest,
    provenance_binding_fact_digest: BindingDigest,
    provenance_lineage_root: BindingDigest,
    provenance_lineage_version: u64,
    source_frontier_digest: BindingDigest,
    correction_frontier_digest: BindingDigest,
    market_semantics_identity: BindingDigest,
    original_time_evidence: UntrustedPitSnapshotTimeEvidence,
    shared_time_evidence: ClockHeadHandoff,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MarketDataRepairRequestReceiptV1 {
    schema_version: u16,
    receipt_identity: String,
    receipt_digest: String,
    request_identity: String,
    request_digest: String,
    action_request_identity: String,
    decision_identity: String,
    committed_at_epoch_ms: u64,
}

/// Move-only positive R&D custody for one Market Data repair request.
#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MarketDataRepairRequestReadbackV1 {
    request: MarketDataRepairRequestV1,
    receipt: MarketDataRepairRequestReceiptV1,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MarketDataRepairReasonV1 {
    BacktestDiagnosticMarketData,
}

#[derive(Debug, Error)]
pub enum MarketDataRepairRequestErrorV1 {
    #[error("repair action is not category-exact for Market Data")]
    WrongRepairTarget,
    #[error("repair action, Decision, Replay Request, and Result custody do not match")]
    CustodyMismatch,
    #[error("the locked Result does not contain exactly one matching Market Data defect proof")]
    DefectProofUnavailable,
    #[error("the Market Data Owner source does not match the sealed Replay Request")]
    MarketDataSourceMismatch,
    #[error("fresh shared Time Evidence is unavailable")]
    TimeEvidenceUnavailable,
    #[error("repair request encoding is unavailable: {0}")]
    Encoding(String),
}

impl MarketDataRepairRequestV1 {
    pub fn request_identity(&self) -> &str {
        &self.request_identity
    }

    pub fn request_digest(&self) -> &str {
        &self.request_digest
    }

    pub const fn correlation_identity(&self) -> BindingDigest {
        self.correlation_identity
    }

    pub fn action_request_identity(&self) -> &str {
        &self.action_request_identity
    }

    pub fn decision_identity(&self) -> &str {
        &self.decision_identity
    }

    pub fn result_identity(&self) -> &str {
        &self.result_identity
    }

    pub const fn category(&self) -> IterationRepairCategoryV1 {
        self.category
    }

    pub const fn target(&self) -> IterationRepairTargetV1 {
        self.target
    }

    pub fn to_canonical_bytes(&self) -> Result<Vec<u8>, MarketDataRepairRequestErrorV1> {
        serde_json::to_vec(self).map_err(encoding)
    }
}

impl MarketDataRepairRequestReceiptV1 {
    pub fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }

    pub fn receipt_digest(&self) -> &str {
        &self.receipt_digest
    }

    pub const fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
}

impl MarketDataRepairRequestReadbackV1 {
    pub const fn request(&self) -> &MarketDataRepairRequestV1 {
        &self.request
    }

    pub const fn receipt(&self) -> &MarketDataRepairRequestReceiptV1 {
        &self.receipt
    }
}

pub(crate) fn issue_market_data_repair_request_v1(
    action: &RepairActionRequestReadbackV1,
    decision: &RepairInputIterationDecisionReadbackV1,
    replay: &ReplayRequestV2,
    result: &ReplayResultDtoV2,
    source: MarketDataRepairSourceV1,
    shared_time_evidence: ClockHeadHandoff,
    committed_at_epoch_ms: u64,
) -> Result<MarketDataRepairRequestReadbackV1, MarketDataRepairRequestErrorV1> {
    let action = action.request();
    let decision_fact = decision.decision();
    if action.category() != IterationRepairCategoryV1::MarketData
        || action.target() != IterationRepairTargetV1::MarketData
        || !matches!(
            decision_fact.outcome(),
            IterationDecisionOutcomeV1::RepairInputs {
                category: IterationRepairCategoryV1::MarketData,
                target: IterationRepairTargetV1::MarketData,
            }
        )
    {
        return Err(MarketDataRepairRequestErrorV1::WrongRepairTarget);
    }

    let replay_dto = replay.as_dto();
    let replay_digest = replay.meaning_digest().map_err(encoding)?;
    let evidence_cut = decision_fact.evidence_cut();
    if action.decision_identity() != decision_fact.decision_identity()
        || action.decision_digest() != decision_fact.decision_digest()
        || action.result_identity() != result.result_identity.as_str()
        || decision.receipt().result_identity() != result.result_identity.as_str()
        || evidence_cut.request_identity != replay_dto.request_identity.as_str()
        || evidence_cut.request_digest != replay_digest.as_str()
        || evidence_cut.result_identity != result.result_identity.as_str()
        || evidence_cut.result_digest != result.result_digest.as_str()
        || evidence_cut.attempt_identity != result.attempt_identity.as_str()
        || result.request_identity != replay_dto.request_identity
        || result.request_meaning_digest != replay_digest
    {
        return Err(MarketDataRepairRequestErrorV1::CustodyMismatch);
    }

    let mut defects = result.diagnostic_census.iter().filter(|diagnostic| {
        diagnostic.category == DiagnosticCategoryV2::MarketData
            && diagnostic.request_identity == result.request_identity
            && diagnostic.request_meaning_digest == result.request_meaning_digest
            && diagnostic.attempt_identity == result.attempt_identity
    });
    let defect = defects
        .next()
        .ok_or(MarketDataRepairRequestErrorV1::DefectProofUnavailable)?;
    if defects.next().is_some() {
        return Err(MarketDataRepairRequestErrorV1::DefectProofUnavailable);
    }

    let pit_scope_digest = parse_sha256(replay_dto.pit_scope.digest.as_str())?;
    let pit_snapshot_identity = parse_sha256(replay_dto.pit_snapshot.identity.as_str())?;
    let pit_snapshot_digest = parse_sha256(replay_dto.pit_snapshot.digest.as_str())?;
    let universe_selection_digest = parse_sha256(replay_dto.universe_selection.digest.as_str())?;
    let market_semantics_identity = parse_sha256(replay_dto.market_semantics.identity.as_str())?;
    if source.instrument_scope_digest().as_bytes() != &pit_scope_digest
        || source.pit_snapshot_identity().as_bytes() != &pit_snapshot_identity
        || source.pit_snapshot_fact_digest().as_bytes() != &pit_snapshot_digest
        || source.universe_selection_digest().as_bytes() != &universe_selection_digest
        || source.market_semantics_identity().as_bytes() != &market_semantics_identity
    {
        return Err(MarketDataRepairRequestErrorV1::MarketDataSourceMismatch);
    }
    validate_time(
        source.time_evidence(),
        &shared_time_evidence,
        committed_at_epoch_ms,
    )?;

    let meaning = MarketDataRepairRequestMeaningV1 {
        schema_version: 1,
        correlation_identity: source.correlation_identity(),
        action_request_identity: action.action_request_identity(),
        action_request_digest: action.action_request_digest(),
        decision_identity: action.decision_identity(),
        decision_digest: action.decision_digest(),
        decision_evidence_cut: evidence_cut,
        replay_request_identity: replay_dto.request_identity.as_str(),
        replay_request_digest: replay_digest.as_str(),
        result_identity: result.result_identity.as_str(),
        result_digest: result.result_digest.as_str(),
        attempt_identity: result.attempt_identity.as_str(),
        category: IterationRepairCategoryV1::MarketData,
        target: IterationRepairTargetV1::MarketData,
        bounded_reason: MarketDataRepairReasonV1::BacktestDiagnosticMarketData,
        decisive_evidence_component: defect.decisive_evidence.component,
        decisive_evidence_reference: defect.decisive_evidence.reference.as_str(),
        decisive_evidence_digest: defect.decisive_evidence.digest.as_str(),
        original_pit_request_identity: source.pit_request_identity(),
        original_pit_request_digest: source.pit_request_digest(),
        original_pit_snapshot_identity: source.pit_snapshot_identity(),
        original_pit_proof_digest: source.pit_snapshot_fact_digest(),
        instrument_scope_identity: replay_dto.pit_scope.identity.as_str(),
        instrument_scope_digest: source.instrument_scope_digest(),
        universe_selection_identity: replay_dto.universe_selection.identity.as_str(),
        universe_selection_digest: source.universe_selection_digest(),
        instrument_master_digest: source.instrument_master_digest(),
        provenance_binding_identity: source.source_binding_identity(),
        provenance_binding_fact_digest: source.source_binding_fact_digest(),
        provenance_lineage_root: source.source_binding_lineage_root(),
        provenance_lineage_version: source.source_binding_lineage_version(),
        source_frontier_digest: source.source_frontier_digest(),
        correction_frontier_digest: source.correction_frontier_digest(),
        market_semantics_identity: source.market_semantics_identity(),
        original_time_evidence: source.time_evidence(),
        shared_time_evidence: &shared_time_evidence,
    };
    let request_digest = digest("rd.market-data-repair-request.v1", &meaning)?;
    let request_identity = identity("rd-market-data-repair-request-v1", &request_digest);
    let request = MarketDataRepairRequestV1 {
        schema_version: 1,
        request_identity,
        request_digest,
        correlation_identity: meaning.correlation_identity,
        action_request_identity: meaning.action_request_identity.to_string(),
        action_request_digest: meaning.action_request_digest.to_string(),
        decision_identity: meaning.decision_identity.to_string(),
        decision_digest: meaning.decision_digest.to_string(),
        decision_evidence_cut: meaning.decision_evidence_cut.clone(),
        replay_request_identity: meaning.replay_request_identity.to_string(),
        replay_request_digest: meaning.replay_request_digest.to_string(),
        result_identity: meaning.result_identity.to_string(),
        result_digest: meaning.result_digest.to_string(),
        attempt_identity: meaning.attempt_identity.to_string(),
        category: meaning.category,
        target: meaning.target,
        bounded_reason: meaning.bounded_reason,
        decisive_evidence_component: meaning.decisive_evidence_component,
        decisive_evidence_reference: meaning.decisive_evidence_reference.to_string(),
        decisive_evidence_digest: meaning.decisive_evidence_digest.to_string(),
        original_pit_request_identity: meaning.original_pit_request_identity,
        original_pit_request_digest: meaning.original_pit_request_digest,
        original_pit_snapshot_identity: meaning.original_pit_snapshot_identity,
        original_pit_proof_digest: meaning.original_pit_proof_digest,
        instrument_scope_identity: meaning.instrument_scope_identity.to_string(),
        instrument_scope_digest: meaning.instrument_scope_digest,
        universe_selection_identity: meaning.universe_selection_identity.to_string(),
        universe_selection_digest: meaning.universe_selection_digest,
        instrument_master_digest: meaning.instrument_master_digest,
        provenance_binding_identity: meaning.provenance_binding_identity,
        provenance_binding_fact_digest: meaning.provenance_binding_fact_digest,
        provenance_lineage_root: meaning.provenance_lineage_root,
        provenance_lineage_version: meaning.provenance_lineage_version,
        source_frontier_digest: meaning.source_frontier_digest,
        correction_frontier_digest: meaning.correction_frontier_digest,
        market_semantics_identity: meaning.market_semantics_identity,
        original_time_evidence: meaning.original_time_evidence.clone(),
        shared_time_evidence,
    };
    let receipt_meaning = MarketDataRepairRequestReceiptMeaningV1 {
        schema_version: 1,
        request_identity: &request.request_identity,
        request_digest: &request.request_digest,
        action_request_identity: &request.action_request_identity,
        decision_identity: &request.decision_identity,
        committed_at_epoch_ms,
    };
    let receipt_digest = digest("rd.market-data-repair-request-receipt.v1", &receipt_meaning)?;
    Ok(MarketDataRepairRequestReadbackV1 {
        receipt: MarketDataRepairRequestReceiptV1 {
            schema_version: 1,
            receipt_identity: identity("rd-market-data-repair-request-receipt-v1", &receipt_digest),
            receipt_digest,
            request_identity: request.request_identity.clone(),
            request_digest: request.request_digest.clone(),
            action_request_identity: request.action_request_identity.clone(),
            decision_identity: request.decision_identity.clone(),
            committed_at_epoch_ms,
        },
        request,
    })
}

#[derive(Serialize)]
struct MarketDataRepairRequestMeaningV1<'a> {
    schema_version: u16,
    correlation_identity: BindingDigest,
    action_request_identity: &'a str,
    action_request_digest: &'a str,
    decision_identity: &'a str,
    decision_digest: &'a str,
    decision_evidence_cut: &'a IterationDecisionEvidenceCutV1,
    replay_request_identity: &'a str,
    replay_request_digest: &'a str,
    result_identity: &'a str,
    result_digest: &'a str,
    attempt_identity: &'a str,
    category: IterationRepairCategoryV1,
    target: IterationRepairTargetV1,
    bounded_reason: MarketDataRepairReasonV1,
    decisive_evidence_component: ObservationComponentV2,
    decisive_evidence_reference: &'a str,
    decisive_evidence_digest: &'a str,
    original_pit_request_identity: BindingDigest,
    original_pit_request_digest: BindingDigest,
    original_pit_snapshot_identity: BindingDigest,
    original_pit_proof_digest: BindingDigest,
    instrument_scope_identity: &'a str,
    instrument_scope_digest: BindingDigest,
    universe_selection_identity: &'a str,
    universe_selection_digest: BindingDigest,
    instrument_master_digest: BindingDigest,
    provenance_binding_identity: BindingDigest,
    provenance_binding_fact_digest: BindingDigest,
    provenance_lineage_root: BindingDigest,
    provenance_lineage_version: u64,
    source_frontier_digest: BindingDigest,
    correction_frontier_digest: BindingDigest,
    market_semantics_identity: BindingDigest,
    original_time_evidence: &'a UntrustedPitSnapshotTimeEvidence,
    shared_time_evidence: &'a ClockHeadHandoff,
}

#[derive(Serialize)]
struct MarketDataRepairRequestReceiptMeaningV1<'a> {
    schema_version: u16,
    request_identity: &'a str,
    request_digest: &'a str,
    action_request_identity: &'a str,
    decision_identity: &'a str,
    committed_at_epoch_ms: u64,
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn admit_stored_market_data_repair_request_v1(
    request_bytes: &[u8],
    receipt_bytes: &[u8],
    action: &RepairActionRequestReadbackV1,
    decision: &RepairInputIterationDecisionReadbackV1,
    replay: &ReplayRequestV2,
    result: &ReplayResultDtoV2,
    source: MarketDataRepairSourceV1,
    shared_time_evidence: ClockHeadHandoff,
    committed_at_epoch_ms: u64,
) -> Result<MarketDataRepairRequestReadbackV1, MarketDataRepairRequestErrorV1> {
    let expected = issue_market_data_repair_request_v1(
        action,
        decision,
        replay,
        result,
        source,
        shared_time_evidence,
        committed_at_epoch_ms,
    )?;
    if expected.request().to_canonical_bytes()? != request_bytes
        || serde_json::to_vec(expected.receipt()).map_err(encoding)? != receipt_bytes
    {
        return Err(MarketDataRepairRequestErrorV1::CustodyMismatch);
    }
    Ok(expected)
}

fn validate_time(
    original: &UntrustedPitSnapshotTimeEvidence,
    current: &ClockHeadHandoff,
    committed_at_epoch_ms: u64,
) -> Result<(), MarketDataRepairRequestErrorV1> {
    let clock = original.decision_cut.clock_identity.as_str();
    let epoch = original.decision_cut.clock_epoch.as_str();
    let same_original_clock = [
        (
            original.event_effective.clock_identity.as_str(),
            original.event_effective.clock_epoch.as_str(),
        ),
        (
            original.provider_available.clock_identity.as_str(),
            original.provider_available.clock_epoch.as_str(),
        ),
        (
            original.retrieval.clock_identity.as_str(),
            original.retrieval.clock_epoch.as_str(),
        ),
    ]
    .into_iter()
    .all(|value| value == (clock, epoch))
        && original
            .correction_publication
            .as_ref()
            .is_none_or(|value| {
                (value.clock_identity.as_str(), value.clock_epoch.as_str()) == (clock, epoch)
            });
    if !same_original_clock
        || current.clock_identity() != clock
        || current.clock_epoch() != epoch
        || current.monotonic_sequence() <= original.monotonic_sequence
        || current.decision_cut() <= original.decision_cut.value
        || current.wall_observed() < original.observed_at
        || current.decision_cut() >= current.valid_through()
        || committed_at_epoch_ms < current.wall_observed()
        || committed_at_epoch_ms >= current.valid_through()
    {
        return Err(MarketDataRepairRequestErrorV1::TimeEvidenceUnavailable);
    }
    Ok(())
}

fn parse_sha256(value: &str) -> Result<[u8; 32], MarketDataRepairRequestErrorV1> {
    let hex = value
        .strip_prefix("sha256:")
        .ok_or(MarketDataRepairRequestErrorV1::MarketDataSourceMismatch)?;
    if hex.len() != 64
        || !hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(MarketDataRepairRequestErrorV1::MarketDataSourceMismatch);
    }
    let mut bytes = [0_u8; 32];
    for (output, pair) in bytes.iter_mut().zip(hex.as_bytes().chunks_exact(2)) {
        let nibble = |byte| match byte {
            b'0'..=b'9' => byte - b'0',
            b'a'..=b'f' => byte - b'a' + 10,
            _ => unreachable!("canonical hexadecimal was checked above"),
        };
        *output = (nibble(pair[0]) << 4) | nibble(pair[1]);
    }
    Ok(bytes)
}

fn digest(domain: &str, value: &impl Serialize) -> Result<String, MarketDataRepairRequestErrorV1> {
    #[derive(Serialize)]
    struct Envelope<'a, T> {
        domain: &'a str,
        value: &'a T,
    }
    serde_json::to_vec(&Envelope { domain, value })
        .map(|bytes| format!("sha256:{:x}", Sha256::digest(bytes)))
        .map_err(encoding)
}

fn identity(prefix: &str, digest: &str) -> String {
    format!("{prefix}-{}", digest.trim_start_matches("sha256:"))
}

fn encoding(error: impl std::fmt::Display) -> MarketDataRepairRequestErrorV1 {
    MarketDataRepairRequestErrorV1::Encoding(error.to_string())
}
