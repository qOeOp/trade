//! Complete, canonically ordered EVENT corpus sealed by Market Data.
//!
//! This additive boundary consumes a new Owner-issued EVENT source plus unchanged joined-cut and V2
//! sample projection receipts. It does not reinterpret or re-encode any predecessor receipt. A
//! positive corpus exists only when those receipts cover every EVENT coordinate in the complete
//! source census exactly once and in the Owner-canonical native event order.

use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Debug,
};

use sha2::{Digest, Sha256};

use super::{
    pit_snapshot::VerifiedPitObservationBatch,
    sample_projection::{
        StrategyInputSampleProjectionKindV2, StrategyInputSampleProjectionReadbackV2,
    },
    sealed_replay_input::SealedReplayInput,
    source_binding::BindingDigest,
    strategy_input_binding::{
        StrategyInputBindingReceipt, StrategyInputBindingUnavailable,
        StrategyInputEventFrameReceipt, StrategyInputEventKind, StrategyInputEventValueReceipt,
        StrategyInputLifecycleProjection, bind_complete_strategy_input_event_frame,
    },
    strategy_input_joined_cut::{
        StrategyInputJoinedCutComponentV1, StrategyInputJoinedCutReceiptV1,
    },
};

const CORPUS_DOMAIN: &[u8] = b"vibe.market-data.strategy-input-event-corpus.v1\0";
const SOURCE_DOMAIN: &[u8] = b"vibe.market-data.strategy-input-event-source.v1\0";
const PACKAGE_DOMAIN: &[u8] = b"vibe.market-data.strategy-input-event-replay-package.v1\0";

/// Move-only Owner source for the complete native EVENT census.
///
/// Callers cannot construct or clone this value. Market Data issues it only from event-frame
/// receipts that were themselves resolved from verified PIT observation batches.
pub struct StrategyInputEventSourceV1 {
    frames: Box<[StrategyInputEventFrameReceipt]>,
    authorities: Box<[StrategyInputEventAuthorityV1]>,
    digest: BindingDigest,
}

struct StrategyInputEventAuthorityV1 {
    request_identity: BindingDigest,
    request_digest: BindingDigest,
    snapshot_identity: BindingDigest,
    snapshot_fact_digest: BindingDigest,
    observation_batch_digest: BindingDigest,
    source_binding_identity: BindingDigest,
    source_binding_lineage_root: BindingDigest,
    source_binding_lineage_version: u64,
    source_frontier_digest: BindingDigest,
    correction_frontier_digest: BindingDigest,
    correction_stream_identity: String,
    instrument_master_digest: BindingDigest,
    universe_selection_digest: BindingDigest,
    market_semantics_identity: BindingDigest,
    observation_count: usize,
}

impl Debug for StrategyInputEventSourceV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(StrategyInputEventSourceV1))
            .field("frame_count", &self.frames.len())
            .field("digest", &self.digest)
            .finish_non_exhaustive()
    }
}

/// Seals the exact Owner-issued frames produced from verified PIT batches into one source.
#[allow(
    dead_code,
    reason = "the first production caller is the feature-gated Owner acceptance issuer"
)]
pub(in crate::owner) fn issue_strategy_input_event_source_v1(
    bindings: &[StrategyInputBindingReceipt],
    batches: &[VerifiedPitObservationBatch],
) -> Result<StrategyInputEventSourceV1, StrategyInputBindingUnavailable> {
    if batches.len() < 2 || bindings.len() != 4 {
        return Err(StrategyInputBindingUnavailable::MissingLifecycleCoordinate);
    }
    let mut frames = Vec::with_capacity(batches.len());
    let mut authorities = Vec::with_capacity(batches.len());
    for batch in batches {
        frames.push(bind_complete_strategy_input_event_frame(bindings, batch)?);
        authorities.push(event_authority(batch)?);
    }

    if frames.is_empty()
        || frames.iter().any(|frame| {
            frame.trigger().lifecycle().kind() != StrategyInputEventKind::Event
                || frame.values().is_empty()
                || frame.values().len() != 4
                || frame.values().iter().any(|value| {
                    value.trigger_digest() != frame.trigger().digest()
                        || value.observation_batch_digest()
                            != frame.trigger().observation_batch_digest()
                })
        })
    {
        return Err(StrategyInputBindingUnavailable::MissingLifecycleCoordinate);
    }
    let mut prior = None;
    let mut trigger_digests = BTreeSet::new();

    for frame in &frames {
        let lifecycle = frame.trigger().lifecycle();
        let key = (
            lifecycle.logical_time(),
            lifecycle.event_time(),
            lifecycle.owner_sequence(),
            lifecycle.event_identity(),
            frame.trigger().digest(),
        );

        if prior.is_some_and(|previous| previous >= key)
            || !trigger_digests.insert(frame.trigger().digest())
        {
            return Err(StrategyInputBindingUnavailable::NonUniqueResolution);
        }
        prior = Some(key);
    }
    let first = &authorities[0];
    if authorities.iter().any(|authority| {
        authority.source_binding_identity != first.source_binding_identity
            || authority.source_binding_lineage_root != first.source_binding_lineage_root
            || authority.source_binding_lineage_version != first.source_binding_lineage_version
            || authority.source_frontier_digest != first.source_frontier_digest
            || authority.correction_frontier_digest != first.correction_frontier_digest
            || authority.correction_stream_identity != first.correction_stream_identity
            || authority.instrument_master_digest != first.instrument_master_digest
            || authority.universe_selection_digest != first.universe_selection_digest
            || authority.market_semantics_identity != first.market_semantics_identity
    }) {
        return Err(StrategyInputBindingUnavailable::StaleBatch);
    }
    let digest = event_source_digest(&frames);
    Ok(StrategyInputEventSourceV1 {
        frames: frames.into_boxed_slice(),
        authorities: authorities.into_boxed_slice(),
        digest,
    })
}

