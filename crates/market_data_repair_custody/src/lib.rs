//! Market Data-owned terminal custody for one exact R&D repair request.
//!
//! Issuance consumes both positive inputs by value. A locator, delivery acknowledgement, changed
//! digest, or caller-authored terminal fields cannot create this result.

use serde::Serialize;
use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_data::owner::{
    pit_snapshot::UntrustedPitSnapshotTimeEvidence,
    research_pit_terminal::{ResearchPitBlocker, ResearchPitDisposition, ResearchPitTerminal},
    source_binding::{BindingDigest, UntrustedCompleteFrontier},
};
use vibe_rd_market_data_repair_custody::{
    MarketDataRepairDigestCoordinateV1, SealedMarketDataRepairRequestReadbackV1,
};

const RESULT_DOMAIN_V1: &str = "market-data.repair-terminal.v1";

#[cfg(test)]
mod postgres;

/// Closed terminal vocabulary of the R&D Market Data repair protocol.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MarketDataRepairDispositionV1 {
    Available,
    Unavailable,
}

/// Positive payload present only for an `AVAILABLE` repair terminal.
#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct AvailableMarketDataRepairV1 {
    snapshot_identity: BindingDigest,
    normalized_records_digest: BindingDigest,
}

impl AvailableMarketDataRepairV1 {
    #[must_use]
    pub const fn snapshot_identity(&self) -> BindingDigest {
        self.snapshot_identity
    }

    #[must_use]
    pub const fn normalized_records_digest(&self) -> BindingDigest {
        self.normalized_records_digest
    }
}

/// Move-only terminal issued from exact R&D request custody and an Owner-sealed PIT terminal.
///
/// This type implements neither `Clone` nor `Deserialize`; all fields are private.
#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct MarketDataRepairTerminalV1 {
    schema_version: u16,
    terminal_identity: String,
    terminal_digest: String,
    repair_request_identity: String,
    repair_request_digest: String,
    repair_request_receipt_identity: String,
    repair_request_receipt_digest: String,
    disposition: MarketDataRepairDispositionV1,
    unavailable_basis: Option<ResearchPitDisposition>,
    blockers: Box<[ResearchPitBlocker]>,
    correlation_identity: BindingDigest,
    original_pit_request_identity: BindingDigest,
    original_pit_request_digest: BindingDigest,
    original_pit_snapshot_identity: BindingDigest,
    original_pit_proof_digest: BindingDigest,
    result_pit_snapshot_identity: BindingDigest,
    result_pit_fact_digest: BindingDigest,
    instrument_scope_digest: BindingDigest,
    source_binding_identity: BindingDigest,
    source_binding_fact_digest: BindingDigest,
    source_binding_lineage_root: BindingDigest,
    source_binding_lineage_version: u64,
    original_source_frontier_digest: BindingDigest,
    original_correction_frontier_digest: BindingDigest,
    result_source_frontier: UntrustedCompleteFrontier,
    result_correction_frontier: UntrustedCompleteFrontier,
    result_correction_lineage_root: BindingDigest,
    result_correction_lineage_version: u64,
    result_time_evidence: UntrustedPitSnapshotTimeEvidence,
    instrument_master_digest: BindingDigest,
    universe_selection_digest: BindingDigest,
    market_semantics_identity: BindingDigest,
    available: Option<AvailableMarketDataRepairV1>,
}

impl MarketDataRepairTerminalV1 {
    #[must_use]
    pub fn terminal_identity(&self) -> &str {
        &self.terminal_identity
    }

    #[must_use]
    pub fn terminal_digest(&self) -> &str {
        &self.terminal_digest
    }

    #[must_use]
    pub fn repair_request_identity(&self) -> &str {
        &self.repair_request_identity
    }

    #[must_use]
    pub fn repair_request_digest(&self) -> &str {
        &self.repair_request_digest
    }

    #[must_use]
    pub fn repair_request_receipt_identity(&self) -> &str {
        &self.repair_request_receipt_identity
    }

    #[must_use]
    pub fn repair_request_receipt_digest(&self) -> &str {
        &self.repair_request_receipt_digest
    }

    #[must_use]
    pub const fn correlation_identity(&self) -> BindingDigest {
        self.correlation_identity
    }

    #[must_use]
    pub const fn result_time_evidence(&self) -> &UntrustedPitSnapshotTimeEvidence {
        &self.result_time_evidence
    }

