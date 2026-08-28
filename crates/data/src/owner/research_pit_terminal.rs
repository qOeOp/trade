//! Research-bound ordinary PIT terminal read contract.
//!
//! Callers supply comparison facts only. Market Data rereads canonical durable PIT, Source Binding,
//! and Shared Time evidence before issuing the move-only terminal carrier.
//!
//! Raw store-admission evidence is not part of the public type graph:
//!
//! ```compile_fail
//! use vibe_data::owner::store_admission::MarketDataPitTerminalStorageEvidence;
//! ```
//!
//! The former raw capability bridge and standalone crate are not compatibility surfaces:
//!
//! ```compile_fail
//! let _raw_bridge = vibe_data::owner::research_pit_terminal_resolver_from_admitted_postgres;
//! ```
//!
//! ```compile_fail
//! use vibe_deployment_store_admission::AdmittedMarketDataSnapshotPort;
//! ```

use serde::Serialize;

use super::{
    pit_snapshot::{
        PitSnapshotBlocker, PitSnapshotCommitAggregate, PitSnapshotDisposition, PitSnapshotError,
        UntrustedPitSnapshotLocator, UntrustedPitSnapshotRequest, UntrustedPitSnapshotTimeEvidence,
    },
    source_binding::{
        BindingDigest, UntrustedCompleteFrontier, authority::SourceBindingStoredAggregate,
    },
};

const RESEARCH_OWNER_ROLE: &str = "RESEARCH_OWNER";
const SNAPSHOT_CORRECTION_RULE_DOMAIN: &[u8] =
    b"vibe.market-data.research-pit.snapshot-correction-rule.v1";
const SOURCE_PROVENANCE_DOMAIN: &[u8] = b"vibe.market-data.research-pit.source-provenance.v1";
const LICENSE_BINDING_DOMAIN: &[u8] = b"vibe.market-data.research-pit.license-binding.v1";

/// Caller-supplied exact comparison request. It grants no read or positive-fact authority.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedResearchPitTerminalRequest {
    /// Canonical consumer role. Only `RESEARCH_OWNER` is accepted.
    pub consumer_role: String,
    /// Exact untrusted native PIT locator.
    pub locator: UntrustedPitSnapshotLocator,
    /// Frozen Research-owned request head identity.
    pub requester_identity: BindingDigest,
    /// Exact PIT request identity.
    pub request_identity: BindingDigest,
    /// Exact PIT request content digest.
    pub request_digest: BindingDigest,
    /// Frozen instrument or universe scope.
    pub scope_digest: BindingDigest,
    /// Stable cross-Owner correlation identity.
    pub correlation_identity: BindingDigest,
    /// Exact current Source Binding identity and fact digest.
    pub source_binding_identity: BindingDigest,
    pub source_binding_fact_digest: BindingDigest,
    /// Exact current Source Binding lineage.
    pub source_binding_lineage_root: BindingDigest,
    pub source_binding_lineage_version: u64,
    /// Exact requested source and correction frontiers.
    pub source_frontier: UntrustedCompleteFrontier,
    pub correction_frontier: UntrustedCompleteFrontier,
    /// Exact shared-time request evidence.
    pub time_evidence: UntrustedPitSnapshotTimeEvidence,
    /// Requester-owned stable snapshot/correction rule digest.
    pub snapshot_correction_rule_digest: BindingDigest,
    /// Requester-required source provenance binding.
    pub provenance_binding_digest: BindingDigest,
    /// Requester-required license binding.
    pub license_binding_digest: BindingDigest,
}

/// Exact public six-state ordinary Research terminal vocabulary.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResearchPitDisposition {
    Available,
    Unlicensed,
    Ambiguous,
    Stale,
    Insufficient,
    Unavailable,
}

/// Complete public blocker vocabulary in stable Market Data precedence order.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResearchPitBlocker {
    RightsUnlicensed,
    IdentitySemanticsOrTimeAmbiguous,
    EvidenceStale,
    CoverageInsufficient,
    SourceUnavailable,
}