fn event_authority(
    batch: &VerifiedPitObservationBatch,
) -> Result<StrategyInputEventAuthorityV1, StrategyInputBindingUnavailable> {
    let correction_stream_identity = batch
        .observations()
        .first()
        .map(|row| row.correction_stream_identity().to_owned())
        .ok_or(StrategyInputBindingUnavailable::MissingLifecycleCoordinate)?;

    if batch
        .observations()
        .iter()
        .any(|row| row.correction_stream_identity() != correction_stream_identity)
    {
        return Err(StrategyInputBindingUnavailable::NonUniqueResolution);
    }
    Ok(StrategyInputEventAuthorityV1 {
        request_identity: batch.request_identity(),
        request_digest: batch.request_digest(),
        snapshot_identity: batch.snapshot_identity(),
        snapshot_fact_digest: batch.fact_digest(),
        observation_batch_digest: batch.digest(),
        source_binding_identity: batch.source_binding_identity(),
        source_binding_lineage_root: batch.source_binding_lineage_root(),
        source_binding_lineage_version: batch.source_binding_lineage_version(),
        source_frontier_digest: batch.source_frontier_digest(),
        correction_frontier_digest: batch.correction_frontier_digest(),
        correction_stream_identity,
        instrument_master_digest: batch.instrument_master_digest(),
        universe_selection_digest: batch.universe_selection_digest(),
        market_semantics_identity: batch.market_semantics_identity(),
        observation_count: batch.observations().len(),
    })
}

/// One proposed pairing of existing Owner-issued receipts.
///
/// Construction is not authority: [`issue_strategy_input_event_corpus_v1`] independently checks
/// complete-set coverage and all receipt relationships against the sealed EVENT source.
pub struct StrategyInputEventCorpusCandidateV1 {
    joined_cut: StrategyInputJoinedCutReceiptV1,
    projection: StrategyInputSampleProjectionReadbackV2,
}

impl Debug for StrategyInputEventCorpusCandidateV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(StrategyInputEventCorpusCandidateV1))
            .finish_non_exhaustive()
    }
}

impl StrategyInputEventCorpusCandidateV1 {
    #[must_use]
    pub const fn new(
        joined_cut: StrategyInputJoinedCutReceiptV1,
        projection: StrategyInputSampleProjectionReadbackV2,
    ) -> Self {
        Self {
            joined_cut,
            projection,
        }
    }
}

/// One non-spliceable corpus member retaining every predecessor receipt.
pub struct StrategyInputEventCorpusMemberV1 {
    joined_cut: StrategyInputJoinedCutReceiptV1,
    projection: StrategyInputSampleProjectionReadbackV2,
    order_key: StrategyInputLifecycleProjection,
}

impl Debug for StrategyInputEventCorpusMemberV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(StrategyInputEventCorpusMemberV1))
            .field("order_key", &self.order_key)
            .finish_non_exhaustive()
    }
}

impl StrategyInputEventCorpusMemberV1 {
    #[must_use]
    pub const fn joined_cut(&self) -> &StrategyInputJoinedCutReceiptV1 {
        &self.joined_cut
    }

    #[must_use]
    pub const fn projection(&self) -> &StrategyInputSampleProjectionReadbackV2 {
        &self.projection
    }

    #[must_use]
    pub const fn order_key(&self) -> StrategyInputLifecycleProjection {
        self.order_key
    }
}

/// Move-only Market Data Owner receipt for one complete ordered EVENT replay corpus.
///
/// It has private fields, no public constructor, and implements neither `Clone` nor a Serde trait.
/// The retained [`StrategyInputEventSourceV1`] is the complete-set authority; callers cannot mint a positive
/// corpus by submitting a selected receipt subset.
///
/// ```compile_fail
/// use vibe_data::owner::strategy_input_event_corpus_v1::StrategyInputEventCorpusV1;
/// let _ = StrategyInputEventCorpusV1 {};
/// ```
///
/// ```compile_fail
/// use vibe_data::owner::strategy_input_event_corpus_v1::StrategyInputEventCorpusV1;
/// fn requires_clone<T: Clone>() {}
/// requires_clone::<StrategyInputEventCorpusV1>();
/// ```
///
/// ```compile_fail
/// use vibe_data::owner::strategy_input_event_corpus_v1::StrategyInputEventCorpusV1;
/// fn requires_deserialize<T: for<'de> serde::Deserialize<'de>>() {}
/// requires_deserialize::<StrategyInputEventCorpusV1>();
/// ```
pub struct StrategyInputEventCorpusV1 {
    source: StrategyInputEventSourceV1,
    members: Box<[StrategyInputEventCorpusMemberV1]>,
    digest: BindingDigest,
}

impl Debug for StrategyInputEventCorpusV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(StrategyInputEventCorpusV1))
            .field("expected_count", &self.members.len())
            .field("digest", &self.digest)
            .finish_non_exhaustive()
    }
}

impl StrategyInputEventCorpusV1 {
    #[must_use]
    pub const fn source_digest(&self) -> BindingDigest {
        self.source.digest
    }

    #[must_use]
    pub fn members(&self) -> &[StrategyInputEventCorpusMemberV1] {
        &self.members
    }