    #[must_use]
    pub const fn disposition(&self) -> MarketDataRepairDispositionV1 {
        self.disposition
    }

    #[must_use]
    pub const fn unavailable_basis(&self) -> Option<ResearchPitDisposition> {
        self.unavailable_basis
    }

    #[must_use]
    pub fn blockers(&self) -> &[ResearchPitBlocker] {
        &self.blockers
    }

    #[must_use]
    pub const fn available(&self) -> Option<&AvailableMarketDataRepairV1> {
        self.available.as_ref()
    }

    pub fn to_canonical_bytes(&self) -> Result<Vec<u8>, MarketDataRepairTerminalErrorV1> {
        serde_json::to_vec(self).map_err(encoding)
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum MarketDataRepairTerminalErrorV1 {
    #[error("the sealed R&D request is not for Market Data")]
    WrongTarget,
    #[error("the R&D repair request and Market Data PIT terminal do not match")]
    BindingMismatch,
    #[error("the original PIT terminal cannot be replayed as a repair result")]
    PriorTerminalReplayed,
    #[error("the Market Data PIT terminal shape is inconsistent")]
    TerminalShape,
    #[error("Market Data repair terminal encoding is unavailable: {0}")]
    Encoding(String),
}

/// Issues one deterministic repair terminal from two independently sealed Owner readbacks.
///
/// Both inputs are consumed. This function performs no provider, transport, persistence, or
/// trading effect.
#[allow(
    clippy::needless_pass_by_value,
    reason = "consumption preserves single-use custody for both sealed Owner readbacks"
)]
pub fn issue_market_data_repair_terminal_v1(
    request: SealedMarketDataRepairRequestReadbackV1,
    pit: ResearchPitTerminal,
) -> Result<MarketDataRepairTerminalV1, MarketDataRepairTerminalErrorV1> {
    issue_from_evidence(&request, &pit)
}

trait RepairRequestEvidence {
    fn is_market_data_target(&self) -> bool;
    fn request_identity(&self) -> &str;
    fn request_digest(&self) -> &str;
    fn receipt_identity(&self) -> &str;
    fn receipt_digest(&self) -> &str;
    fn coordinate(&self, coordinate: MarketDataRepairDigestCoordinateV1) -> Option<[u8; 32]>;
    fn provenance_lineage_version(&self) -> Option<u64>;
    fn original_time_evidence_matches(&self, value: &UntrustedPitSnapshotTimeEvidence) -> bool;
}

impl RepairRequestEvidence for SealedMarketDataRepairRequestReadbackV1 {
    fn is_market_data_target(&self) -> bool {
        self.is_market_data_target()
    }

    fn request_identity(&self) -> &str {
        self.request_identity()
    }

    fn request_digest(&self) -> &str {
        self.request_digest()
    }

    fn receipt_identity(&self) -> &str {
        self.receipt_identity()
    }

    fn receipt_digest(&self) -> &str {
        self.receipt_digest()
    }

    fn coordinate(&self, coordinate: MarketDataRepairDigestCoordinateV1) -> Option<[u8; 32]> {
        self.digest_coordinate(coordinate)
    }

    fn provenance_lineage_version(&self) -> Option<u64> {
        self.provenance_lineage_version()
    }

    fn original_time_evidence_matches(&self, value: &UntrustedPitSnapshotTimeEvidence) -> bool {
        self.original_time_evidence_matches(value)
    }
}

trait PitTerminalEvidence {
    fn disposition(&self) -> ResearchPitDisposition;
    fn blockers(&self) -> &[ResearchPitBlocker];
    fn primary_blocker(&self) -> Option<ResearchPitBlocker>;
    fn request_identity(&self) -> BindingDigest;
    fn request_digest(&self) -> BindingDigest;
    fn scope_digest(&self) -> BindingDigest;
    fn correlation_identity(&self) -> BindingDigest;
    fn snapshot_identity(&self) -> BindingDigest;
    fn fact_digest(&self) -> BindingDigest;
    fn source_binding_identity(&self) -> BindingDigest;
    fn source_binding_fact_digest(&self) -> BindingDigest;
    fn source_binding_lineage_root(&self) -> BindingDigest;
    fn source_binding_lineage_version(&self) -> u64;
    fn source_frontier(&self) -> &UntrustedCompleteFrontier;
    fn correction_frontier(&self) -> &UntrustedCompleteFrontier;
    fn correction_lineage_root(&self) -> BindingDigest;
    fn correction_lineage_version(&self) -> u64;
    fn time_evidence(&self) -> &UntrustedPitSnapshotTimeEvidence;
    fn instrument_master_digest(&self) -> BindingDigest;
    fn universe_selection_digest(&self) -> BindingDigest;
    fn market_semantics_identity(&self) -> BindingDigest;
    fn available(&self) -> Option<(BindingDigest, BindingDigest)>;
}