/// Positive-only data identity. It exists only for a complete canonical `AVAILABLE` terminal.
#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct AvailableResearchPitSnapshot {
    snapshot_identity: BindingDigest,
    normalized_records_digest: BindingDigest,
}

impl AvailableResearchPitSnapshot {
    pub const fn snapshot_identity(&self) -> BindingDigest {
        self.snapshot_identity
    }

    pub const fn normalized_records_digest(&self) -> BindingDigest {
        self.normalized_records_digest
    }
}

/// Owner-sealed, move-only ordinary Research PIT terminal.
///
/// The type deliberately implements neither `Clone` nor `Deserialize`. Private construction keeps
/// exact terminal truth and the positive-only payload identity under Market Data authority.
///
/// ```compile_fail
/// use vibe_data::owner::research_pit_terminal::ResearchPitTerminal;
///
/// fn requires_clone<T: Clone>(_: &T) {}
/// fn duplicate(terminal: ResearchPitTerminal) {
///     requires_clone(&terminal);
/// }
/// ```
///
/// A caller cannot construct a terminal from caller-authored fields:
///
/// ```compile_fail
/// use vibe_data::owner::research_pit_terminal::ResearchPitTerminal;
/// let _forged = ResearchPitTerminal {};
/// ```
///
/// A caller also cannot deserialize a terminal from bytes:
///
/// ```compile_fail
/// use vibe_data::owner::research_pit_terminal::ResearchPitTerminal;
/// let _forged: ResearchPitTerminal = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct ResearchPitTerminal {
    disposition: ResearchPitDisposition,
    blockers: Box<[ResearchPitBlocker]>,
    primary_blocker: Option<ResearchPitBlocker>,
    requester_identity: BindingDigest,
    request_identity: BindingDigest,
    request_digest: BindingDigest,
    scope_digest: BindingDigest,
    correlation_identity: BindingDigest,
    snapshot_identity: BindingDigest,
    fact_digest: BindingDigest,
    source_binding_identity: BindingDigest,
    source_binding_fact_digest: BindingDigest,
    source_binding_lineage_root: BindingDigest,
    source_binding_lineage_version: u64,
    source_frontier: UntrustedCompleteFrontier,
    correction_frontier: UntrustedCompleteFrontier,
    correction_lineage_root: BindingDigest,
    correction_lineage_version: u64,
    time_evidence: UntrustedPitSnapshotTimeEvidence,
    instrument_master_digest: BindingDigest,
    universe_selection_digest: BindingDigest,
    market_semantics_identity: BindingDigest,
    snapshot_correction_rule_digest: BindingDigest,
    provenance_binding_digest: BindingDigest,
    license_binding_digest: BindingDigest,
    available: Option<AvailableResearchPitSnapshot>,
}