    #[must_use]
    pub fn expected_count(&self) -> usize {
        self.members.len()
    }

    #[must_use]
    pub const fn digest(&self) -> BindingDigest {
        self.digest
    }

    /// Rechecks the complete corpus identity without exposing any predecessor receipt for mutation.
    #[must_use]
    pub fn has_valid_digest(&self) -> bool {
        self.source.digest == event_source_digest(&self.source.frames)
            && self.source.frames.len() >= 2
            && self.source.frames.len() == self.source.authorities.len()
            && self
                .source
                .frames
                .iter()
                .zip(&self.source.authorities)
                .all(|(frame, authority)| {
                    frame.values().len() == 4
                        && frame.trigger().observation_batch_digest()
                            == authority.observation_batch_digest
                        && frame.trigger().snapshot_identity() == authority.snapshot_identity
                        && frame.trigger().snapshot_fact_digest() == authority.snapshot_fact_digest
                })
            && self.digest == corpus_digest(&self.source, &self.members)
    }
}

/// Move-only Market Data package atomically binding replay authority to its complete EVENT corpus.
///
/// The package has no public constructor, implements neither `Clone` nor a Serde trait, and cannot
/// be assembled from independently obtained values outside Market Data ownership.
///
/// ```compile_fail
/// use vibe_data::owner::strategy_input_event_corpus_v1::StrategyInputEventReplayPackageV1;
/// fn requires_clone<T: Clone>() {}
/// requires_clone::<StrategyInputEventReplayPackageV1>();
/// ```
///
/// ```compile_fail
/// use vibe_data::owner::strategy_input_event_corpus_v1::StrategyInputEventReplayPackageV1;
/// fn requires_deserialize<T: for<'de> serde::Deserialize<'de>>() {}
/// requires_deserialize::<StrategyInputEventReplayPackageV1>();
/// ```
pub struct StrategyInputEventReplayPackageV1 {
    replay_input: SealedReplayInput,
    corpus: StrategyInputEventCorpusV1,
    digest: BindingDigest,
}

impl Debug for StrategyInputEventReplayPackageV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(StrategyInputEventReplayPackageV1))
            .field("corpus_digest", &self.corpus.digest())
            .field("digest", &self.digest)
            .finish_non_exhaustive()
    }
}

impl StrategyInputEventReplayPackageV1 {
    #[must_use]
    pub const fn digest(&self) -> BindingDigest {
        self.digest
    }

    #[must_use]
    pub fn has_valid_digest(&self) -> bool {
        self.corpus.has_valid_digest()
            && self.digest == event_replay_package_digest(&self.replay_input, &self.corpus)
    }

    /// Borrows the inseparable replay anchor for downstream validation.
    #[must_use]
    pub const fn replay_input(&self) -> &SealedReplayInput {
        &self.replay_input
    }

    /// Borrows the inseparable complete corpus for downstream validation and observation.
    #[must_use]
    pub const fn corpus(&self) -> &StrategyInputEventCorpusV1 {
        &self.corpus
    }

    /// Consumes the package inside the Market Data Owner without weakening its atomic binding.
    #[cfg(feature = "isolated-event-replay-acceptance")]
    pub(in crate::owner) fn into_owner_parts(
        self,
    ) -> (SealedReplayInput, StrategyInputEventCorpusV1) {
        (self.replay_input, self.corpus)
    }
}

/// Atomically seals the terminal replay anchor and its complete ordered EVENT corpus.
///
/// The source is itself move-only Owner authority, so callers cannot combine independently
/// selected raw batches or frames. The replay anchor must identify the source's unique terminal
/// batch exactly.
///
/// # Errors
///
/// Returns a fail-closed corpus category without issuing a package.
pub fn issue_strategy_input_event_replay_package_v1(
    replay_input: SealedReplayInput,
    source: StrategyInputEventSourceV1,
    bindings: &[StrategyInputBindingReceipt],
    candidates: Vec<StrategyInputEventCorpusCandidateV1>,
) -> Result<StrategyInputEventReplayPackageV1, StrategyInputEventCorpusUnavailableV1> {
    if !replay_matches_event_authority(&replay_input, &source) {
        return Err(StrategyInputEventCorpusUnavailableV1::CrossSplice);
    }
    let corpus = issue_strategy_input_event_corpus_v1(source, bindings, candidates)?;
    let digest = event_replay_package_digest(&replay_input, &corpus);
    Ok(StrategyInputEventReplayPackageV1 {
        replay_input,
        corpus,
        digest,
    })
}

fn replay_matches_event_authority(
    replay: &SealedReplayInput,
    source: &StrategyInputEventSourceV1,
) -> bool {
    let Some(authority) = source.authorities.last() else {
        return false;
    };

    if source
        .authorities
        .iter()
        .filter(|candidate| {
            candidate.snapshot_identity == replay.snapshot_identity()
                && candidate.snapshot_fact_digest == replay.snapshot_fact_digest()
                && candidate.observation_batch_digest == replay.normalized_records_digest()
        })
        .count()
        != 1
    {
        return false;
    }
    replay.request_identity() == authority.request_identity
        && replay.request_digest() == authority.request_digest
        && replay.snapshot_identity() == authority.snapshot_identity
        && replay.snapshot_fact_digest() == authority.snapshot_fact_digest
        && replay.normalized_records_digest() == authority.observation_batch_digest
        && replay.source_binding_identity() == authority.source_binding_identity
        && replay.source_binding_lineage_root() == authority.source_binding_lineage_root
        && replay.source_binding_lineage_version() == authority.source_binding_lineage_version
        && replay.source_frontier().digest == authority.source_frontier_digest
        && replay.correction_frontier().digest == authority.correction_frontier_digest
        && replay.correction_frontier().stream_identity == authority.correction_stream_identity
        && replay.instrument_master_digest() == authority.instrument_master_digest
        && replay.universe_selection_digest() == authority.universe_selection_digest
        && replay.market_semantics_identity() == authority.market_semantics_identity
        && replay.observation_start_event_time()
            == source
                .frames
                .last()
                .map_or(0, |frame| frame.trigger().lifecycle().event_time())
        && replay.observation_end_event_time() == replay.observation_start_event_time()
        && replay.frames().len() == authority.observation_count
}

