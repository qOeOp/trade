//! Backtest-bound, Owner-sealed replay-input read contract.
//!
//! Callers provide only exact comparison claims and one immutable PIT locator. Market Data rereads
//! and verifies the canonical PIT, Source Binding, Shared Time, and normalized observation batch
//! before returning ordered frames. No caller can submit frame bytes or a records/census digest.

use serde::Serialize;

use super::{
    pit_snapshot::{
        PitSnapshotCommitAggregate, PitSnapshotDisposition, PitSnapshotError,
        UntrustedPitSnapshotLocator, UntrustedPitSnapshotTimeEvidence, VerifiedPitObservation,
        VerifiedPitObservationBatch,
        authority::{verify_aggregate as verify_pit_aggregate, verify_terminal_basis},
    },
    research_pit_terminal::derive_snapshot_correction_rule_digest,
    source_binding::{
        BindingDigest, UntrustedCompleteFrontier,
        authority::{
            SourceBindingDisposition, SourceBindingStoredAggregate,
            verify_stored_aggregate as verify_source_aggregate,
        },
    },
};

const CONSUMER_ROLE: &str = "STRATEGY_FACTORY_RD_OWNER_API_V1";
const FRAME_DOMAIN: &[u8] = b"vibe.market-data.sealed-replay-input.frame.v1";
const FRAME_CENSUS_DOMAIN: &[u8] = b"vibe.market-data.sealed-replay-input.census.v1";

/// Caller-supplied exact replay-input comparison. It carries no positive Market Data authority.
///
/// Frame bytes, normalized-records digests, and frame-census digests are deliberately absent.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedSealedReplayInputRequest {
    /// Exact admitted read consumer. Other roles fail closed.
    pub consumer_role: String,
    /// Exact immutable PIT locator.
    pub locator: UntrustedPitSnapshotLocator,
    /// Request and scope facts repeated by the admitted replay request.
    pub request_identity: BindingDigest,
    pub request_digest: BindingDigest,
    pub scope_digest: BindingDigest,
    /// Exact requested inclusive-start/exclusive-end event-time window.
    pub window_start_event_time: u64,
    pub window_end_event_time_exclusive: u64,
    /// Exact source lineage and requested frontiers.
    pub source_binding_identity: BindingDigest,
    pub source_binding_lineage_root: BindingDigest,
    pub source_binding_lineage_version: u64,
    pub source_frontier: UntrustedCompleteFrontier,
    pub correction_frontier: UntrustedCompleteFrontier,
    /// Exact frozen instrument, universe, and market-meaning cuts.
    pub instrument_master_digest: BindingDigest,
    pub universe_selection_digest: BindingDigest,
    pub market_semantics_identity: BindingDigest,
    pub snapshot_correction_rule_digest: BindingDigest,
    /// Exact Source Binding admission rules repeated by the replay request.
    pub calendar_rules: String,
    pub session_rules: String,
    pub time_zone_rules: String,
    pub corporate_action_rules: String,
    pub historical_membership_rules: String,
}

/// One normalized Market Data frame in deterministic replay order.
///
/// Private fields and the absence of `Clone` and `Deserialize` prevent caller-side minting or
/// replay-input substitution.
#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct SealedReplayFrame {
    digest: BindingDigest,
    symbolic_key: String,
    member_key: String,
    instrument: String,
    channel: String,
    data_kind: String,
    timeframe: String,
    field: String,
    value_mantissa: i128,
    value_scale: u8,
    event_effective: u64,
    provider_available: u64,
    retrieval: u64,
    correction_publication: u64,
    correction_sequence: u64,
}