impl PitTerminalEvidence for ResearchPitTerminal {
    fn disposition(&self) -> ResearchPitDisposition {
        self.disposition()
    }
    fn blockers(&self) -> &[ResearchPitBlocker] {
        self.blockers()
    }
    fn primary_blocker(&self) -> Option<ResearchPitBlocker> {
        self.primary_blocker()
    }
    fn request_identity(&self) -> BindingDigest {
        self.request_identity()
    }
    fn request_digest(&self) -> BindingDigest {
        self.request_digest()
    }
    fn scope_digest(&self) -> BindingDigest {
        self.scope_digest()
    }
    fn correlation_identity(&self) -> BindingDigest {
        self.correlation_identity()
    }
    fn snapshot_identity(&self) -> BindingDigest {
        self.snapshot_identity()
    }
    fn fact_digest(&self) -> BindingDigest {
        self.fact_digest()
    }
    fn source_binding_identity(&self) -> BindingDigest {
        self.source_binding_identity()
    }
    fn source_binding_fact_digest(&self) -> BindingDigest {
        self.source_binding_fact_digest()
    }
    fn source_binding_lineage_root(&self) -> BindingDigest {
        self.source_binding_lineage_root()
    }
    fn source_binding_lineage_version(&self) -> u64 {
        self.source_binding_lineage_version()
    }
    fn source_frontier(&self) -> &UntrustedCompleteFrontier {
        self.source_frontier()
    }
    fn correction_frontier(&self) -> &UntrustedCompleteFrontier {
        self.correction_frontier()
    }
    fn correction_lineage_root(&self) -> BindingDigest {
        self.correction_lineage_root()
    }
    fn correction_lineage_version(&self) -> u64 {
        self.correction_lineage_version()
    }
    fn time_evidence(&self) -> &UntrustedPitSnapshotTimeEvidence {
        self.time_evidence()
    }
    fn instrument_master_digest(&self) -> BindingDigest {
        self.instrument_master_digest()
    }
    fn universe_selection_digest(&self) -> BindingDigest {
        self.universe_selection_digest()
    }
    fn market_semantics_identity(&self) -> BindingDigest {
        self.market_semantics_identity()
    }
    fn available(&self) -> Option<(BindingDigest, BindingDigest)> {
        self.available()
            .map(|value| (value.snapshot_identity(), value.normalized_records_digest()))
    }
}