fn event_replay_package_digest(
    replay: &SealedReplayInput,
    corpus: &StrategyInputEventCorpusV1,
) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(PACKAGE_DOMAIN);
    hasher.update(replay.request_identity().as_bytes());
    hasher.update(replay.request_digest().as_bytes());
    hasher.update(replay.snapshot_identity().as_bytes());
    hasher.update(replay.snapshot_fact_digest().as_bytes());
    hasher.update(replay.normalized_records_digest().as_bytes());
    hasher.update(replay.frame_census_digest().as_bytes());
    hasher.update(corpus.source_digest().as_bytes());
    hasher.update(corpus.digest().as_bytes());
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

/// Untrusted locator for one durable request-to-EVENT binding.
///
/// The R&D request coordinates remain byte-for-byte strings from the sealed R&D readback. The
/// Market Data binding identity is content-addressed over those coordinates, the selected native
/// event, and the complete ordered EVENT census. Constructing this locator confers no authority.
#[derive(Clone, Debug, Eq, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct StrategyInputEventBindingLocatorV1 {
    request_identity: Box<str>,
    request_meaning_digest: Box<str>,
    binding_identity: BindingDigest,
}

impl StrategyInputEventBindingLocatorV1 {
    #[must_use]
    pub fn from_untrusted(
        request_identity: impl Into<Box<str>>,
        request_meaning_digest: impl Into<Box<str>>,
        binding_identity: BindingDigest,
    ) -> Self {
        Self {
            request_identity: request_identity.into(),
            request_meaning_digest: request_meaning_digest.into(),
            binding_identity,
        }
    }

    #[must_use]
    pub fn request_identity(&self) -> &str {
        &self.request_identity
    }

    #[must_use]
    pub fn request_meaning_digest(&self) -> &str {
        &self.request_meaning_digest
    }

    #[must_use]
    pub const fn binding_identity(&self) -> BindingDigest {
        self.binding_identity
    }
}

/// Exact durable Market Data readback for one sealed R&D request and complete EVENT census.
///
/// This move-only value has no public constructor and no deserializer. The bytes are returned
/// exactly as stored so response-loss recovery and restart recovery cannot reconstruct a positive
/// result from caller-authored fields.
#[derive(Debug, Eq, PartialEq)]
pub(in crate::owner) struct StrategyInputEventBindingReadbackV1 {
    pub(in crate::owner) locator: StrategyInputEventBindingLocatorV1,
    pub(in crate::owner) receipt_identity: BindingDigest,
    pub(in crate::owner) readback_identity: BindingDigest,
    pub(in crate::owner) projection_receipt_digest: BindingDigest,
    pub(in crate::owner) selected_event_identity: [u8; 16],
    pub(in crate::owner) census_digest: BindingDigest,
    pub(in crate::owner) event_count: usize,
    pub(in crate::owner) canonical_bytes: Box<[u8]>,
}

impl StrategyInputEventBindingReadbackV1 {
    #[must_use]
    pub(in crate::owner) const fn locator(&self) -> &StrategyInputEventBindingLocatorV1 {
        &self.locator
    }

    #[must_use]
    pub(in crate::owner) const fn receipt_identity(&self) -> BindingDigest {
        self.receipt_identity
    }

    #[must_use]
    pub(in crate::owner) const fn readback_identity(&self) -> BindingDigest {
        self.readback_identity
    }

    #[must_use]
    pub(in crate::owner) const fn projection_receipt_digest(&self) -> BindingDigest {
        self.projection_receipt_digest
    }

    #[must_use]
    pub(in crate::owner) const fn selected_event_identity(&self) -> [u8; 16] {
        self.selected_event_identity
    }

    #[must_use]
    pub(in crate::owner) const fn census_digest(&self) -> BindingDigest {
        self.census_digest
    }

    #[must_use]
    pub(in crate::owner) const fn event_count(&self) -> usize {
        self.event_count
    }

    #[must_use]
    pub(in crate::owner) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

/// Fail-closed durable binding categories. No error contains a partial binding or census.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum StrategyInputEventBindingErrorV1 {
    #[error("the sealed R&D request is unavailable from its fixed Owner port")]
    RequestUnavailable,
    #[error("the sealed R&D request evidence is invalid")]
    InvalidRequest,
    #[error("the complete EVENT corpus or selected event is invalid")]
    InvalidEventCensus,
    #[error("the exact sample projection custody is unavailable")]
    ProjectionUnavailable,
    #[error("the request identity or meaning conflicts with durable custody")]
    ReplayConflict,
    #[error("the durable request-to-EVENT binding is unknown")]
    UnknownBinding,
    #[error("the durable request-to-EVENT binding store is unavailable or corrupt")]
    StoreUnavailable,
    #[error("the transaction was rolled back before commit")]
    CommitInterrupted,
    #[error("the binding committed but its response was lost")]
    ResponseLost,
}