impl ResearchPitTerminal {
    pub const fn disposition(&self) -> ResearchPitDisposition {
        self.disposition
    }
    pub fn blockers(&self) -> &[ResearchPitBlocker] {
        &self.blockers
    }
    pub const fn primary_blocker(&self) -> Option<ResearchPitBlocker> {
        self.primary_blocker
    }
    pub const fn requester_identity(&self) -> BindingDigest {
        self.requester_identity
    }
    pub const fn request_identity(&self) -> BindingDigest {
        self.request_identity
    }
    pub const fn request_digest(&self) -> BindingDigest {
        self.request_digest
    }
    pub const fn scope_digest(&self) -> BindingDigest {
        self.scope_digest
    }
    pub const fn correlation_identity(&self) -> BindingDigest {
        self.correlation_identity
    }
    pub const fn snapshot_identity(&self) -> BindingDigest {
        self.snapshot_identity
    }
    pub const fn fact_digest(&self) -> BindingDigest {
        self.fact_digest
    }
    pub const fn source_binding_identity(&self) -> BindingDigest {
        self.source_binding_identity
    }
    pub const fn source_binding_fact_digest(&self) -> BindingDigest {
        self.source_binding_fact_digest
    }
    pub const fn source_binding_lineage_root(&self) -> BindingDigest {
        self.source_binding_lineage_root
    }
    pub const fn source_binding_lineage_version(&self) -> u64 {
        self.source_binding_lineage_version
    }
    pub const fn source_frontier(&self) -> &UntrustedCompleteFrontier {
        &self.source_frontier
    }
    pub const fn correction_frontier(&self) -> &UntrustedCompleteFrontier {
        &self.correction_frontier
    }
    pub const fn correction_lineage_root(&self) -> BindingDigest {
        self.correction_lineage_root
    }
    pub const fn correction_lineage_version(&self) -> u64 {
        self.correction_lineage_version
    }
    pub const fn time_evidence(&self) -> &UntrustedPitSnapshotTimeEvidence {
        &self.time_evidence
    }
    pub const fn instrument_master_digest(&self) -> BindingDigest {
        self.instrument_master_digest
    }
    pub const fn universe_selection_digest(&self) -> BindingDigest {
        self.universe_selection_digest
    }
    pub const fn market_semantics_identity(&self) -> BindingDigest {
        self.market_semantics_identity
    }
    pub const fn snapshot_correction_rule_digest(&self) -> BindingDigest {
        self.snapshot_correction_rule_digest
    }
    pub const fn provenance_binding_digest(&self) -> BindingDigest {
        self.provenance_binding_digest
    }
    pub const fn license_binding_digest(&self) -> BindingDigest {
        self.license_binding_digest
    }
    pub const fn available(&self) -> Option<&AvailableResearchPitSnapshot> {
        self.available.as_ref()
    }
    pub fn into_available(self) -> Option<AvailableResearchPitSnapshot> {
        self.available
    }
}

pub(crate) mod sealed {
    pub trait Sealed {}
}

/// Read-only Market Data resolver for the ordinary Research terminal.
///
/// The implementation authority is sealed inside Market Data:
///
/// ```compile_fail
/// struct ForgedResolver;
/// impl vibe_data::owner::research_pit_terminal::sealed::Sealed for ForgedResolver {}
/// ```
#[async_trait::async_trait]
#[allow(private_bounds)]
pub trait ResearchPitTerminalResolver: sealed::Sealed + Send + Sync {
    async fn resolve_research_pit_terminal(
        &self,
        request: &UntrustedResearchPitTerminalRequest,
    ) -> Result<ResearchPitTerminal, PitSnapshotError>;
}

