//! Complete, canonically ordered EVENT corpus sealed by Market Data.
//!
//! This additive boundary consumes the unchanged sealed replay-input, joined-cut, and V2 sample
//! projection receipts. It does not reinterpret or re-encode any predecessor receipt. A positive
//! corpus exists only when those receipts cover every EVENT coordinate in the complete replay-input
//! census exactly once and in the Owner-canonical native event order.

use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Debug,
};

use sha2::{Digest, Sha256};

use super::{
    sample_projection::{
        StrategyInputSampleProjectionKindV2, StrategyInputSampleProjectionReadbackV2,
    },
    sealed_replay_input::SealedReplayInput,
    source_binding::BindingDigest,
    strategy_input_binding::{
        StrategyInputBindingReceipt, StrategyInputEventKind, StrategyInputLifecycleProjection,
    },
    strategy_input_joined_cut::{
        StrategyInputJoinedCutComponentV1, StrategyInputJoinedCutReceiptV1,
    },
};

const CORPUS_DOMAIN: &[u8] = b"vibe.market-data.strategy-input-event-corpus.v1\0";

/// One proposed pairing of existing Owner-issued receipts.
///
/// Construction is not authority: [`issue_strategy_input_event_corpus_v1`] independently checks
/// complete-set coverage and all receipt relationships against the sealed replay input.
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
/// The retained [`SealedReplayInput`] is the complete-set authority; callers cannot mint a positive
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
    replay_input: SealedReplayInput,
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
    pub const fn replay_input(&self) -> &SealedReplayInput {
        &self.replay_input
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
        self.digest == corpus_digest(&self.replay_input, &self.members)
    }
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