/// Fail-closed issuance categories. No error contains a partial corpus.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum StrategyInputEventCorpusUnavailableV1 {
    #[error("the complete EVENT census is unavailable")]
    IncompleteCensus,
    #[error("a BAR or unsupported lifecycle was supplied to the EVENT corpus")]
    UnsupportedLifecycle,
    #[error("the EVENT corpus is not in canonical native order")]
    NonCanonicalOrder,
    #[error("duplicate EVENT corpus evidence was supplied")]
    Duplicate,
    #[error("EVENT corpus receipts do not describe one Owner census")]
    CrossSplice,
}

/// Seals every EVENT in one complete Owner source census into canonical native order.
///
/// Candidates must already be in `(logical_time, event_time, owner_sequence, event_identity)`
/// order. Market Data rejects rather than silently sorting because arrival order is part of the
/// anti-splice admission boundary.
///
/// # Errors
///
/// Returns a fail-closed category before any positive corpus exists.
pub fn issue_strategy_input_event_corpus_v1(
    source: StrategyInputEventSourceV1,
    bindings: &[StrategyInputBindingReceipt],
    candidates: Vec<StrategyInputEventCorpusCandidateV1>,
) -> Result<StrategyInputEventCorpusV1, StrategyInputEventCorpusUnavailableV1> {
    let binding_by_role = bindings
        .iter()
        .map(|binding| (binding.locator().input_role_identity(), binding))
        .collect::<BTreeMap<_, _>>();

    if bindings.len() != 4
        || binding_by_role.len() != 4
        || source.frames.len() < 2
        || source.frames.iter().any(|frame| frame.values().len() != 4)
    {
        return Err(StrategyInputEventCorpusUnavailableV1::CrossSplice);
    }
    let first_candidate = candidates
        .first()
        .ok_or(StrategyInputEventCorpusUnavailableV1::IncompleteCensus)?;
    let trigger_role = first_candidate
        .joined_cut
        .components()
        .iter()
        .find(|component| {
            component.role_semantic_id() == first_candidate.joined_cut.trigger_input_id()
        })
        .and_then(|component| component.frame().values().first())
        .map(StrategyInputEventValueReceipt::input_role_identity)
        .ok_or(StrategyInputEventCorpusUnavailableV1::CrossSplice)?;
    let trigger_binding = binding_by_role
        .get(&trigger_role)
        .ok_or(StrategyInputEventCorpusUnavailableV1::CrossSplice)?;
    let mut expected = BTreeSet::new();

    for frame in &source.frames {
        if frame.values().iter().any(|value| {
            value.input_role_identity() == trigger_role
                && value.binding_receipt_digest() == trigger_binding.digest()
        }) {
            let lifecycle = frame.trigger().lifecycle();
            expected.insert((
                lifecycle.logical_time(),
                lifecycle.event_time(),
                lifecycle.owner_sequence(),
            ));
        }
    }

    if expected.is_empty() || expected.len() != candidates.len() {
        return Err(StrategyInputEventCorpusUnavailableV1::IncompleteCensus);
    }

    let expected = expected.into_iter().collect::<Vec<_>>();
    let mut members = Vec::with_capacity(candidates.len());
    let mut prior_key = None;
    let mut joined_digests = BTreeSet::new();
    let mut projection_digests = BTreeSet::new();
    let mut native_digests = BTreeSet::new();
    let mut design_identity = None;
    let mut join_identity = None;

    for (candidate, expected_key) in candidates.into_iter().zip(expected) {
        let StrategyInputEventCorpusCandidateV1 {
            joined_cut,
            projection,
        } = candidate;
        let trigger_component = joined_cut
            .components()
            .iter()
            .find(|component| component.role_semantic_id() == joined_cut.trigger_input_id())
            .ok_or(StrategyInputEventCorpusUnavailableV1::CrossSplice)?;
        let trigger = trigger_component.frame().trigger();
        let [_trigger_value] = trigger_component.frame().values() else {
            return Err(StrategyInputEventCorpusUnavailableV1::CrossSplice);
        };
        let order_key = trigger.lifecycle();
        let comparable_key = (
            order_key.logical_time(),
            order_key.event_time(),
            order_key.owner_sequence(),
        );

        if order_key.kind() != StrategyInputEventKind::Event {
            return Err(StrategyInputEventCorpusUnavailableV1::UnsupportedLifecycle);
        }

        if comparable_key != expected_key
            || trigger.digest() != joined_cut.trigger_digest()
            || !joined_cut.has_valid_digest()
            || projection.kind() != StrategyInputSampleProjectionKindV2::JoinedCut
            || projection.lifecycle() != StrategyInputEventKind::Event
            || projection.subject_identity() != *joined_cut.digest().as_bytes()
            || usize::try_from(projection.component_count()).ok()
                != Some(joined_cut.components().len())
            || joined_cut.components().len() != bindings.len()
            || !source.frames.iter().any(|frame| {
                frame.trigger() == trigger_component.frame().trigger()
                    && frame
                        .values()
                        .iter()
                        .any(|source_value| source_value == &trigger_component.frame().values()[0])
            })
            || !projection_components_match(&projection, &joined_cut)
            || !joined_cut.components().iter().all(|component| {
                let [value] = component.frame().values() else {
                    return false;
                };
                binding_by_role
                    .get(&value.input_role_identity())
                    .is_some_and(|binding| {
                        value.binding_receipt_digest() == binding.digest()
                            && source_component_is_latest_for_cut(
                                &source,
                                binding,
                                component,
                                order_key.logical_time(),
                                joined_cut.max_staleness_ns(),
                            )
                    })
            })
            || design_identity
                .replace(joined_cut.strategy_design_identity())
                .is_some_and(|value| value != joined_cut.strategy_design_identity())
            || join_identity
                .replace(joined_cut.join_identity())
                .is_some_and(|value| value != joined_cut.join_identity())
        {
            return Err(StrategyInputEventCorpusUnavailableV1::CrossSplice);
        }
        let full_key = (
            order_key.logical_time(),
            order_key.event_time(),
            order_key.owner_sequence(),
            order_key.event_identity(),
        );

        if prior_key.is_some_and(|prior| prior >= full_key) {
            return Err(StrategyInputEventCorpusUnavailableV1::NonCanonicalOrder);
        }
        prior_key = Some(full_key);

        if !joined_digests.insert(joined_cut.digest())
            || !projection_digests.insert(projection.receipt_digest())
            || !native_digests.insert(trigger.digest())
        {
            return Err(StrategyInputEventCorpusUnavailableV1::Duplicate);
        }
        members.push(StrategyInputEventCorpusMemberV1 {
            joined_cut,
            projection,
            order_key,
        });
    }

    let members = members.into_boxed_slice();
    let digest = corpus_digest(&source, &members);
    Ok(StrategyInputEventCorpusV1 {
        source,
        members,
        digest,
    })
}