pub(crate) fn seal_research_pit_terminal(
    pit: &PitSnapshotCommitAggregate,
    source: &SourceBindingStoredAggregate,
    comparison: &UntrustedResearchPitTerminalRequest,
) -> Result<ResearchPitTerminal, PitSnapshotError> {
    if comparison.consumer_role != RESEARCH_OWNER_ROLE {
        return Err(PitSnapshotError::ConsumerRoleMismatch);
    }

    if !super::pit_snapshot::authority::verify_aggregate(pit)
        || !super::pit_snapshot::authority::verify_terminal_basis(pit, source.commit().fact())
        || !super::source_binding::authority::verify_stored_aggregate(source)
        || pit.receipt().locator() != &comparison.locator
    {
        return Err(PitSnapshotError::LocatorMismatch);
    }

    let fact = pit.fact();
    let source_fact = source.commit().fact();
    let snapshot_correction_rule_digest = derive_snapshot_correction_rule_digest(
        fact.request(),
        fact.evidence().correction_frontier.clone(),
    )?;
    let provenance_binding_digest = derive_provenance_binding_digest(source_fact)?;
    let license_binding_digest = derive_license_binding_digest(source_fact)?;

    if comparison.requester_identity != fact.request().requester_identity
        || comparison.request_identity != fact.request_identity()
        || comparison.request_digest != fact.request_digest()
        || comparison.scope_digest != fact.request().scope_digest
        || comparison.correlation_identity != fact.correlation_identity()
        || comparison.source_binding_identity != fact.source_binding_identity()
        || comparison.source_binding_fact_digest != source_fact.digest()
        || comparison.source_binding_lineage_root != fact.source_binding_lineage_root()
        || comparison.source_binding_lineage_version != fact.source_binding_lineage_version()
        || comparison.source_frontier != fact.evidence().source_frontier
        || comparison.correction_frontier != fact.evidence().correction_frontier
        || comparison.time_evidence != fact.request().time_evidence
        || comparison.snapshot_correction_rule_digest != snapshot_correction_rule_digest
        || comparison.provenance_binding_digest != provenance_binding_digest
        || comparison.license_binding_digest != license_binding_digest
        || source.commit().receipt().locator() != &fact.request().source_binding
        || source_fact.binding_id() != fact.source_binding_identity()
        || source_fact.lineage_root() != fact.source_binding_lineage_root()
        || source_fact.lineage_version() != fact.source_binding_lineage_version()
        || source_fact.proposal().source_frontier != fact.evidence().source_frontier
        || source_fact.proposal().correction_frontier != fact.evidence().correction_frontier
    {
        return Err(PitSnapshotError::ConsumerBindingMismatch);
    }

    let disposition = map_disposition(fact.disposition());
    let blockers = fact
        .blockers()
        .iter()
        .copied()
        .map(map_blocker)
        .collect::<Vec<_>>()
        .into_boxed_slice();
    let primary_blocker = fact.primary_blocker().map(map_blocker);
    let available = if fact.disposition() == PitSnapshotDisposition::Available
        && fact.blockers().is_empty()
        && primary_blocker.is_none()
        && source_fact.disposition()
            == super::source_binding::authority::SourceBindingDisposition::Admitted
    {
        Some(AvailableResearchPitSnapshot {
            snapshot_identity: fact.snapshot_identity(),
            normalized_records_digest: fact.evidence().normalized_records_digest,
        })
    } else if fact.disposition() == PitSnapshotDisposition::Available {
        return Err(PitSnapshotError::CanonicalBasisMismatch);
    } else {
        None
    };

    Ok(ResearchPitTerminal {
        disposition,
        blockers,
        primary_blocker,
        requester_identity: fact.request().requester_identity,
        request_identity: fact.request_identity(),
        request_digest: fact.request_digest(),
        scope_digest: fact.request().scope_digest,
        correlation_identity: fact.correlation_identity(),
        snapshot_identity: fact.snapshot_identity(),
        fact_digest: fact.digest(),
        source_binding_identity: fact.source_binding_identity(),
        source_binding_fact_digest: source_fact.digest(),
        source_binding_lineage_root: fact.source_binding_lineage_root(),
        source_binding_lineage_version: fact.source_binding_lineage_version(),
        source_frontier: fact.evidence().source_frontier.clone(),
        correction_frontier: fact.evidence().correction_frontier.clone(),
        correction_lineage_root: fact.lineage_root(),
        correction_lineage_version: fact.lineage_version(),
        time_evidence: fact.request().time_evidence.clone(),
        instrument_master_digest: fact.request().instrument_master_digest,
        universe_selection_digest: fact.request().universe_selection_digest,
        market_semantics_identity: fact.request().market_semantics_identity,
        snapshot_correction_rule_digest,
        provenance_binding_digest,
        license_binding_digest,
        available,
    })
}

pub(crate) fn derive_snapshot_correction_rule_digest(
    request: &UntrustedPitSnapshotRequest,
    correction_frontier: UntrustedCompleteFrontier,
) -> Result<BindingDigest, PitSnapshotError> {
    derive_digest(
        SNAPSHOT_CORRECTION_RULE_DOMAIN,
        &(
            request.scope_digest,
            request.source_binding.lineage_root,
            correction_frontier.stream_identity,
            request.instrument_master_digest,
            request.universe_selection_digest,
            request.market_semantics_identity,
        ),
    )
}