/// Seals every EVENT in one complete replay-input census into canonical native order.
///
/// Candidates must already be in `(logical_time, event_time, owner_sequence, event_identity)`
/// order. Market Data rejects rather than silently sorting because arrival order is part of the
/// anti-splice admission boundary.
///
/// # Errors
///
/// Returns a fail-closed category before any positive corpus exists.
pub fn issue_strategy_input_event_corpus_v1(
    replay_input: SealedReplayInput,
    bindings: &[StrategyInputBindingReceipt],
    candidates: Vec<StrategyInputEventCorpusCandidateV1>,
) -> Result<StrategyInputEventCorpusV1, StrategyInputEventCorpusUnavailableV1> {
    let binding_by_role = bindings
        .iter()
        .map(|binding| (binding.locator().input_role_identity(), binding))
        .collect::<BTreeMap<_, _>>();
    if bindings.is_empty() || binding_by_role.len() != bindings.len() {
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
        .map(|value| value.input_role_identity())
        .ok_or(StrategyInputEventCorpusUnavailableV1::CrossSplice)?;
    let trigger_binding = binding_by_role
        .get(&trigger_role)
        .ok_or(StrategyInputEventCorpusUnavailableV1::CrossSplice)?
        .locator();
    let mut expected = BTreeSet::new();
    for frame in replay_input.frames() {
        if frame.data_kind() == "BAR" {
            return Err(StrategyInputEventCorpusUnavailableV1::UnsupportedLifecycle);
        }
        if frame.instrument() == trigger_binding.instrument()
            && frame.channel() == trigger_binding.channel()
            && frame.data_kind() == trigger_binding.data_kind()
            && frame.timeframe() == trigger_binding.timeframe()
            && frame.field() == trigger_binding.field_semantic_identity()
        {
            expected.insert((
                frame
                    .provider_available()
                    .max(frame.correction_publication()),
                frame.event_effective(),
                frame.correction_sequence(),
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
        let [trigger_value] = trigger_component.frame().values() else {
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
            || joined_cut.market_semantics_identity() != replay_input.market_semantics_identity()
            || trigger_value.source_binding_lineage_root()
                != replay_input.source_binding_lineage_root()
            || trigger_value.source_binding_lineage_version()
                != replay_input.source_binding_lineage_version()
            || trigger_value.correction_stream_identity()
                != replay_input.correction_frontier().stream_identity
            || trigger_value.correction_frontier_digest()
                != replay_input.correction_frontier().digest
            || !projection_components_match(&projection, &joined_cut)
            || !joined_cut.components().iter().all(|component| {
                let [value] = component.frame().values() else {
                    return false;
                };
                binding_by_role
                    .get(&value.input_role_identity())
                    .is_some_and(|binding| {
                        value.binding_receipt_digest() == binding.digest()
                            && replay_component_is_latest_for_cut(
                                &replay_input,
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
    let digest = corpus_digest(&replay_input, &members);
    Ok(StrategyInputEventCorpusV1 {
        replay_input,
        members,
        digest,
    })
}

fn replay_component_is_latest_for_cut(
    replay_input: &SealedReplayInput,
    binding: &StrategyInputBindingReceipt,
    component: &StrategyInputJoinedCutComponentV1,
    trigger_logical_time: u64,
    max_staleness_ns: u64,
) -> bool {
    let locator = binding.locator();
    let [value] = component.frame().values() else {
        return false;
    };
    let value_mantissa = i128::from_le_bytes(*value.value_bytes());
    let eligible = replay_input
        .frames()
        .iter()
        .filter(|frame| {
            frame.instrument() == locator.instrument()
                && frame.channel() == locator.channel()
                && frame.data_kind() == locator.data_kind()
                && frame.timeframe() == locator.timeframe()
                && frame.field() == locator.field_semantic_identity()
                && frame.value_scale() == locator.scale()
                && frame
                    .provider_available()
                    .max(frame.correction_publication())
                    <= trigger_logical_time
        })
        .collect::<Vec<_>>();
    let Some(latest_time) = eligible
        .iter()
        .map(|frame| {
            frame
                .provider_available()
                .max(frame.correction_publication())
        })
        .max()
    else {
        return false;
    };
    let latest = eligible
        .into_iter()
        .filter(|frame| {
            frame
                .provider_available()
                .max(frame.correction_publication())
                == latest_time
        })
        .collect::<Vec<_>>();
    let [selected] = latest.as_slice() else {
        return false;
    };
    let lifecycle = component.frame().trigger().lifecycle();

    trigger_logical_time.saturating_sub(latest_time) <= max_staleness_ns
        && component.staleness_ns() == trigger_logical_time.saturating_sub(latest_time)
        && lifecycle.logical_time() == latest_time
        && lifecycle.event_time() == selected.event_effective()
        && lifecycle.owner_sequence() == selected.correction_sequence()
        && selected.value_scale() == value.value_scale()
        && selected.value_mantissa() == value_mantissa
        && value.source_binding_lineage_root() == locator.source_binding_lineage_root()
        && value.correction_stream_identity() == locator.correction_stream_identity()
        && value.market_semantics_identity() == replay_input.market_semantics_identity()
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
    replay_input: &SealedReplayInput,
    members: &[StrategyInputEventCorpusMemberV1],
) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(CORPUS_DOMAIN);
    hasher.update(replay_input.request_identity().as_bytes());
    hasher.update(replay_input.request_digest().as_bytes());
    hasher.update(replay_input.frame_census_digest().as_bytes());
    hasher.update(replay_input.normalized_records_digest().as_bytes());
    hasher.update(replay_input.snapshot_identity().as_bytes());
    hasher.update(replay_input.snapshot_fact_digest().as_bytes());
    hasher.update(replay_input.source_binding_identity().as_bytes());
    hasher.update(replay_input.source_binding_lineage_root().as_bytes());
    hasher.update(replay_input.source_binding_lineage_version().to_be_bytes());
    hasher.update(replay_input.source_frontier().digest.as_bytes());
    put_text(&mut hasher, &replay_input.source_frontier().stream_identity);
    put_text(&mut hasher, &replay_input.source_frontier().cut_identity);
    hasher.update(replay_input.source_frontier().sequence.to_be_bytes());
    hasher.update(replay_input.correction_lineage_root().as_bytes());
    hasher.update(replay_input.correction_lineage_version().to_be_bytes());
    hasher.update(replay_input.correction_frontier().digest.as_bytes());
    put_text(
        &mut hasher,
        &replay_input.correction_frontier().stream_identity,
    );
    put_text(
        &mut hasher,
        &replay_input.correction_frontier().cut_identity,
    );
    hasher.update(replay_input.correction_frontier().sequence.to_be_bytes());
    hasher.update(replay_input.market_semantics_identity().as_bytes());
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

fn put_text(hasher: &mut Sha256, value: &str) {
    hasher.update(u64::try_from(value.len()).unwrap_or(u64::MAX).to_be_bytes());
    hasher.update(value.as_bytes());
}

#[cfg(all(test, feature = "sealed-strategy-input-acceptance"))]
mod tests {
    use rstest::rstest;

    use super::*;
    use crate::owner::{
        pit_snapshot::joined_input_sealed_acceptance::{
            SealedAcceptanceStrategyInputJoinCorpus, issue_strategy_input_event_join_corpus_v1,
        },
        sample_projection::joined_cut_readback_for_event_corpus_acceptance_v2,
        sealed_replay_input::seal_event_corpus_acceptance_replay_input_v1,
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
        joined: &SealedAcceptanceStrategyInputJoinCorpus,
        candidates: Vec<StrategyInputEventCorpusCandidateV1>,
    ) -> Result<StrategyInputEventCorpusV1, StrategyInputEventCorpusUnavailableV1> {
        let replay =
            seal_event_corpus_acceptance_replay_input_v1(joined.bindings(), joined.events())
                .expect("real Owner/PIT/source/batch EVENT replay input");
        issue_strategy_input_event_corpus_v1(replay, joined.bindings(), candidates)
    }

    #[rstest]
    fn complete_three_event_corpus_is_repeatable_and_ordered() {
        let first_joined = issue_strategy_input_event_join_corpus_v1().expect("Owner EVENT cuts");
        let second_joined = issue_strategy_input_event_join_corpus_v1().expect("Owner EVENT cuts");
        let first = issue(&first_joined, candidates(&first_joined)).expect("complete EVENT corpus");
        let second = issue(&second_joined, candidates(&second_joined))
            .expect("repeat complete EVENT corpus");

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
    fn omission_duplicate_reorder_and_cross_splice_fail_closed() {
        let omission_joined =
            issue_strategy_input_event_join_corpus_v1().expect("Owner EVENT cuts");
        let mut omission = candidates(&omission_joined);
        omission.pop();
        assert!(issue(&omission_joined, omission).is_err());

        let duplicate_joined =
            issue_strategy_input_event_join_corpus_v1().expect("Owner EVENT cuts");
        let mut duplicate = candidates(&duplicate_joined);
        duplicate[1] = StrategyInputEventCorpusCandidateV1::new(
            duplicate_joined.events()[0].clone(),
            joined_cut_readback_for_event_corpus_acceptance_v2(&duplicate_joined.events()[0])
                .expect("duplicate projection"),
        );
        assert!(issue(&duplicate_joined, duplicate).is_err());

        let reorder_joined = issue_strategy_input_event_join_corpus_v1().expect("Owner EVENT cuts");
        let mut reordered = candidates(&reorder_joined);
        reordered.reverse();
        assert!(issue(&reorder_joined, reordered).is_err());

        let splice_joined = issue_strategy_input_event_join_corpus_v1().expect("Owner EVENT cuts");
        let mut spliced = candidates(&splice_joined);
        let alternate = splice_joined.alternate_join_claim_for_negative_test();
        spliced[2] = StrategyInputEventCorpusCandidateV1::new(
            alternate.clone(),
            joined_cut_readback_for_event_corpus_acceptance_v2(alternate)
                .expect("cross-splice projection"),
        );
        assert!(issue(&splice_joined, spliced).is_err());

        let stale_selection_joined =
            issue_strategy_input_event_join_corpus_v1().expect("Owner EVENT cuts");
        let mut stale_selection = candidates(&stale_selection_joined);
        let stale_cut = stale_selection_joined.stale_selection_basis_for_negative_test();
        stale_selection[2] = StrategyInputEventCorpusCandidateV1::new(
            stale_cut.clone(),
            joined_cut_readback_for_event_corpus_acceptance_v2(stale_cut)
                .expect("stale selection-basis projection"),
        );
        assert!(matches!(
            issue(&stale_selection_joined, stale_selection),
            Err(StrategyInputEventCorpusUnavailableV1::CrossSplice)
        ));
    }
}