fn source_component_is_latest_for_cut(
    source: &StrategyInputEventSourceV1,
    binding: &StrategyInputBindingReceipt,
    component: &StrategyInputJoinedCutComponentV1,
    trigger_logical_time: u64,
    max_staleness_ns: u64,
) -> bool {
    let locator = binding.locator();
    let [value] = component.frame().values() else {
        return false;
    };
    let eligible = source
        .frames
        .iter()
        .filter_map(|frame| {
            let lifecycle = frame.trigger().lifecycle();
            frame
                .values()
                .iter()
                .find(|source_value| {
                    source_value.input_role_identity() == value.input_role_identity()
                        && source_value.binding_receipt_digest() == binding.digest()
                        && source_value.value_scale() == locator.scale()
                        && lifecycle.logical_time() <= trigger_logical_time
                })
                .map(|source_value| (frame, source_value))
        })
        .collect::<Vec<_>>();
    let Some(latest_time) = eligible
        .iter()
        .map(|(frame, _)| frame.trigger().lifecycle().logical_time())
        .max()
    else {
        return false;
    };
    let latest = eligible
        .into_iter()
        .filter(|(frame, _)| frame.trigger().lifecycle().logical_time() == latest_time)
        .collect::<Vec<_>>();
    let [(selected_frame, selected_value)] = latest.as_slice() else {
        return false;
    };
    let lifecycle = component.frame().trigger().lifecycle();

    trigger_logical_time.saturating_sub(latest_time) <= max_staleness_ns
        && component.staleness_ns() == trigger_logical_time.saturating_sub(latest_time)
        && lifecycle.logical_time() == latest_time
        && lifecycle.event_time() == selected_frame.trigger().lifecycle().event_time()
        && lifecycle.owner_sequence() == selected_frame.trigger().lifecycle().owner_sequence()
        && selected_frame.trigger() == component.frame().trigger()
        && selected_value == &value
        && value.source_binding_lineage_root() == locator.source_binding_lineage_root()
        && value.correction_stream_identity() == locator.correction_stream_identity()
        && value.market_semantics_identity() == locator.market_semantics_identity()
}

fn projection_components_match(
    projection: &StrategyInputSampleProjectionReadbackV2,
    joined_cut: &StrategyInputJoinedCutReceiptV1,
) -> bool {
    let mut expected = joined_cut
        .components()
        .iter()
        .filter_map(|component| {
            let [value] = component.frame().values() else {
                return None;
            };
            Some((
                *value.input_role_identity().as_bytes(),
                *value.binding_receipt_digest().as_bytes(),
            ))
        })
        .collect::<Vec<_>>();
    expected.sort_unstable();
    projection
        .components()
        .iter()
        .map(|component| {
            (
                component.role_identity(),
                component.binding_receipt_digest(),
            )
        })
        .eq(expected)
}

fn corpus_digest(
    source: &StrategyInputEventSourceV1,
    members: &[StrategyInputEventCorpusMemberV1],
) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(CORPUS_DOMAIN);
    hasher.update(source.digest.as_bytes());
    hasher.update(
        u64::try_from(members.len())
            .unwrap_or(u64::MAX)
            .to_be_bytes(),
    );

    for member in members {
        let key = member.order_key;
        hasher.update(key.logical_time().to_be_bytes());
        hasher.update(key.event_time().to_be_bytes());
        hasher.update(key.owner_sequence().to_be_bytes());
        hasher.update(key.event_identity());
        hasher.update(member.joined_cut.digest().as_bytes());
        hasher.update(member.projection.receipt_digest());
        hasher.update(member.joined_cut.trigger_digest().as_bytes());
    }
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