impl SealedReplayFrame {
    pub const fn digest(&self) -> BindingDigest {
        self.digest
    }
    pub fn symbolic_key(&self) -> &str {
        &self.symbolic_key
    }
    pub fn member_key(&self) -> &str {
        &self.member_key
    }
    pub fn instrument(&self) -> &str {
        &self.instrument
    }
    pub fn channel(&self) -> &str {
        &self.channel
    }
    pub fn data_kind(&self) -> &str {
        &self.data_kind
    }
    pub fn timeframe(&self) -> &str {
        &self.timeframe
    }
    pub fn field(&self) -> &str {
        &self.field
    }
    pub const fn value_mantissa(&self) -> i128 {
        self.value_mantissa
    }
    pub const fn value_scale(&self) -> u8 {
        self.value_scale
    }
    pub const fn event_effective(&self) -> u64 {
        self.event_effective
    }
    pub const fn provider_available(&self) -> u64 {
        self.provider_available
    }
    pub const fn retrieval(&self) -> u64 {
        self.retrieval
    }
    pub const fn correction_publication(&self) -> u64 {
        self.correction_publication
    }
    pub const fn correction_sequence(&self) -> u64 {
        self.correction_sequence
    }
}

/// Move-only Market Data-sealed replay input for one exact locator and replay window.
///
/// This type deliberately implements neither `Clone` nor `Deserialize`, and has no public
/// constructor.
///
/// ```compile_fail
/// use vibe_data::owner::sealed_replay_input::SealedReplayInput;
/// fn requires_clone<T: Clone>(_: &T) {}
/// fn duplicate(input: SealedReplayInput) { requires_clone(&input); }
/// ```
///
/// ```compile_fail
/// use vibe_data::owner::sealed_replay_input::SealedReplayInput;
/// let _forged: SealedReplayInput = serde_json::from_str("{}").unwrap();
/// ```
///
/// ```compile_fail
/// use vibe_data::owner::sealed_replay_input::SealedReplayInput;
/// let _forged = SealedReplayInput {};
/// ```
#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct SealedReplayInput {
    request_identity: BindingDigest,
    request_digest: BindingDigest,
    scope_digest: BindingDigest,
    snapshot_identity: BindingDigest,
    snapshot_fact_digest: BindingDigest,
    source_binding_identity: BindingDigest,
    source_binding_lineage_root: BindingDigest,
    source_binding_lineage_version: u64,
    correction_lineage_root: BindingDigest,
    correction_lineage_version: u64,
    source_frontier: UntrustedCompleteFrontier,
    correction_frontier: UntrustedCompleteFrontier,
    instrument_master_digest: BindingDigest,
    universe_selection_digest: BindingDigest,
    market_semantics_identity: BindingDigest,
    normalized_records_digest: BindingDigest,
    frame_census_digest: BindingDigest,
    snapshot_correction_rule_digest: BindingDigest,
    time_evidence: UntrustedPitSnapshotTimeEvidence,
    window_start_event_time: u64,
    window_end_event_time_exclusive: u64,
    calendar_rules: String,
    session_rules: String,
    time_zone_rules: String,
    corporate_action_rules: String,
    historical_membership_rules: String,
    frames: Box<[SealedReplayFrame]>,
}