fn issue_from_evidence(
    request: &impl RepairRequestEvidence,
    pit: &impl PitTerminalEvidence,
) -> Result<MarketDataRepairTerminalV1, MarketDataRepairTerminalErrorV1> {
    if !request.is_market_data_target() {
        return Err(MarketDataRepairTerminalErrorV1::WrongTarget);
    }
    let original_pit_request_identity = coordinate(
        request,
        MarketDataRepairDigestCoordinateV1::OriginalPitRequestIdentity,
    )?;
    let original_pit_request_digest = coordinate(
        request,
        MarketDataRepairDigestCoordinateV1::OriginalPitRequestDigest,
    )?;
    let original_pit_snapshot_identity = coordinate(
        request,
        MarketDataRepairDigestCoordinateV1::OriginalPitSnapshotIdentity,
    )?;
    let original_pit_proof_digest = coordinate(
        request,
        MarketDataRepairDigestCoordinateV1::OriginalPitProofDigest,
    )?;
    let correlation_identity = coordinate(
        request,
        MarketDataRepairDigestCoordinateV1::CorrelationIdentity,
    )?;
    let instrument_scope_digest = coordinate(
        request,
        MarketDataRepairDigestCoordinateV1::InstrumentScopeDigest,
    )?;
    let source_binding_identity = coordinate(
        request,
        MarketDataRepairDigestCoordinateV1::ProvenanceBindingIdentity,
    )?;
    let source_binding_fact_digest = coordinate(
        request,
        MarketDataRepairDigestCoordinateV1::ProvenanceBindingFactDigest,
    )?;
    let source_binding_lineage_root = coordinate(
        request,
        MarketDataRepairDigestCoordinateV1::ProvenanceLineageRoot,
    )?;
    let original_source_frontier_digest = coordinate(
        request,
        MarketDataRepairDigestCoordinateV1::SourceFrontierDigest,
    )?;
    let original_correction_frontier_digest = coordinate(
        request,
        MarketDataRepairDigestCoordinateV1::CorrectionFrontierDigest,
    )?;
    let instrument_master_digest = coordinate(
        request,
        MarketDataRepairDigestCoordinateV1::InstrumentMasterDigest,
    )?;
    let universe_selection_digest = coordinate(
        request,
        MarketDataRepairDigestCoordinateV1::UniverseSelectionDigest,
    )?;
    let market_semantics_identity = coordinate(
        request,
        MarketDataRepairDigestCoordinateV1::MarketSemanticsIdentity,
    )?;
    let source_binding_lineage_version = request
        .provenance_lineage_version()
        .ok_or(MarketDataRepairTerminalErrorV1::BindingMismatch)?;

    if pit.request_identity() != original_pit_request_identity
        || pit.request_digest() != original_pit_request_digest
        || pit.scope_digest() != instrument_scope_digest
        || pit.correlation_identity() != correlation_identity
        || pit.source_binding_identity() != source_binding_identity
        || pit.source_binding_fact_digest() != source_binding_fact_digest
        || pit.source_binding_lineage_root() != source_binding_lineage_root
        || pit.source_binding_lineage_version() != source_binding_lineage_version
        || pit.instrument_master_digest() != instrument_master_digest
        || pit.universe_selection_digest() != universe_selection_digest
        || pit.market_semantics_identity() != market_semantics_identity
        || !request.original_time_evidence_matches(pit.time_evidence())
    {
        return Err(MarketDataRepairTerminalErrorV1::BindingMismatch);
    }
    if pit.snapshot_identity() == original_pit_snapshot_identity
        && pit.fact_digest() == original_pit_proof_digest
    {
        return Err(MarketDataRepairTerminalErrorV1::PriorTerminalReplayed);
    }

    let (disposition, unavailable_basis, available) = match pit.disposition() {
        ResearchPitDisposition::Available => {
            if !pit.blockers().is_empty() || pit.primary_blocker().is_some() {
                return Err(MarketDataRepairTerminalErrorV1::TerminalShape);
            }
            let (snapshot_identity, normalized_records_digest) = pit
                .available()
                .ok_or(MarketDataRepairTerminalErrorV1::TerminalShape)?;
            (
                MarketDataRepairDispositionV1::Available,
                None,
                Some(AvailableMarketDataRepairV1 {
                    snapshot_identity,
                    normalized_records_digest,
                }),
            )
        }
        basis => {
            if pit.available().is_some() {
                return Err(MarketDataRepairTerminalErrorV1::TerminalShape);
            }
            (
                MarketDataRepairDispositionV1::Unavailable,
                Some(basis),
                None,
            )
        }
    };

    let meaning = TerminalMeaningV1 {
        schema_version: 1,
        repair_request_identity: request.request_identity(),
        repair_request_digest: request.request_digest(),
        repair_request_receipt_identity: request.receipt_identity(),
        repair_request_receipt_digest: request.receipt_digest(),
        disposition,
        unavailable_basis,
        blockers: pit.blockers(),
        correlation_identity,
        original_pit_request_identity,
        original_pit_request_digest,
        original_pit_snapshot_identity,
        original_pit_proof_digest,
        result_pit_snapshot_identity: pit.snapshot_identity(),
        result_pit_fact_digest: pit.fact_digest(),
        instrument_scope_digest,
        source_binding_identity,
        source_binding_fact_digest,
        source_binding_lineage_root,
        source_binding_lineage_version,
        original_source_frontier_digest,
        original_correction_frontier_digest,
        result_source_frontier: pit.source_frontier(),
        result_correction_frontier: pit.correction_frontier(),
        result_correction_lineage_root: pit.correction_lineage_root(),
        result_correction_lineage_version: pit.correction_lineage_version(),
        result_time_evidence: pit.time_evidence(),
        instrument_master_digest,
        universe_selection_digest,
        market_semantics_identity,
        available: available.as_ref(),
    };
    let terminal_digest = digest(&meaning)?;
    Ok(MarketDataRepairTerminalV1 {
        schema_version: 1,
        terminal_identity: format!(
            "market-data-repair-terminal-v1-{}",
            terminal_digest.trim_start_matches("sha256:")
        ),
        terminal_digest,
        repair_request_identity: request.request_identity().to_owned(),
        repair_request_digest: request.request_digest().to_owned(),
        repair_request_receipt_identity: request.receipt_identity().to_owned(),
        repair_request_receipt_digest: request.receipt_digest().to_owned(),
        disposition,
        unavailable_basis,
        blockers: pit.blockers().to_vec().into_boxed_slice(),
        correlation_identity,
        original_pit_request_identity,
        original_pit_request_digest,
        original_pit_snapshot_identity,
        original_pit_proof_digest,
        result_pit_snapshot_identity: pit.snapshot_identity(),
        result_pit_fact_digest: pit.fact_digest(),
        instrument_scope_digest,
        source_binding_identity,
        source_binding_fact_digest,
        source_binding_lineage_root,
        source_binding_lineage_version,
        original_source_frontier_digest,
        original_correction_frontier_digest,
        result_source_frontier: pit.source_frontier().clone(),
        result_correction_frontier: pit.correction_frontier().clone(),
        result_correction_lineage_root: pit.correction_lineage_root(),
        result_correction_lineage_version: pit.correction_lineage_version(),
        result_time_evidence: pit.time_evidence().clone(),
        instrument_master_digest,
        universe_selection_digest,
        market_semantics_identity,
        available,
    })
}