fn event_source_digest(frames: &[StrategyInputEventFrameReceipt]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(SOURCE_DOMAIN);
    hasher.update(
        u64::try_from(frames.len())
            .unwrap_or(u64::MAX)
            .to_be_bytes(),
    );

    for frame in frames {
        let trigger = frame.trigger();
        hasher.update(trigger.snapshot_identity().as_bytes());
        hasher.update(trigger.snapshot_fact_digest().as_bytes());
        hasher.update(trigger.observation_batch_digest().as_bytes());
        hasher.update(trigger.digest().as_bytes());
        hasher.update(
            u64::try_from(frame.values().len())
                .unwrap_or(u64::MAX)
                .to_be_bytes(),
        );

        for value in frame.values() {
            hasher.update(value.input_role_identity().as_bytes());
            hasher.update(value.binding_receipt_digest().as_bytes());
            hasher.update(value.canonical_row_digest().as_bytes());
            hasher.update(value.digest().as_bytes());
        }
    }
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

#[cfg(all(test, feature = "sealed-strategy-input-acceptance"))]
mod tests {
    use rstest::rstest;

    use super::*;
    use crate::owner::{
        pit_snapshot::joined_input_sealed_acceptance::{
            SealedAcceptanceStrategyInputJoinCorpus, issue_strategy_input_event_join_corpus_v1,
            issue_strategy_input_event_replay_package_for_sealed_acceptance_v1,
        },
        sample_projection::joined_cut_readback_for_event_corpus_acceptance_v2,
    };

    fn candidates(
        joined: &SealedAcceptanceStrategyInputJoinCorpus,
    ) -> Vec<StrategyInputEventCorpusCandidateV1> {
        joined
            .events()
            .iter()
            .map(|event| {
                StrategyInputEventCorpusCandidateV1::new(
                    event.clone(),
                    joined_cut_readback_for_event_corpus_acceptance_v2(event)
                        .expect("real Owner EVENT projection readback"),
                )
            })
            .collect()
    }

    fn issue(
        joined: &mut SealedAcceptanceStrategyInputJoinCorpus,
        candidates: Vec<StrategyInputEventCorpusCandidateV1>,
    ) -> Result<StrategyInputEventCorpusV1, StrategyInputEventCorpusUnavailableV1> {
        let source = joined
            .take_event_source()
            .expect("real Owner/PIT/source/batch EVENT source");
        issue_strategy_input_event_corpus_v1(source, joined.bindings(), candidates)
    }

    #[rstest]
    fn complete_three_event_corpus_is_repeatable_and_ordered() {
        let mut first_joined =
            issue_strategy_input_event_join_corpus_v1().expect("Owner EVENT cuts");
        let mut second_joined =
            issue_strategy_input_event_join_corpus_v1().expect("Owner EVENT cuts");
        let first_candidates = candidates(&first_joined);
        let second_candidates = candidates(&second_joined);
        let first = issue(&mut first_joined, first_candidates).expect("complete EVENT corpus");
        let second =
            issue(&mut second_joined, second_candidates).expect("repeat complete EVENT corpus");

        assert_eq!(first.expected_count(), 3);
        assert_eq!(first.digest(), second.digest());
        assert!(first.has_valid_digest());
        assert!(first.members().windows(2).all(|pair| {
            let left = pair[0].order_key();
            let right = pair[1].order_key();
            (
                left.logical_time(),
                left.event_time(),
                left.owner_sequence(),
                left.event_identity(),
            ) < (
                right.logical_time(),
                right.event_time(),
                right.owner_sequence(),
                right.event_identity(),
            )
        }));
    }

    #[rstest]
    fn atomic_replay_package_accepts_only_the_unique_terminal_anchor() {
        let sealed = issue_strategy_input_event_replay_package_for_sealed_acceptance_v1()
            .expect("atomic terminal EVENT replay package");
        let (bindings, package) = sealed.into_parts();
        assert_eq!(bindings.len(), 4);
        assert!(package.has_valid_digest());
        let package_digest = package.digest();
        assert_ne!(package_digest, BindingDigest::from_untrusted_bytes([0; 32]));
        assert_eq!(package.corpus().expected_count(), 3);
        assert_eq!(
            package.replay_input().observation_end_event_time(),
            package
                .corpus()
                .members()
                .last()
                .expect("terminal corpus member")
                .order_key()
                .event_time()
        );

        let mut nonterminal =
            issue_strategy_input_event_join_corpus_v1().expect("Owner EVENT cuts");
        let nonterminal_candidates = candidates(&nonterminal);
        let nonterminal_source = nonterminal
            .take_event_source()
            .expect("complete EVENT source");
        let nonterminal_anchor = nonterminal
            .take_nonterminal_event_replay_input()
            .expect("nonterminal replay anchor");
        assert!(matches!(
            issue_strategy_input_event_replay_package_v1(
                nonterminal_anchor,
                nonterminal_source,
                nonterminal.bindings(),
                nonterminal_candidates,
            ),
            Err(StrategyInputEventCorpusUnavailableV1::CrossSplice)
        ));
    }

    #[rstest]
    fn omission_duplicate_reorder_and_cross_splice_fail_closed() {
        let mut singular_joined =
            issue_strategy_input_event_join_corpus_v1().expect("Owner EVENT cuts");
        let singular_candidates = candidates(&singular_joined);
        let mut singular_source = singular_joined
            .take_event_source()
            .expect("complete EVENT source");
        singular_source.frames = Vec::from(singular_source.frames)
            .into_iter()
            .take(1)
            .collect::<Vec<_>>()
            .into_boxed_slice();
        singular_source.authorities = Vec::from(singular_source.authorities)
            .into_iter()
            .take(1)
            .collect::<Vec<_>>()
            .into_boxed_slice();
        assert!(matches!(
            issue_strategy_input_event_corpus_v1(
                singular_source,
                singular_joined.bindings(),
                singular_candidates,
            ),
            Err(StrategyInputEventCorpusUnavailableV1::CrossSplice)
        ));

        let mut three_role_joined =
            issue_strategy_input_event_join_corpus_v1().expect("Owner EVENT cuts");
        let three_role_candidates = candidates(&three_role_joined);
        let three_role_source = three_role_joined
            .take_event_source()
            .expect("complete EVENT source");
        assert!(matches!(
            issue_strategy_input_event_corpus_v1(
                three_role_source,
                &three_role_joined.bindings()[..3],
                three_role_candidates,
            ),
            Err(StrategyInputEventCorpusUnavailableV1::CrossSplice)
        ));

        let mut omission_joined =
            issue_strategy_input_event_join_corpus_v1().expect("Owner EVENT cuts");
        let mut omission = candidates(&omission_joined);
        omission.pop();
        assert!(issue(&mut omission_joined, omission).is_err());

        let mut duplicate_joined =
            issue_strategy_input_event_join_corpus_v1().expect("Owner EVENT cuts");
        let mut duplicate = candidates(&duplicate_joined);
        duplicate[1] = StrategyInputEventCorpusCandidateV1::new(
            duplicate_joined.events()[0].clone(),
            joined_cut_readback_for_event_corpus_acceptance_v2(&duplicate_joined.events()[0])
                .expect("duplicate projection"),
        );
        assert!(issue(&mut duplicate_joined, duplicate).is_err());

        let mut extra_joined =
            issue_strategy_input_event_join_corpus_v1().expect("Owner EVENT cuts");
        let mut extra = candidates(&extra_joined);
        extra.push(StrategyInputEventCorpusCandidateV1::new(
            extra_joined.repeated_first().clone(),
            joined_cut_readback_for_event_corpus_acceptance_v2(extra_joined.repeated_first())
                .expect("extra projection"),
        ));
        assert!(issue(&mut extra_joined, extra).is_err());

        let mut reorder_joined =
            issue_strategy_input_event_join_corpus_v1().expect("Owner EVENT cuts");
        let mut reordered = candidates(&reorder_joined);
        reordered.reverse();
        assert!(issue(&mut reorder_joined, reordered).is_err());

        let mut splice_joined =
            issue_strategy_input_event_join_corpus_v1().expect("Owner EVENT cuts");
        let mut spliced = candidates(&splice_joined);
        let alternate = splice_joined.alternate_join_claim_for_negative_test();
        spliced[2] = StrategyInputEventCorpusCandidateV1::new(
            alternate.clone(),
            joined_cut_readback_for_event_corpus_acceptance_v2(alternate)
                .expect("cross-splice projection"),
        );
        assert!(issue(&mut splice_joined, spliced).is_err());

        let mut stale_selection_joined =
            issue_strategy_input_event_join_corpus_v1().expect("Owner EVENT cuts");
        let mut stale_selection = candidates(&stale_selection_joined);
        let stale_cut = stale_selection_joined
            .stale_selection_basis_for_negative_test()
            .expect("EVENT fixture carries isolated stale-selection evidence");
        stale_selection[2] = StrategyInputEventCorpusCandidateV1::new(
            stale_cut.clone(),
            joined_cut_readback_for_event_corpus_acceptance_v2(stale_cut)
                .expect("stale selection-basis projection"),
        );
        assert!(matches!(
            issue(&mut stale_selection_joined, stale_selection),
            Err(StrategyInputEventCorpusUnavailableV1::CrossSplice)
        ));

        let mut snapshot_splice_joined =
            issue_strategy_input_event_join_corpus_v1().expect("Owner EVENT cuts");
        let snapshot_splice_candidates = candidates(&snapshot_splice_joined);
        let foreign_source = snapshot_splice_joined
            .take_equal_value_cross_snapshot_source()
            .expect("real equal-valued foreign snapshot source");
        let (foreign_frame, candidate_frame) = foreign_source
            .frames
            .iter()
            .filter(|frame| frame.trigger().lifecycle().logical_time() == 5_000_000_000)
            .find_map(|foreign_frame| {
                let foreign_value = &foreign_frame.values()[0];
                snapshot_splice_candidates[2]
                    .joined_cut
                    .components()
                    .iter()
                    .map(StrategyInputJoinedCutComponentV1::frame)
                    .find(|candidate_frame| {
                        let candidate_value = &candidate_frame.values()[0];
                        candidate_value.input_role_identity() == foreign_value.input_role_identity()
                            && candidate_value.value_bytes() == foreign_value.value_bytes()
                            && candidate_frame.trigger().snapshot_identity()
                                != foreign_frame.trigger().snapshot_identity()
                    })
                    .map(|candidate_frame| (foreign_frame, candidate_frame))
            })
            .expect("foreign source carries an equal-valued cross-snapshot coordinate");
        assert_eq!(
            foreign_frame.values()[0].value_bytes(),
            candidate_frame.values()[0].value_bytes()
        );
        assert_ne!(
            foreign_frame.trigger().snapshot_identity(),
            candidate_frame.trigger().snapshot_identity()
        );
        assert!(matches!(
            issue_strategy_input_event_corpus_v1(
                foreign_source,
                snapshot_splice_joined.bindings(),
                snapshot_splice_candidates,
            ),
            Err(StrategyInputEventCorpusUnavailableV1::CrossSplice
                | StrategyInputEventCorpusUnavailableV1::IncompleteCensus)
        ));
    }
}