impl SealedReplayInput {
    pub const fn request_identity(&self) -> BindingDigest {
        self.request_identity
    }
    pub const fn request_digest(&self) -> BindingDigest {
        self.request_digest
    }
    pub const fn scope_digest(&self) -> BindingDigest {
        self.scope_digest
    }
    pub const fn snapshot_identity(&self) -> BindingDigest {
        self.snapshot_identity
    }
    pub const fn snapshot_fact_digest(&self) -> BindingDigest {
        self.snapshot_fact_digest
    }
    pub const fn source_binding_identity(&self) -> BindingDigest {
        self.source_binding_identity
    }
    pub const fn source_binding_lineage_root(&self) -> BindingDigest {
        self.source_binding_lineage_root
    }
    pub const fn source_binding_lineage_version(&self) -> u64 {
        self.source_binding_lineage_version
    }
    pub const fn correction_lineage_root(&self) -> BindingDigest {
        self.correction_lineage_root
    }
    pub const fn correction_lineage_version(&self) -> u64 {
        self.correction_lineage_version
    }
    pub const fn source_frontier(&self) -> &UntrustedCompleteFrontier {
        &self.source_frontier
    }
    pub const fn correction_frontier(&self) -> &UntrustedCompleteFrontier {
        &self.correction_frontier
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
    pub const fn normalized_records_digest(&self) -> BindingDigest {
        self.normalized_records_digest
    }
    pub const fn frame_census_digest(&self) -> BindingDigest {
        self.frame_census_digest
    }
    pub const fn snapshot_correction_rule_digest(&self) -> BindingDigest {
        self.snapshot_correction_rule_digest
    }
    pub const fn time_evidence(&self) -> &UntrustedPitSnapshotTimeEvidence {
        &self.time_evidence
    }
    pub const fn window_start_event_time(&self) -> u64 {
        self.window_start_event_time
    }
    pub const fn window_end_event_time_exclusive(&self) -> u64 {
        self.window_end_event_time_exclusive
    }
    pub fn calendar_rules(&self) -> &str {
        &self.calendar_rules
    }
    pub fn session_rules(&self) -> &str {
        &self.session_rules
    }
    pub fn time_zone_rules(&self) -> &str {
        &self.time_zone_rules
    }
    pub fn corporate_action_rules(&self) -> &str {
        &self.corporate_action_rules
    }
    pub fn historical_membership_rules(&self) -> &str {
        &self.historical_membership_rules
    }
    pub fn frames(&self) -> &[SealedReplayFrame] {
        &self.frames
    }
}

pub(crate) mod sealed {
    pub trait Sealed {}
}

/// Read-only resolver whose implementations remain sealed inside Market Data.
#[async_trait::async_trait]
#[allow(private_bounds)]
pub trait SealedReplayInputResolver: sealed::Sealed + Send + Sync {
    async fn resolve_sealed_replay_input(
        &self,
        request: &UntrustedSealedReplayInputRequest,
    ) -> Result<SealedReplayInput, PitSnapshotError>;
}

pub(crate) fn seal_replay_input(
    pit: &PitSnapshotCommitAggregate,
    source: &SourceBindingStoredAggregate,
    batch: &VerifiedPitObservationBatch,
    comparison: &UntrustedSealedReplayInputRequest,
) -> Result<SealedReplayInput, PitSnapshotError> {
    let fact = pit.fact();
    let source_fact = source.commit().fact();
    let semantics = &source_fact.proposal().semantics;
    let correction_rule = derive_snapshot_correction_rule_digest(
        fact.request(),
        fact.evidence().correction_frontier.clone(),
    )?;

    if comparison.consumer_role != CONSUMER_ROLE {
        return Err(PitSnapshotError::ConsumerRoleMismatch);
    }

    if !verify_pit_aggregate(pit)
        || !verify_source_aggregate(source)
        || !verify_terminal_basis(pit, source_fact)
        || pit.receipt().locator() != &comparison.locator
        || fact.disposition() != PitSnapshotDisposition::Available
        || !fact.blockers().is_empty()
        || fact.primary_blocker().is_some()
        || source_fact.disposition() != SourceBindingDisposition::Admitted
        || comparison.window_start_event_time >= comparison.window_end_event_time_exclusive
    {
        return Err(PitSnapshotError::ConsumerBindingMismatch);
    }

    if comparison.request_identity != fact.request_identity()
        || comparison.request_digest != fact.request_digest()
        || comparison.scope_digest != fact.request().scope_digest
        || comparison.source_binding_identity != fact.source_binding_identity()
        || comparison.source_binding_lineage_root != fact.source_binding_lineage_root()
        || comparison.source_binding_lineage_version != fact.source_binding_lineage_version()
        || comparison.source_frontier != fact.evidence().source_frontier
        || comparison.correction_frontier != fact.evidence().correction_frontier
        || comparison.instrument_master_digest != fact.request().instrument_master_digest
        || comparison.universe_selection_digest != fact.request().universe_selection_digest
        || comparison.market_semantics_identity != fact.request().market_semantics_identity
        || comparison.snapshot_correction_rule_digest != correction_rule
        || comparison.calendar_rules != semantics.calendar_rules
        || comparison.session_rules != semantics.session_rules
        || comparison.time_zone_rules != semantics.timezone_rules
        || comparison.corporate_action_rules != semantics.corporate_action_rules
        || comparison.historical_membership_rules != semantics.membership_rules
        || batch.request_identity() != fact.request_identity()
        || batch.request_digest() != fact.request_digest()
        || batch.snapshot_identity() != fact.snapshot_identity()
        || batch.fact_digest() != fact.digest()
        || batch.source_binding_identity() != fact.source_binding_identity()
        || batch.source_binding_lineage_root() != fact.source_binding_lineage_root()
        || batch.source_binding_lineage_version() != fact.source_binding_lineage_version()
        || batch.source_frontier_digest() != fact.evidence().source_frontier.digest
        || batch.correction_frontier_digest() != fact.evidence().correction_frontier.digest
        || batch.instrument_master_digest() != fact.request().instrument_master_digest
        || batch.universe_selection_digest() != fact.request().universe_selection_digest
        || batch.market_semantics_identity() != fact.request().market_semantics_identity
        || batch.time_evidence() != &fact.request().time_evidence
        || batch.digest() != fact.evidence().normalized_records_digest
    {
        return Err(PitSnapshotError::ConsumerBindingMismatch);
    }

    let mut frames = batch
        .observations()
        .iter()
        .map(seal_frame)
        .collect::<Result<Vec<_>, _>>()?;
    frames.sort_by(|left, right| replay_order(left).cmp(&replay_order(right)));

    if frames.is_empty()
        || frames.iter().any(|frame| {
            frame.event_effective < comparison.window_start_event_time
                || frame.event_effective >= comparison.window_end_event_time_exclusive
        })
        || frames
            .windows(2)
            .any(|pair| replay_order(&pair[0]) >= replay_order(&pair[1]))
    {
        return Err(PitSnapshotError::ObservationBatchUnavailable);
    }

    let frame_digests = frames.iter().map(|frame| frame.digest).collect::<Vec<_>>();
    let frame_census_digest = derive_digest(
        FRAME_CENSUS_DOMAIN,
        &(
            fact.snapshot_identity(),
            fact.digest(),
            batch.digest(),
            comparison.window_start_event_time,
            comparison.window_end_event_time_exclusive,
            &frame_digests,
        ),
    )?;

    Ok(SealedReplayInput {
        request_identity: fact.request_identity(),
        request_digest: fact.request_digest(),
        scope_digest: fact.request().scope_digest,
        snapshot_identity: fact.snapshot_identity(),
        snapshot_fact_digest: fact.digest(),
        source_binding_identity: fact.source_binding_identity(),
        source_binding_lineage_root: fact.source_binding_lineage_root(),
        source_binding_lineage_version: fact.source_binding_lineage_version(),
        correction_lineage_root: fact.lineage_root(),
        correction_lineage_version: fact.lineage_version(),
        source_frontier: fact.evidence().source_frontier.clone(),
        correction_frontier: fact.evidence().correction_frontier.clone(),
        instrument_master_digest: fact.request().instrument_master_digest,
        universe_selection_digest: fact.request().universe_selection_digest,
        market_semantics_identity: fact.request().market_semantics_identity,
        normalized_records_digest: batch.digest(),
        frame_census_digest,
        snapshot_correction_rule_digest: correction_rule,
        time_evidence: fact.request().time_evidence.clone(),
        window_start_event_time: comparison.window_start_event_time,
        window_end_event_time_exclusive: comparison.window_end_event_time_exclusive,
        calendar_rules: semantics.calendar_rules.clone(),
        session_rules: semantics.session_rules.clone(),
        time_zone_rules: semantics.timezone_rules.clone(),
        corporate_action_rules: semantics.corporate_action_rules.clone(),
        historical_membership_rules: semantics.membership_rules.clone(),
        frames: frames.into_boxed_slice(),
    })
}

fn seal_frame(row: &VerifiedPitObservation) -> Result<SealedReplayFrame, PitSnapshotError> {
    let digest = derive_digest(
        FRAME_DOMAIN,
        &FrameDigestBasis {
            symbolic_key: row.symbolic_key(),
            member_key: row.member_key(),
            instrument: row.instrument(),
            channel: row.channel(),
            data_kind: row.data_kind(),
            timeframe: row.timeframe(),
            field: row.field(),
            value_mantissa: row.value_mantissa(),
            value_scale: row.value_scale(),
            event_effective: row.event_effective(),
            provider_available: row.provider_available(),
            retrieval: row.retrieval(),
            correction_publication: row.correction_publication(),
            correction_sequence: row.correction_sequence(),
            source_binding_identity: row.source_binding_identity(),
            source_frontier_digest: row.source_frontier_digest(),
            instrument_master_digest: row.instrument_master_digest(),
            universe_selection_digest: row.universe_selection_digest(),
            market_semantics_identity: row.market_semantics_identity(),
            correction_stream_identity: row.correction_stream_identity(),
            correction_frontier_digest: row.correction_frontier_digest(),
        },
    )?;
    Ok(SealedReplayFrame {
        digest,
        symbolic_key: row.symbolic_key().to_owned(),
        member_key: row.member_key().to_owned(),
        instrument: row.instrument().to_owned(),
        channel: row.channel().to_owned(),
        data_kind: row.data_kind().to_owned(),
        timeframe: row.timeframe().to_owned(),
        field: row.field().to_owned(),
        value_mantissa: row.value_mantissa(),
        value_scale: row.value_scale(),
        event_effective: row.event_effective(),
        provider_available: row.provider_available(),
        retrieval: row.retrieval(),
        correction_publication: row.correction_publication(),
        correction_sequence: row.correction_sequence(),
    })
}

#[derive(Serialize)]
struct FrameDigestBasis<'a> {
    symbolic_key: &'a str,
    member_key: &'a str,
    instrument: &'a str,
    channel: &'a str,
    data_kind: &'a str,
    timeframe: &'a str,
    field: &'a str,
    value_mantissa: i128,
    value_scale: u8,
    event_effective: u64,
    provider_available: u64,
    retrieval: u64,
    correction_publication: u64,
    correction_sequence: u64,
    source_binding_identity: BindingDigest,
    source_frontier_digest: BindingDigest,
    instrument_master_digest: BindingDigest,
    universe_selection_digest: BindingDigest,
    market_semantics_identity: BindingDigest,
    correction_stream_identity: &'a str,
    correction_frontier_digest: BindingDigest,
}

fn replay_order(frame: &SealedReplayFrame) -> (u64, u64, u64, &str, &str, &str, &str, &str, &str) {
    (
        frame.event_effective,
        frame.correction_publication,
        frame.correction_sequence,
        &frame.instrument,
        &frame.channel,
        &frame.data_kind,
        &frame.timeframe,
        &frame.field,
        &frame.member_key,
    )
}

fn derive_digest(domain: &[u8], value: &impl Serialize) -> Result<BindingDigest, PitSnapshotError> {
    let bytes = serde_json::to_vec(value).map_err(|_| PitSnapshotError::CanonicalBasisMismatch)?;
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain);
    hasher.update(&bytes);
    Ok(BindingDigest::from_untrusted_bytes(
        *hasher.finalize().as_bytes(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    #[rstest]
    fn consumer_role_is_fixed_to_the_admitted_store_consumer() {
        assert_eq!(CONSUMER_ROLE, "STRATEGY_FACTORY_RD_OWNER_API_V1");
    }
}