fn coordinate(
    request: &impl RepairRequestEvidence,
    value: MarketDataRepairDigestCoordinateV1,
) -> Result<BindingDigest, MarketDataRepairTerminalErrorV1> {
    request
        .coordinate(value)
        .map(BindingDigest::from_untrusted_bytes)
        .ok_or(MarketDataRepairTerminalErrorV1::BindingMismatch)
}

#[derive(Serialize)]
struct TerminalMeaningV1<'a> {
    schema_version: u16,
    repair_request_identity: &'a str,
    repair_request_digest: &'a str,
    repair_request_receipt_identity: &'a str,
    repair_request_receipt_digest: &'a str,
    disposition: MarketDataRepairDispositionV1,
    unavailable_basis: Option<ResearchPitDisposition>,
    blockers: &'a [ResearchPitBlocker],
    correlation_identity: BindingDigest,
    original_pit_request_identity: BindingDigest,
    original_pit_request_digest: BindingDigest,
    original_pit_snapshot_identity: BindingDigest,
    original_pit_proof_digest: BindingDigest,
    result_pit_snapshot_identity: BindingDigest,
    result_pit_fact_digest: BindingDigest,
    instrument_scope_digest: BindingDigest,
    source_binding_identity: BindingDigest,
    source_binding_fact_digest: BindingDigest,
    source_binding_lineage_root: BindingDigest,
    source_binding_lineage_version: u64,
    original_source_frontier_digest: BindingDigest,
    original_correction_frontier_digest: BindingDigest,
    result_source_frontier: &'a UntrustedCompleteFrontier,
    result_correction_frontier: &'a UntrustedCompleteFrontier,
    result_correction_lineage_root: BindingDigest,
    result_correction_lineage_version: u64,
    result_time_evidence: &'a UntrustedPitSnapshotTimeEvidence,
    instrument_master_digest: BindingDigest,
    universe_selection_digest: BindingDigest,
    market_semantics_identity: BindingDigest,
    available: Option<&'a AvailableMarketDataRepairV1>,
}

fn digest(value: &impl Serialize) -> Result<String, MarketDataRepairTerminalErrorV1> {
    #[derive(Serialize)]
    struct Envelope<'a, T> {
        domain: &'a str,
        value: &'a T,
    }
    serde_json::to_vec(&Envelope {
        domain: RESULT_DOMAIN_V1,
        value,
    })
    .map(|bytes| format!("sha256:{:x}", Sha256::digest(bytes)))
    .map_err(encoding)
}