pub(crate) fn derive_provenance_binding_digest(
    source: &super::source_binding::authority::SourceBindingFact,
) -> Result<BindingDigest, PitSnapshotError> {
    let proposal = source.proposal();
    derive_digest(
        SOURCE_PROVENANCE_DOMAIN,
        &(
            &proposal.adapter,
            &proposal.trust_policy,
            &proposal.source_frontier,
        ),
    )
}

pub(crate) fn derive_license_binding_digest(
    source: &super::source_binding::authority::SourceBindingFact,
) -> Result<BindingDigest, PitSnapshotError> {
    derive_digest(LICENSE_BINDING_DOMAIN, &source.proposal().license)
}

fn derive_digest(
    value_domain: &[u8],
    value: &impl Serialize,
) -> Result<BindingDigest, PitSnapshotError> {
    let mut hasher = blake3::Hasher::new();
    hasher.update(value_domain);
    let bytes = serde_json::to_vec(value).map_err(|_| PitSnapshotError::CanonicalBasisMismatch)?;
    hasher.update(&bytes);
    Ok(BindingDigest::from_untrusted_bytes(
        *hasher.finalize().as_bytes(),
    ))
}

const fn map_disposition(value: PitSnapshotDisposition) -> ResearchPitDisposition {
    match value {
        PitSnapshotDisposition::Available => ResearchPitDisposition::Available,
        PitSnapshotDisposition::Unlicensed => ResearchPitDisposition::Unlicensed,
        PitSnapshotDisposition::Ambiguous => ResearchPitDisposition::Ambiguous,
        PitSnapshotDisposition::Stale => ResearchPitDisposition::Stale,
        PitSnapshotDisposition::Insufficient => ResearchPitDisposition::Insufficient,
        PitSnapshotDisposition::Unavailable => ResearchPitDisposition::Unavailable,
    }
}

const fn map_blocker(value: PitSnapshotBlocker) -> ResearchPitBlocker {
    match value {
        PitSnapshotBlocker::RightsUnlicensed => ResearchPitBlocker::RightsUnlicensed,
        PitSnapshotBlocker::IdentitySemanticsOrTimeAmbiguous => {
            ResearchPitBlocker::IdentitySemanticsOrTimeAmbiguous
        }
        PitSnapshotBlocker::EvidenceStale => ResearchPitBlocker::EvidenceStale,
        PitSnapshotBlocker::CoverageInsufficient => ResearchPitBlocker::CoverageInsufficient,
        PitSnapshotBlocker::SourceUnavailable => ResearchPitBlocker::SourceUnavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    #[rstest]
    fn public_terminal_vocabulary_preserves_all_canonical_states_and_blockers() {
        assert_eq!(
            [
                PitSnapshotDisposition::Available,
                PitSnapshotDisposition::Unlicensed,
                PitSnapshotDisposition::Ambiguous,
                PitSnapshotDisposition::Stale,
                PitSnapshotDisposition::Insufficient,
                PitSnapshotDisposition::Unavailable,
            ]
            .map(map_disposition),
            [
                ResearchPitDisposition::Available,
                ResearchPitDisposition::Unlicensed,
                ResearchPitDisposition::Ambiguous,
                ResearchPitDisposition::Stale,
                ResearchPitDisposition::Insufficient,
                ResearchPitDisposition::Unavailable,
            ]
        );
        assert_eq!(
            [
                PitSnapshotBlocker::RightsUnlicensed,
                PitSnapshotBlocker::IdentitySemanticsOrTimeAmbiguous,
                PitSnapshotBlocker::EvidenceStale,
                PitSnapshotBlocker::CoverageInsufficient,
                PitSnapshotBlocker::SourceUnavailable,
            ]
            .map(map_blocker),
            [
                ResearchPitBlocker::RightsUnlicensed,
                ResearchPitBlocker::IdentitySemanticsOrTimeAmbiguous,
                ResearchPitBlocker::EvidenceStale,
                ResearchPitBlocker::CoverageInsufficient,
                ResearchPitBlocker::SourceUnavailable,
            ]
        );
    }
}