fn encoding(error: impl std::fmt::Display) -> MarketDataRepairTerminalErrorV1 {
    MarketDataRepairTerminalErrorV1::Encoding(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use vibe_data::owner::pit_snapshot::{
        UntrustedEventEffectiveTime, UntrustedProviderAvailableTime, UntrustedRetrievalTime,
        UntrustedSnapshotDecisionCut,
    };

    fn d(value: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([value; 32])
    }

    fn time() -> UntrustedPitSnapshotTimeEvidence {
        UntrustedPitSnapshotTimeEvidence {
            event_effective: UntrustedEventEffectiveTime::from_untrusted(10, "clock", "epoch"),
            provider_available: UntrustedProviderAvailableTime::from_untrusted(
                11, "clock", "epoch",
            ),
            retrieval: UntrustedRetrievalTime::from_untrusted(12, "clock", "epoch"),
            correction_publication: None,
            decision_cut: UntrustedSnapshotDecisionCut::from_untrusted(13, "clock", "epoch"),
            monotonic_sequence: 14,
            restart_continuity_digest: d(30),
            skew_bound: 2,
            uncertainty_bound: 1,
            observed_at: 15,
            valid_through: 20,
        }
    }

    #[derive(Clone)]
    struct FixtureRequest {
        target: bool,
        coordinates: [[u8; 32]; 14],
        time: UntrustedPitSnapshotTimeEvidence,
    }

    impl RepairRequestEvidence for FixtureRequest {
        fn is_market_data_target(&self) -> bool {
            self.target
        }
        fn request_identity(&self) -> &str {
            "repair-request"
        }
        fn request_digest(&self) -> &str {
            "sha256:repair-request"
        }
        fn receipt_identity(&self) -> &str {
            "repair-receipt"
        }
        fn receipt_digest(&self) -> &str {
            "sha256:repair-receipt"
        }
        fn coordinate(&self, coordinate: MarketDataRepairDigestCoordinateV1) -> Option<[u8; 32]> {
            Some(self.coordinates[coordinate as usize])
        }
        fn provenance_lineage_version(&self) -> Option<u64> {
            Some(7)
        }
        fn original_time_evidence_matches(&self, value: &UntrustedPitSnapshotTimeEvidence) -> bool {
            &self.time == value
        }
    }

    #[derive(Clone)]
    struct FixturePit {
        disposition: ResearchPitDisposition,
        blockers: Vec<ResearchPitBlocker>,
        primary_blocker: Option<ResearchPitBlocker>,
        request_identity: BindingDigest,
        request_digest: BindingDigest,
        scope_digest: BindingDigest,
        correlation_identity: BindingDigest,
        snapshot_identity: BindingDigest,
        fact_digest: BindingDigest,
        source_binding_identity: BindingDigest,
        source_binding_fact_digest: BindingDigest,
        source_binding_lineage_root: BindingDigest,
        time: UntrustedPitSnapshotTimeEvidence,
        instrument_master_digest: BindingDigest,
        universe_selection_digest: BindingDigest,
        market_semantics_identity: BindingDigest,
        available: Option<(BindingDigest, BindingDigest)>,
    }

    impl PitTerminalEvidence for FixturePit {
        fn disposition(&self) -> ResearchPitDisposition {
            self.disposition
        }
        fn blockers(&self) -> &[ResearchPitBlocker] {
            &self.blockers
        }
        fn primary_blocker(&self) -> Option<ResearchPitBlocker> {
            self.primary_blocker
        }
        fn request_identity(&self) -> BindingDigest {
            self.request_identity
        }
        fn request_digest(&self) -> BindingDigest {
            self.request_digest
        }
        fn scope_digest(&self) -> BindingDigest {
            self.scope_digest
        }
        fn correlation_identity(&self) -> BindingDigest {
            self.correlation_identity
        }
        fn snapshot_identity(&self) -> BindingDigest {
            self.snapshot_identity
        }
        fn fact_digest(&self) -> BindingDigest {
            self.fact_digest
        }
        fn source_binding_identity(&self) -> BindingDigest {
            self.source_binding_identity
        }
        fn source_binding_fact_digest(&self) -> BindingDigest {
            self.source_binding_fact_digest
        }
        fn source_binding_lineage_root(&self) -> BindingDigest {
            self.source_binding_lineage_root
        }
        fn source_binding_lineage_version(&self) -> u64 {
            7
        }
        fn source_frontier(&self) -> &UntrustedCompleteFrontier {
            &SOURCE_FRONTIER
        }
        fn correction_frontier(&self) -> &UntrustedCompleteFrontier {
            &CORRECTION_FRONTIER
        }
        fn correction_lineage_root(&self) -> BindingDigest {
            d(31)
        }
        fn correction_lineage_version(&self) -> u64 {
            8
        }
        fn time_evidence(&self) -> &UntrustedPitSnapshotTimeEvidence {
            &self.time
        }
        fn instrument_master_digest(&self) -> BindingDigest {
            self.instrument_master_digest
        }
        fn universe_selection_digest(&self) -> BindingDigest {
            self.universe_selection_digest
        }
        fn market_semantics_identity(&self) -> BindingDigest {
            self.market_semantics_identity
        }
        fn available(&self) -> Option<(BindingDigest, BindingDigest)> {
            self.available
        }
    }

    static SOURCE_FRONTIER: UntrustedCompleteFrontier = UntrustedCompleteFrontier {
        stream_identity: String::new(),
        cut_identity: String::new(),
        sequence: 1,
        digest: BindingDigest::from_untrusted_bytes([12; 32]),
    };
    static CORRECTION_FRONTIER: UntrustedCompleteFrontier = UntrustedCompleteFrontier {
        stream_identity: String::new(),
        cut_identity: String::new(),
        sequence: 2,
        digest: BindingDigest::from_untrusted_bytes([13; 32]),
    };

    fn fixtures() -> (FixtureRequest, FixturePit) {
        let mut coordinates = [[0; 32]; 14];
        for (index, value) in coordinates.iter_mut().enumerate() {
            *value = [(index + 1) as u8; 32];
        }
        (
            FixtureRequest {
                target: true,
                coordinates,
                time: time(),
            },
            FixturePit {
                disposition: ResearchPitDisposition::Available,
                blockers: Vec::new(),
                primary_blocker: None,
                request_identity: d(2),
                request_digest: d(3),
                scope_digest: d(6),
                correlation_identity: d(1),
                snapshot_identity: d(20),
                fact_digest: d(21),
                source_binding_identity: d(9),
                source_binding_fact_digest: d(10),
                source_binding_lineage_root: d(11),
                time: time(),
                instrument_master_digest: d(8),
                universe_selection_digest: d(7),
                market_semantics_identity: d(14),
                available: Some((d(20), d(22))),
            },
        )
    }

    pub(crate) fn available_terminal_fixture(result_value: u8) -> MarketDataRepairTerminalV1 {
        let (request, mut pit) = fixtures();
        pit.snapshot_identity = d(result_value);
        pit.fact_digest = d(result_value.wrapping_add(1));
        pit.available = Some((d(result_value), d(result_value.wrapping_add(2))));
        issue_from_evidence(&request, &pit).expect("available repair terminal fixture")
    }

    #[test]
    fn exact_available_terminal_is_deterministic() {
        let first = available_terminal_fixture(20);
        let second = available_terminal_fixture(20);
        assert_eq!(
            first.disposition(),
            MarketDataRepairDispositionV1::Available
        );
        assert!(first.available().is_some());
        assert_eq!(first.to_canonical_bytes(), second.to_canonical_bytes());
    }

    #[test]
    fn canonical_non_available_terminal_maps_to_unavailable() {
        let (request, mut pit) = fixtures();
        pit.disposition = ResearchPitDisposition::Insufficient;
        pit.blockers = vec![ResearchPitBlocker::CoverageInsufficient];
        pit.primary_blocker = Some(ResearchPitBlocker::CoverageInsufficient);
        pit.available = None;
        let terminal = issue_from_evidence(&request, &pit).expect("unavailable repair terminal");
        assert_eq!(
            terminal.disposition(),
            MarketDataRepairDispositionV1::Unavailable
        );
        assert_eq!(
            terminal.unavailable_basis(),
            Some(ResearchPitDisposition::Insufficient)
        );
        assert_eq!(
            terminal.blockers(),
            &[ResearchPitBlocker::CoverageInsufficient]
        );
        assert!(terminal.available().is_none());
    }

    #[test]
    fn spliced_or_prior_terminal_fails_closed() {
        let (request, mut pit) = fixtures();
        pit.correlation_identity = d(99);
        assert_eq!(
            issue_from_evidence(&request, &pit),
            Err(MarketDataRepairTerminalErrorV1::BindingMismatch)
        );

        let (mut request, mut pit) = fixtures();
        pit.snapshot_identity = d(4);
        pit.fact_digest = d(5);
        assert_eq!(
            issue_from_evidence(&request, &pit),
            Err(MarketDataRepairTerminalErrorV1::PriorTerminalReplayed)
        );

        request.target = false;
        assert_eq!(
            issue_from_evidence(&request, &pit),
            Err(MarketDataRepairTerminalErrorV1::WrongTarget)
        );
    }
}
