#![allow(
    dead_code,
    reason = "Owner-private issuance is intentionally unreachable until the TARGET canonical-store resolver is added"
)]

use std::collections::{BTreeMap, BTreeSet};

use super::{
    ReplayCorporateActionTermsV2, ReplayMarketDependencyKindV2, ReplayMarketDependencyRefV2,
    ReplayMarketFactsErrorV2, ReplayMarketFactsFrontierV2, ReplayMarketFactsReadbackV2,
    ReplayMarketFactsReceiptV2, ReplayMarketFactsV2, ReplayNativeChainV2, ReplayReferenceFactCutV2,
    ReplayReferenceFactKindV2, ReplayReferenceFactScopeV2, ReplayReferenceFactTimeV2,
    ReplayReferenceFactV2, ReplayReferenceFactValueV2, UntrustedReplayMarketFactsRequestV2,
    codec::{
        CUT_DOMAIN, Encoder, FACT_DOMAIN, FACTS_DOMAIN, FRONTIER_DOMAIN, MAX_AGGREGATE_BYTES,
        MAX_CUT_BYTES, MAX_FACT_BYTES, MAX_FACTS_PER_CUT, MAX_FIELD_BYTES, MAX_FRONTIER_BYTES,
        MAX_RECEIPT_BYTES, MAX_TOTAL_FACTS, PIT_CLOCK_DOMAIN, RECEIPT_DOMAIN, digest,
        encode_dependency, encode_time, encode_value, valid_adjustment, valid_timestamp_basis,
    },
};
use crate::owner::source_binding::BindingDigest;

const REQUIRED_REFERENCE_KINDS: [ReplayReferenceFactKindV2; 7] = [
    ReplayReferenceFactKindV2::Calendar,
    ReplayReferenceFactKindV2::Session,
    ReplayReferenceFactKindV2::TimeZone,
    ReplayReferenceFactKindV2::MarketSemantics,
    ReplayReferenceFactKindV2::CorrectionPolicy,
    ReplayReferenceFactKindV2::CorporateAction,
    ReplayReferenceFactKindV2::HistoricalMembership,
];

const REQUIRED_BASE_DEPENDENCY_KINDS: [ReplayMarketDependencyKindV2; 4] = [
    ReplayMarketDependencyKindV2::PitSnapshotV1,
    ReplayMarketDependencyKindV2::SourceBindingV1,
    ReplayMarketDependencyKindV2::InstrumentMasterCutV1,
    ReplayMarketDependencyKindV2::UniverseSelectionV1,
];

const REQUIRED_DEPENDENCY_KINDS: [ReplayMarketDependencyKindV2; 7] = [
    ReplayMarketDependencyKindV2::PitSnapshotV1,
    ReplayMarketDependencyKindV2::SourceBindingV1,
    ReplayMarketDependencyKindV2::InstrumentMasterCutV1,
    ReplayMarketDependencyKindV2::UniverseSelectionV1,
    ReplayMarketDependencyKindV2::ObservationCensusV1,
    ReplayMarketDependencyKindV2::StrategyInputJoinedCutV1,
    ReplayMarketDependencyKindV2::StrategyInputSampleProjectionV2,
];
const REQUIRED_DEPENDENCY_KINDS_V4: [ReplayMarketDependencyKindV2; 7] = [
    ReplayMarketDependencyKindV2::PitSnapshotV1,
    ReplayMarketDependencyKindV2::SourceBindingV1,
    ReplayMarketDependencyKindV2::InstrumentMasterCutV1,
    ReplayMarketDependencyKindV2::UniverseSelectionV1,
    ReplayMarketDependencyKindV2::ObservationCensusV1,
    ReplayMarketDependencyKindV2::StrategyInputJoinedCutV1,
    ReplayMarketDependencyKindV2::StrategyInputSampleProjectionV4,
];

/// Owner-private normalized proposal. It cannot enter the public request boundary.
#[derive(Clone)]
pub(crate) struct ReplayReferenceFactProposalV2 {
    pub(crate) value: ReplayReferenceFactValueV2,
    pub(crate) time: ReplayReferenceFactTimeV2,
    pub(crate) source_identity: BindingDigest,
    pub(crate) correction_identity: BindingDigest,
}

/// Owner-private complete fact-set proposal.
#[derive(Clone)]
pub(crate) struct ReplayReferenceFactCutProposalV2 {
    pub(crate) kind: ReplayReferenceFactKindV2,
    pub(crate) scope: ReplayReferenceFactScopeProposalV2,
    pub(crate) facts: Vec<ReplayReferenceFactProposalV2>,
}

/// Owner-private typed claim that is checked against the request and native dependency frontier.
#[derive(Clone, Copy)]
pub(crate) struct ReplayReferenceFactScopeProposalV2 {
    pub(crate) pit_snapshot_identity: BindingDigest,
    pub(crate) pit_decision_cut: u64,
    pub(crate) pit_observed_at: u64,
    pub(crate) pit_valid_through: u64,
    pub(crate) pit_clock_digest: BindingDigest,
    pub(crate) replay_start_event_ns: i128,
    pub(crate) replay_end_event_ns_exclusive: i128,
    pub(crate) authority_kind: ReplayMarketDependencyKindV2,
    pub(crate) authority_identity: BindingDigest,
}

/// Owner-private proof that existing authorities were resolved and verified.
pub(crate) struct ReplayMarketFactsEvidenceV2 {
    pub(crate) base_dependencies: Vec<ReplayMarketDependencyRefV2>,
    pub(crate) native_chain: ReplayNativeChainEvidenceV2,
    pub(crate) reference_cuts: Vec<ReplayReferenceFactCutProposalV2>,
    pub(crate) stable_correlation: BindingDigest,
}

/// One sealed capability boundary for the native census -> joined-cut -> sample chain.
#[derive(Clone, Copy)]
pub(crate) struct ReplayNativeChainEvidenceV2 {
    pub(crate) observation_census: ReplayMarketDependencyRefV2,
    pub(crate) joined_cut: ReplayMarketDependencyRefV2,
    pub(crate) joined_cut_observation_subject: BindingDigest,
    pub(crate) joined_cut_observation_subject_digest: BindingDigest,
    pub(crate) sample_projection: ReplayMarketDependencyRefV2,
    pub(crate) sample_projection_joined_cut_subject: BindingDigest,
    pub(crate) sample_projection_joined_cut_subject_digest: BindingDigest,
}

impl ReplayNativeChainEvidenceV2 {
    pub(crate) const fn from_verified_native_records(
        observation: ReplayVerifiedNativeRecordV2,
        joined_cut: ReplayVerifiedNativeDerivedRecordV2,
        sample_projection: ReplayVerifiedNativeDerivedRecordV2,
    ) -> Self {
        Self {
            observation_census: ReplayMarketDependencyRefV2::from_verified_owner_record(
                ReplayMarketDependencyKindV2::ObservationCensusV1,
                observation.identity,
                observation.digest,
            ),
            joined_cut: ReplayMarketDependencyRefV2::from_verified_owner_record(
                ReplayMarketDependencyKindV2::StrategyInputJoinedCutV1,
                joined_cut.record.identity,
                joined_cut.record.digest,
            ),
            joined_cut_observation_subject: joined_cut.subject.identity,
            joined_cut_observation_subject_digest: joined_cut.subject.digest,
            sample_projection: ReplayMarketDependencyRefV2::from_verified_owner_record(
                ReplayMarketDependencyKindV2::StrategyInputSampleProjectionV2,
                sample_projection.record.identity,
                sample_projection.record.digest,
            ),
            sample_projection_joined_cut_subject: sample_projection.subject.identity,
            sample_projection_joined_cut_subject_digest: sample_projection.subject.digest,
        }
    }

    pub(crate) const fn from_verified_native_records_v4(
        observation: ReplayVerifiedNativeRecordV2,
        joined_cut: ReplayVerifiedNativeDerivedRecordV2,
        sample_projection: ReplayVerifiedNativeDerivedRecordV2,
    ) -> Self {
        let mut evidence =
            Self::from_verified_native_records(observation, joined_cut, sample_projection);
        evidence.sample_projection.kind =
            ReplayMarketDependencyKindV2::StrategyInputSampleProjectionV4;
        evidence
    }
}

#[derive(Clone, Copy)]
pub(crate) struct ReplayVerifiedNativeRecordV2 {
    pub(crate) identity: BindingDigest,
    pub(crate) digest: BindingDigest,
}

impl ReplayVerifiedNativeRecordV2 {
    pub(crate) const fn from_verified_native_record(
        identity: BindingDigest,
        digest: BindingDigest,
    ) -> Self {
        Self { identity, digest }
    }
}

#[derive(Clone, Copy)]
pub(crate) struct ReplayVerifiedNativeDerivedRecordV2 {
    pub(crate) record: ReplayVerifiedNativeRecordV2,
    pub(crate) subject: ReplayVerifiedNativeRecordV2,
}

impl ReplayVerifiedNativeDerivedRecordV2 {
    pub(crate) const fn from_verified_native_record(
        record: ReplayVerifiedNativeRecordV2,
        subject: ReplayVerifiedNativeRecordV2,
    ) -> Self {
        Self { record, subject }
    }
}

impl ReplayMarketDependencyRefV2 {
    pub(crate) const fn from_verified_owner_record(
        kind: ReplayMarketDependencyKindV2,
        identity: BindingDigest,
        digest: BindingDigest,
    ) -> Self {
        Self {
            kind,
            identity,
            digest,
        }
    }
}

pub(crate) fn issue_replay_market_facts_v2(
    request: &UntrustedReplayMarketFactsRequestV2,
    evidence: ReplayMarketFactsEvidenceV2,
) -> Result<ReplayMarketFactsReadbackV2, ReplayMarketFactsErrorV2> {
    validate_request(request)?;
    let (dependencies, native_chain) =
        validate_dependencies(evidence.base_dependencies, evidence.native_chain)?;
    validate_request_dependencies(request, &dependencies)?;

    if evidence.reference_cuts.len() != REQUIRED_REFERENCE_KINDS.len() {
        return Err(ReplayMarketFactsErrorV2::IncompleteReferenceCuts);
    }
    let total_facts = evidence
        .reference_cuts
        .iter()
        .try_fold(0_usize, |total, cut| total.checked_add(cut.facts.len()))
        .ok_or(ReplayMarketFactsErrorV2::CapacityExceeded)?;

    if total_facts > MAX_TOTAL_FACTS {
        return Err(ReplayMarketFactsErrorV2::CapacityExceeded);
    }
    preflight_reference_cuts(request, &dependencies, &evidence.reference_cuts)?;
    let reference_cuts = evidence
        .reference_cuts
        .into_iter()
        .map(|proposal| issue_reference_cut(request, &dependencies, proposal))
        .collect::<Result<Vec<_>, _>>()?;
    validate_replay_semantics(request_context(request)?, &dependencies, &reference_cuts)?;
    let frontier = issue_frontier(&dependencies, native_chain, &reference_cuts)?;
    let facts = issue_facts(request, reference_cuts, frontier)?;
    let receipt = issue_receipt(&facts, evidence.stable_correlation)?;
    let readback = ReplayMarketFactsReadbackV2 { facts, receipt };

    if verify_replay_market_facts_readback_v2(&readback) {
        Ok(readback)
    } else {
        Err(ReplayMarketFactsErrorV2::DigestMismatch)
    }
}

fn checked_size_sum(
    values: impl IntoIterator<Item = usize>,
) -> Result<usize, ReplayMarketFactsErrorV2> {
    values
        .into_iter()
        .try_fold(0_usize, usize::checked_add)
        .ok_or(ReplayMarketFactsErrorV2::CapacityExceeded)
}

fn field_encoded_size(value: &[u8]) -> Result<usize, ReplayMarketFactsErrorV2> {
    if value.len() > MAX_FIELD_BYTES {
        return Err(ReplayMarketFactsErrorV2::CapacityExceeded);
    }
    4_usize
        .checked_add(value.len())
        .ok_or(ReplayMarketFactsErrorV2::CapacityExceeded)
}

fn value_encoded_size(
    value: &ReplayReferenceFactValueV2,
) -> Result<usize, ReplayMarketFactsErrorV2> {
    let body = match value {
        ReplayReferenceFactValueV2::Calendar {
            calendar_identity, ..
        } => checked_size_sum([field_encoded_size(calendar_identity)?, 4, 1])?,
        ReplayReferenceFactValueV2::Session {
            session_identity,
            calendar_identity,
            ..
        } => checked_size_sum([
            field_encoded_size(session_identity)?,
            field_encoded_size(calendar_identity)?,
            16,
            16,
        ])?,
        ReplayReferenceFactValueV2::TimeZone {
            time_zone_identity, ..
        } => checked_size_sum([field_encoded_size(time_zone_identity)?, 32, 4])?,
        ReplayReferenceFactValueV2::MarketSemantics { .. } => 32 + 2 + 2 + 32 + 32,
        ReplayReferenceFactValueV2::CorrectionPolicy {
            stream_identity, ..
        } => checked_size_sum([field_encoded_size(stream_identity)?, 8, 1])?,
        ReplayReferenceFactValueV2::CorporateAction {
            instrument, terms, ..
        } => {
            let terms_size = match terms {
                ReplayCorporateActionTermsV2::Split { .. } => 2 + 8 + 8,
                ReplayCorporateActionTermsV2::CashDividend {
                    currency_identity, ..
                } => checked_size_sum([2, 16, 1, field_encoded_size(currency_identity)?])?,
                ReplayCorporateActionTermsV2::SymbolChange {
                    successor_instrument,
                }
                | ReplayCorporateActionTermsV2::Roll {
                    successor_instrument,
                } => checked_size_sum([2, field_encoded_size(successor_instrument)?])?,
                ReplayCorporateActionTermsV2::Expiry => 2,
            };
            checked_size_sum([32, field_encoded_size(instrument)?, terms_size])?
        }
        ReplayReferenceFactValueV2::HistoricalMembership {
            member_key,
            instrument,
            ..
        } => checked_size_sum([
            32,
            field_encoded_size(member_key)?,
            field_encoded_size(instrument)?,
            1,
        ])?,
    };
    checked_size_sum([2, body])
}

fn fact_encoded_size(
    proposal: &ReplayReferenceFactProposalV2,
) -> Result<usize, ReplayMarketFactsErrorV2> {
    validate_reference_fact(proposal)?;
    let optional_until = if proposal.time.effective_until_ns.is_some() {
        16
    } else {
        0
    };
    let time_size = checked_size_sum([16, 1, optional_until, 16, 16, 16, 16, 8])?;
    checked_size_sum([
        2,
        4,
        canonical_scope_encoded_size(),
        value_encoded_size(&proposal.value)?,
        time_size,
        32,
        32,
    ])
}

const fn canonical_scope_encoded_size() -> usize {
    2 + 32 + 8 + 8 + 8 + 32 + 16 + 16 + 2 + 32
}

fn preflight_reference_cuts(
    request: &UntrustedReplayMarketFactsRequestV2,
    dependencies: &[ReplayMarketDependencyRefV2],
    proposals: &[ReplayReferenceFactCutProposalV2],
) -> Result<(), ReplayMarketFactsErrorV2> {
    let mut aggregate_size = checked_size_sum([
        2,
        32 * 4,
        8 * 3,
        field_encoded_size(
            request
                .pit_locator()
                .time_evidence
                .decision_cut
                .clock_identity
                .as_bytes(),
        )?,
        field_encoded_size(
            request
                .pit_locator()
                .time_evidence
                .decision_cut
                .clock_epoch
                .as_bytes(),
        )?,
        16 * 2,
        32,
        4,
    ])?;

    for proposal in proposals {
        if proposal.facts.len() > MAX_FACTS_PER_CUT {
            return Err(ReplayMarketFactsErrorV2::CapacityExceeded);
        }
        validate_scope(
            request_context(request)?,
            dependencies,
            proposal.kind,
            proposal.scope,
        )?;
        let mut cut_size = checked_size_sum([2, 2, 4, canonical_scope_encoded_size(), 4])?;

        for fact in &proposal.facts {
            let fact_size = fact_encoded_size(fact)?;
            if fact_size > MAX_FACT_BYTES {
                return Err(ReplayMarketFactsErrorV2::CapacityExceeded);
            }
            cut_size = checked_size_sum([cut_size, 32, 4, fact_size])?;
            if cut_size > MAX_CUT_BYTES {
                return Err(ReplayMarketFactsErrorV2::CapacityExceeded);
            }
        }
        aggregate_size = checked_size_sum([aggregate_size, 2, 32, 4, cut_size])?;
        if aggregate_size > MAX_AGGREGATE_BYTES {
            return Err(ReplayMarketFactsErrorV2::CapacityExceeded);
        }
    }
    Ok(())
}

fn validate_request(
    request: &UntrustedReplayMarketFactsRequestV2,
) -> Result<(), ReplayMarketFactsErrorV2> {
    let locator = request.pit_locator();
    let time = &locator.time_evidence;
    let decision_clock = &time.decision_cut.clock_identity;
    let decision_epoch = &time.decision_cut.clock_epoch;
    let comparable = [
        (
            &time.event_effective.clock_identity,
            &time.event_effective.clock_epoch,
        ),
        (
            &time.provider_available.clock_identity,
            &time.provider_available.clock_epoch,
        ),
        (&time.retrieval.clock_identity, &time.retrieval.clock_epoch),
    ]
    .into_iter()
    .all(|(clock, epoch)| clock == decision_clock && epoch == decision_epoch)
        && time
            .correction_publication
            .as_ref()
            .is_none_or(|coordinate| {
                &coordinate.clock_identity == decision_clock
                    && &coordinate.clock_epoch == decision_epoch
            });
    let observations_within_boundary = time.event_effective.value <= time.observed_at
        && time.provider_available.value <= time.observed_at
        && time.retrieval.value <= time.observed_at
        && time
            .correction_publication
            .as_ref()
            .is_none_or(|coordinate| coordinate.value <= time.observed_at);

    if request.replay_start_event_ns() >= request.replay_end_event_ns_exclusive()
        || locator.request_identity.as_bytes() == &[0; 32]
        || locator.snapshot_identity.as_bytes() == &[0; 32]
        || locator.fact_digest.as_bytes() == &[0; 32]
        || locator.time_evidence.decision_cut.value == 0
        || decision_clock.is_empty()
        || decision_epoch.is_empty()
        || decision_clock.len() > MAX_FIELD_BYTES
        || decision_epoch.len() > MAX_FIELD_BYTES
        || !comparable
        || !observations_within_boundary
        || time.observed_at >= time.valid_through
        || time.decision_cut.value > time.observed_at
    {
        Err(ReplayMarketFactsErrorV2::InvalidRequest)
    } else {
        Ok(())
    }
}

fn validate_dependencies(
    mut dependencies: Vec<ReplayMarketDependencyRefV2>,
    evidence: ReplayNativeChainEvidenceV2,
) -> Result<(Box<[ReplayMarketDependencyRefV2]>, ReplayNativeChainV2), ReplayMarketFactsErrorV2> {
    if dependencies.len() != REQUIRED_BASE_DEPENDENCY_KINDS.len() {
        return Err(ReplayMarketFactsErrorV2::DependencyMismatch);
    }
    dependencies.sort_by_key(|value| value.kind);
    let kinds = dependencies
        .iter()
        .map(|value| value.kind)
        .collect::<Vec<_>>();

    if kinds.as_slice() != REQUIRED_BASE_DEPENDENCY_KINDS
        || dependencies.iter().any(|value| {
            value.identity.as_bytes() == &[0; 32] || value.digest.as_bytes() == &[0; 32]
        })
    {
        return Err(ReplayMarketFactsErrorV2::DependencyMismatch);
    }
    let native_chain = ReplayNativeChainV2 {
        observation_census: evidence.observation_census,
        joined_cut: evidence.joined_cut,
        joined_cut_observation_subject: evidence.joined_cut_observation_subject,
        joined_cut_observation_subject_digest: evidence.joined_cut_observation_subject_digest,
        sample_projection: evidence.sample_projection,
        sample_projection_joined_cut_subject: evidence.sample_projection_joined_cut_subject,
        sample_projection_joined_cut_subject_digest: evidence
            .sample_projection_joined_cut_subject_digest,
    };
    validate_native_chain(native_chain)?;
    dependencies.extend([
        native_chain.observation_census,
        native_chain.joined_cut,
        native_chain.sample_projection,
    ]);
    Ok((dependencies.into_boxed_slice(), native_chain))
}

fn validate_native_chain(chain: ReplayNativeChainV2) -> Result<(), ReplayMarketFactsErrorV2> {
    let refs = [
        chain.observation_census,
        chain.joined_cut,
        chain.sample_projection,
    ];

    if refs.iter().any(|value| {
        value.identity().as_bytes() == &[0; 32] || value.digest().as_bytes() == &[0; 32]
    }) || chain.observation_census.kind() != ReplayMarketDependencyKindV2::ObservationCensusV1
        || chain.joined_cut.kind() != ReplayMarketDependencyKindV2::StrategyInputJoinedCutV1
        || !matches!(
            chain.sample_projection.kind(),
            ReplayMarketDependencyKindV2::StrategyInputSampleProjectionV2
                | ReplayMarketDependencyKindV2::StrategyInputSampleProjectionV4
        )
        || chain.joined_cut_observation_subject != chain.observation_census.identity()
        || chain.joined_cut_observation_subject_digest != chain.observation_census.digest()
        || chain.sample_projection_joined_cut_subject != chain.joined_cut.identity()
        || chain.sample_projection_joined_cut_subject_digest != chain.joined_cut.digest()
    {
        Err(ReplayMarketFactsErrorV2::DependencyMismatch)
    } else {
        Ok(())
    }
}

fn validate_request_dependencies(
    request: &UntrustedReplayMarketFactsRequestV2,
    dependencies: &[ReplayMarketDependencyRefV2],
) -> Result<(), ReplayMarketFactsErrorV2> {
    let locator = request.pit_locator();
    let pit = dependencies
        .iter()
        .find(|value| value.kind == ReplayMarketDependencyKindV2::PitSnapshotV1)
        .ok_or(ReplayMarketFactsErrorV2::DependencyMismatch)?;
    let source = dependencies
        .iter()
        .find(|value| value.kind == ReplayMarketDependencyKindV2::SourceBindingV1)
        .ok_or(ReplayMarketFactsErrorV2::DependencyMismatch)?;

    if pit.identity != locator.snapshot_identity
        || pit.digest != locator.fact_digest
        || source.identity != locator.source_binding_identity
    {
        Err(ReplayMarketFactsErrorV2::DependencyMismatch)
    } else {
        Ok(())
    }
}

fn issue_reference_cut(
    request: &UntrustedReplayMarketFactsRequestV2,
    dependencies: &[ReplayMarketDependencyRefV2],
    mut proposal: ReplayReferenceFactCutProposalV2,
) -> Result<ReplayReferenceFactCutV2, ReplayMarketFactsErrorV2> {
    if proposal.facts.len() > MAX_FACTS_PER_CUT {
        return Err(ReplayMarketFactsErrorV2::CapacityExceeded);
    }
    let scope = validate_scope(
        request_context(request)?,
        dependencies,
        proposal.kind,
        proposal.scope,
    )?;
    let allows_empty = matches!(
        proposal.kind,
        ReplayReferenceFactKindV2::CorporateAction
            | ReplayReferenceFactKindV2::HistoricalMembership
    );

    if proposal.facts.is_empty() && !allows_empty {
        return Err(ReplayMarketFactsErrorV2::InvalidFactCut);
    }
    let mut facts = proposal
        .facts
        .drain(..)
        .map(|fact| issue_reference_fact(fact, scope))
        .collect::<Result<Vec<_>, _>>()?;

    if facts.iter().any(|fact| fact.kind() != proposal.kind) {
        return Err(ReplayMarketFactsErrorV2::InvalidFactCut);
    }

    if facts
        .iter()
        .any(|fact| fact.time().decision_cut != scope.pit_decision_cut)
    {
        return Err(ReplayMarketFactsErrorV2::InvalidFactCut);
    }
    facts.sort_by_key(ReplayReferenceFactV2::identity);
    if facts
        .windows(2)
        .any(|pair| pair[0].identity() >= pair[1].identity())
    {
        return Err(ReplayMarketFactsErrorV2::NonCanonicalOrder);
    }
    validate_logical_histories(request_context(request)?, proposal.kind, &facts)?;
    let scope_canonical_bytes = canonical_scope_bytes(scope)?;
    let mut encoder = Encoder::new(MAX_CUT_BYTES);
    encoder.u16(proposal.kind as u16);
    encoder.nested_bytes(&scope_canonical_bytes)?;
    encoder.u32(
        u32::try_from(facts.len())
            .map_err(|_| ReplayMarketFactsErrorV2::CanonicalEncodingUnavailable)?,
    );

    for fact in &facts {
        encoder.digest(fact.identity());
        encoder.nested_bytes(fact.canonical_bytes())?;
    }
    let canonical_bytes = encoder.finish()?;
    let identity = digest(CUT_DOMAIN, &canonical_bytes);
    Ok(ReplayReferenceFactCutV2 {
        kind: proposal.kind,
        scope,
        scope_canonical_bytes,
        decision_cut: scope.pit_decision_cut,
        facts: facts.into_boxed_slice(),
        canonical_bytes,
        identity,
    })
}

fn issue_reference_fact(
    proposal: ReplayReferenceFactProposalV2,
    scope: ReplayReferenceFactScopeV2,
) -> Result<ReplayReferenceFactV2, ReplayMarketFactsErrorV2> {
    validate_reference_fact(&proposal)?;
    let mut encoder = Encoder::new(MAX_FACT_BYTES);
    encoder.nested_bytes(&canonical_scope_bytes(scope)?)?;
    encode_value(&mut encoder, &proposal.value)?;
    encode_time(&mut encoder, proposal.time);
    encoder.digest(proposal.source_identity);
    encoder.digest(proposal.correction_identity);
    let canonical_bytes = encoder.finish()?;
    let identity = digest(FACT_DOMAIN, &canonical_bytes);
    Ok(ReplayReferenceFactV2 {
        value: proposal.value,
        time: proposal.time,
        scope,
        source_identity: proposal.source_identity,
        correction_identity: proposal.correction_identity,
        canonical_bytes,
        identity,
    })
}

fn validate_reference_fact(
    proposal: &ReplayReferenceFactProposalV2,
) -> Result<(), ReplayMarketFactsErrorV2> {
    validate_reference_fact_parts(
        &proposal.value,
        proposal.time,
        proposal.source_identity,
        proposal.correction_identity,
    )
}

fn validate_reference_fact_parts(
    value: &ReplayReferenceFactValueV2,
    time: ReplayReferenceFactTimeV2,
    source_identity: BindingDigest,
    correction_identity: BindingDigest,
) -> Result<(), ReplayMarketFactsErrorV2> {
    if source_identity.as_bytes() == &[0; 32]
        || correction_identity.as_bytes() == &[0; 32]
        || time.decision_cut == 0
        || time
            .effective_until_ns
            .is_some_and(|until| until <= time.effective_from_ns)
        || time.provider_available_ns > time.owner_observation_ns
        || time.retrieval_ns > time.owner_observation_ns
        || time.correction_publication_ns > time.owner_observation_ns
    {
        return Err(ReplayMarketFactsErrorV2::InvalidFact);
    }
    let valid = match value {
        ReplayReferenceFactValueV2::Calendar {
            calendar_identity, ..
        } => !calendar_identity.is_empty(),
        ReplayReferenceFactValueV2::Session {
            session_identity,
            calendar_identity,
            opens_at_ns,
            closes_at_ns,
        } => {
            !session_identity.is_empty()
                && !calendar_identity.is_empty()
                && opens_at_ns < closes_at_ns
        }
        ReplayReferenceFactValueV2::TimeZone {
            time_zone_identity,
            ruleset_identity,
            ..
        } => !time_zone_identity.is_empty() && ruleset_identity.as_bytes() != &[0; 32],
        ReplayReferenceFactValueV2::MarketSemantics {
            normalization_identity,
            price_adjustment,
            timestamp_basis,
            price_unit_identity,
            size_unit_identity,
        } => {
            normalization_identity.as_bytes() != &[0; 32]
                && price_unit_identity.as_bytes() != &[0; 32]
                && size_unit_identity.as_bytes() != &[0; 32]
                && valid_adjustment(*price_adjustment)
                && valid_timestamp_basis(*timestamp_basis)
        }
        ReplayReferenceFactValueV2::CorrectionPolicy {
            stream_identity,
            sequence,
            successor_only,
        } => !stream_identity.is_empty() && *sequence > 0 && *successor_only,
        ReplayReferenceFactValueV2::CorporateAction {
            action_identity,
            instrument,
            terms,
        } => {
            action_identity.as_bytes() != &[0; 32]
                && !instrument.is_empty()
                && valid_action_terms(terms)
        }
        ReplayReferenceFactValueV2::HistoricalMembership {
            selection_identity,
            member_key,
            instrument,
            ..
        } => {
            selection_identity.as_bytes() != &[0; 32]
                && !member_key.is_empty()
                && !instrument.is_empty()
        }
    };

    if valid {
        Ok(())
    } else {
        Err(ReplayMarketFactsErrorV2::InvalidFact)
    }
}

fn valid_action_terms(terms: &ReplayCorporateActionTermsV2) -> bool {
    match terms {
        ReplayCorporateActionTermsV2::Split {
            numerator,
            denominator,
        } => *numerator > 0 && *denominator > 0,
        ReplayCorporateActionTermsV2::CashDividend {
            mantissa,
            scale,
            currency_identity,
        } => *mantissa > 0 && *scale <= 38 && !currency_identity.is_empty(),
        ReplayCorporateActionTermsV2::SymbolChange {
            successor_instrument,
        }
        | ReplayCorporateActionTermsV2::Roll {
            successor_instrument,
        } => !successor_instrument.is_empty(),
        ReplayCorporateActionTermsV2::Expiry => true,
    }
}

#[derive(Clone, Copy)]
struct ReplayRequestContextV2 {
    pit_snapshot_identity: BindingDigest,
    pit_fact_digest: BindingDigest,
    pit_decision_cut: u64,
    pit_observed_at: u64,
    pit_valid_through: u64,
    pit_clock_digest: BindingDigest,
    replay_start_event_ns: i128,
    replay_end_event_ns_exclusive: i128,
}

fn request_context(
    request: &UntrustedReplayMarketFactsRequestV2,
) -> Result<ReplayRequestContextV2, ReplayMarketFactsErrorV2> {
    let time = &request.pit_locator().time_evidence;
    Ok(ReplayRequestContextV2 {
        pit_snapshot_identity: request.pit_locator().snapshot_identity,
        pit_fact_digest: request.pit_locator().fact_digest,
        pit_decision_cut: time.decision_cut.value,
        pit_observed_at: time.observed_at,
        pit_valid_through: time.valid_through,
        pit_clock_digest: pit_clock_digest(
            time.decision_cut.clock_identity.as_bytes(),
            time.decision_cut.clock_epoch.as_bytes(),
        )?,
        replay_start_event_ns: request.replay_start_event_ns(),
        replay_end_event_ns_exclusive: request.replay_end_event_ns_exclusive(),
    })
}

pub(crate) fn pit_clock_digest(
    clock_identity: &[u8],
    clock_epoch: &[u8],
) -> Result<BindingDigest, ReplayMarketFactsErrorV2> {
    let limit = MAX_FIELD_BYTES
        .checked_mul(2)
        .and_then(|value| value.checked_add(16))
        .ok_or(ReplayMarketFactsErrorV2::CapacityExceeded)?;
    let mut encoder = Encoder::new(limit);
    encoder.bytes(clock_identity)?;
    encoder.bytes(clock_epoch)?;
    Ok(digest(PIT_CLOCK_DOMAIN, &encoder.finish()?))
}

fn expected_authority_kind(kind: ReplayReferenceFactKindV2) -> ReplayMarketDependencyKindV2 {
    match kind {
        ReplayReferenceFactKindV2::Calendar
        | ReplayReferenceFactKindV2::Session
        | ReplayReferenceFactKindV2::TimeZone
        | ReplayReferenceFactKindV2::CorporateAction => {
            ReplayMarketDependencyKindV2::InstrumentMasterCutV1
        }
        ReplayReferenceFactKindV2::MarketSemantics
        | ReplayReferenceFactKindV2::CorrectionPolicy => {
            ReplayMarketDependencyKindV2::SourceBindingV1
        }
        ReplayReferenceFactKindV2::HistoricalMembership => {
            ReplayMarketDependencyKindV2::UniverseSelectionV1
        }
    }
}

fn validate_scope(
    context: ReplayRequestContextV2,
    dependencies: &[ReplayMarketDependencyRefV2],
    kind: ReplayReferenceFactKindV2,
    proposal: ReplayReferenceFactScopeProposalV2,
) -> Result<ReplayReferenceFactScopeV2, ReplayMarketFactsErrorV2> {
    let expected_kind = expected_authority_kind(kind);
    let authority = dependencies
        .iter()
        .find(|dependency| dependency.kind() == expected_kind)
        .ok_or(ReplayMarketFactsErrorV2::DependencyMismatch)?;

    if proposal.pit_snapshot_identity != context.pit_snapshot_identity
        || proposal.pit_decision_cut != context.pit_decision_cut
        || proposal.pit_observed_at != context.pit_observed_at
        || proposal.pit_valid_through != context.pit_valid_through
        || proposal.pit_clock_digest != context.pit_clock_digest
        || proposal.replay_start_event_ns != context.replay_start_event_ns
        || proposal.replay_end_event_ns_exclusive != context.replay_end_event_ns_exclusive
        || proposal.authority_kind != expected_kind
        || proposal.authority_identity != authority.identity()
    {
        return Err(ReplayMarketFactsErrorV2::DependencyMismatch);
    }
    Ok(ReplayReferenceFactScopeV2 {
        pit_snapshot_identity: proposal.pit_snapshot_identity,
        pit_decision_cut: proposal.pit_decision_cut,
        pit_observed_at: proposal.pit_observed_at,
        pit_valid_through: proposal.pit_valid_through,
        pit_clock_digest: proposal.pit_clock_digest,
        replay_start_event_ns: proposal.replay_start_event_ns,
        replay_end_event_ns_exclusive: proposal.replay_end_event_ns_exclusive,
        authority_kind: proposal.authority_kind,
        authority_identity: proposal.authority_identity,
    })
}

fn canonical_scope_bytes(
    scope: ReplayReferenceFactScopeV2,
) -> Result<Box<[u8]>, ReplayMarketFactsErrorV2> {
    let mut encoder = Encoder::new(MAX_FIELD_BYTES);
    encoder.digest(scope.pit_snapshot_identity);
    encoder.u64(scope.pit_decision_cut);
    encoder.u64(scope.pit_observed_at);
    encoder.u64(scope.pit_valid_through);
    encoder.digest(scope.pit_clock_digest);
    encoder.i128(scope.replay_start_event_ns);
    encoder.i128(scope.replay_end_event_ns_exclusive);
    encoder.u16(scope.authority_kind as u16);
    encoder.digest(scope.authority_identity);
    encoder.finish()
}

fn logical_key(fact: &ReplayReferenceFactV2) -> Result<Box<[u8]>, ReplayMarketFactsErrorV2> {
    let mut encoder = Encoder::new(MAX_FIELD_BYTES);
    encoder.u16(fact.kind() as u16);
    match fact.value() {
        ReplayReferenceFactValueV2::Calendar {
            calendar_identity,
            trading_day,
            ..
        } => {
            encoder.bytes(calendar_identity)?;
            encoder.i32(*trading_day);
        }
        ReplayReferenceFactValueV2::Session {
            session_identity, ..
        } => encoder.bytes(session_identity)?,
        ReplayReferenceFactValueV2::TimeZone {
            time_zone_identity, ..
        } => encoder.bytes(time_zone_identity)?,
        ReplayReferenceFactValueV2::MarketSemantics { .. } => {}
        ReplayReferenceFactValueV2::CorrectionPolicy {
            stream_identity, ..
        } => encoder.bytes(stream_identity)?,
        ReplayReferenceFactValueV2::CorporateAction {
            action_identity, ..
        } => encoder.digest(*action_identity),
        ReplayReferenceFactValueV2::HistoricalMembership {
            selection_identity,
            member_key,
            ..
        } => {
            encoder.digest(*selection_identity);
            encoder.bytes(member_key)?;
        }
    }
    encoder.finish()
}

fn validate_logical_histories(
    context: ReplayRequestContextV2,
    kind: ReplayReferenceFactKindV2,
    facts: &[ReplayReferenceFactV2],
) -> Result<(), ReplayMarketFactsErrorV2> {
    let mut histories = BTreeMap::<Box<[u8]>, Vec<&ReplayReferenceFactV2>>::new();

    for fact in facts {
        histories.entry(logical_key(fact)?).or_default().push(fact);
    }

    for history in histories.values_mut() {
        history.sort_by_key(|fact| fact.time.effective_from_ns);
        let requires_coverage = matches!(
            kind,
            ReplayReferenceFactKindV2::TimeZone
                | ReplayReferenceFactKindV2::MarketSemantics
                | ReplayReferenceFactKindV2::CorrectionPolicy
        );
        let mut covered_until = context.replay_start_event_ns;
        let mut correction_identities = BTreeSet::new();

        for (index, fact) in history.iter().enumerate() {
            if !correction_identities.insert(fact.correction_identity) {
                return Err(ReplayMarketFactsErrorV2::InvalidFactCut);
            }

            if index > 0 {
                let prior = history[index - 1];
                let Some(prior_until) = prior.time.effective_until_ns else {
                    return Err(ReplayMarketFactsErrorV2::InvalidFactCut);
                };

                if prior_until > fact.time.effective_from_ns {
                    return Err(ReplayMarketFactsErrorV2::InvalidFactCut);
                }

                if let (
                    ReplayReferenceFactValueV2::CorrectionPolicy {
                        sequence: prior_sequence,
                        ..
                    },
                    ReplayReferenceFactValueV2::CorrectionPolicy { sequence, .. },
                ) = (&prior.value, &fact.value)
                    && sequence <= prior_sequence
                {
                    return Err(ReplayMarketFactsErrorV2::InvalidFactCut);
                }
            }

            if requires_coverage && fact.time.effective_from_ns > covered_until {
                return Err(ReplayMarketFactsErrorV2::InvalidFactCut);
            }
            covered_until = covered_until.max(
                fact.time
                    .effective_until_ns
                    .unwrap_or(context.replay_end_event_ns_exclusive),
            );
        }

        if requires_coverage && covered_until < context.replay_end_event_ns_exclusive {
            return Err(ReplayMarketFactsErrorV2::InvalidFactCut);
        }
    }
    Ok(())
}

fn validate_replay_semantics(
    context: ReplayRequestContextV2,
    dependencies: &[ReplayMarketDependencyRefV2],
    cuts: &[ReplayReferenceFactCutV2],
) -> Result<(), ReplayMarketFactsErrorV2> {
    validate_reference_cut_census(cuts)?;
    let source_binding_identity = dependencies
        .iter()
        .find(|dependency| dependency.kind() == ReplayMarketDependencyKindV2::SourceBindingV1)
        .map(ReplayMarketDependencyRefV2::identity)
        .ok_or(ReplayMarketFactsErrorV2::DependencyMismatch)?;
    let total_facts = cuts
        .iter()
        .try_fold(0_usize, |total, cut| total.checked_add(cut.facts.len()))
        .ok_or(ReplayMarketFactsErrorV2::CapacityExceeded)?;

    if total_facts > MAX_TOTAL_FACTS {
        return Err(ReplayMarketFactsErrorV2::CapacityExceeded);
    }

    for cut in cuts {
        if cut.facts.len() > MAX_FACTS_PER_CUT
            || cut.scope.pit_snapshot_identity != context.pit_snapshot_identity
            || cut.scope.pit_decision_cut != context.pit_decision_cut
            || cut.scope.pit_observed_at != context.pit_observed_at
            || cut.scope.pit_valid_through != context.pit_valid_through
            || cut.scope.pit_clock_digest != context.pit_clock_digest
            || cut.scope.replay_start_event_ns != context.replay_start_event_ns
            || cut.scope.replay_end_event_ns_exclusive != context.replay_end_event_ns_exclusive
            || cut.scope.authority_kind != expected_authority_kind(cut.kind)
            || dependencies.iter().all(|dependency| {
                dependency.kind() != cut.scope.authority_kind
                    || dependency.identity() != cut.scope.authority_identity
            })
            || cut.decision_cut != context.pit_decision_cut
        {
            return Err(ReplayMarketFactsErrorV2::InvalidFactCut);
        }
        let allows_empty = matches!(
            cut.kind,
            ReplayReferenceFactKindV2::CorporateAction
                | ReplayReferenceFactKindV2::HistoricalMembership
        );

        if cut.facts.is_empty() && !allows_empty {
            return Err(ReplayMarketFactsErrorV2::InvalidFactCut);
        }

        for fact in &cut.facts {
            validate_stored_fact(context, source_binding_identity, cut, fact)?;
        }
        validate_logical_histories(context, cut.kind, &cut.facts)?;
    }
    Ok(())
}

fn validate_stored_fact(
    context: ReplayRequestContextV2,
    source_binding_identity: BindingDigest,
    cut: &ReplayReferenceFactCutV2,
    fact: &ReplayReferenceFactV2,
) -> Result<(), ReplayMarketFactsErrorV2> {
    validate_reference_fact_parts(
        &fact.value,
        fact.time,
        fact.source_identity,
        fact.correction_identity,
    )?;
    let overlaps_window = fact.time.effective_from_ns < context.replay_end_event_ns_exclusive
        && fact
            .time
            .effective_until_ns
            .is_none_or(|until| until > context.replay_start_event_ns);
    let pit_boundary = i128::from(context.pit_observed_at);
    let available_before_pit = fact.time.provider_available_ns <= pit_boundary
        && fact.time.retrieval_ns <= pit_boundary
        && fact.time.correction_publication_ns <= pit_boundary
        && fact.time.owner_observation_ns <= pit_boundary;
    let membership_matches = match &fact.value {
        ReplayReferenceFactValueV2::HistoricalMembership {
            selection_identity, ..
        } => *selection_identity == cut.scope.authority_identity,
        _ => true,
    };
    let session_inside_window = match fact.value {
        ReplayReferenceFactValueV2::Session {
            opens_at_ns,
            closes_at_ns,
            ..
        } => {
            opens_at_ns >= context.replay_start_event_ns
                && closes_at_ns <= context.replay_end_event_ns_exclusive
        }
        _ => true,
    };

    if fact.kind() != cut.kind
        || fact.scope != cut.scope
        || fact.source_identity != source_binding_identity
        || fact.time.decision_cut != context.pit_decision_cut
        || !overlaps_window
        || !available_before_pit
        || !membership_matches
        || !session_inside_window
    {
        Err(ReplayMarketFactsErrorV2::InvalidFactCut)
    } else {
        Ok(())
    }
}

fn validate_reference_cut_census(
    cuts: &[ReplayReferenceFactCutV2],
) -> Result<(), ReplayMarketFactsErrorV2> {
    let kinds = cuts.iter().map(|cut| cut.kind).collect::<BTreeSet<_>>();
    if cuts.len() != REQUIRED_REFERENCE_KINDS.len()
        || kinds.len() != REQUIRED_REFERENCE_KINDS.len()
        || REQUIRED_REFERENCE_KINDS
            .iter()
            .any(|kind| !kinds.contains(kind))
    {
        Err(ReplayMarketFactsErrorV2::IncompleteReferenceCuts)
    } else {
        Ok(())
    }
}

fn issue_frontier(
    dependencies: &[ReplayMarketDependencyRefV2],
    native_chain: ReplayNativeChainV2,
    cuts: &[ReplayReferenceFactCutV2],
) -> Result<ReplayMarketFactsFrontierV2, ReplayMarketFactsErrorV2> {
    let mut reference_cut_identities = cuts
        .iter()
        .map(ReplayReferenceFactCutV2::identity)
        .collect::<Vec<_>>();
    reference_cut_identities.sort();
    let mut encoder = Encoder::new(MAX_FRONTIER_BYTES);
    encoder.u32(
        u32::try_from(dependencies.len())
            .map_err(|_| ReplayMarketFactsErrorV2::CanonicalEncodingUnavailable)?,
    );

    for dependency in dependencies {
        encode_dependency(&mut encoder, *dependency);
    }
    encode_native_chain(&mut encoder, native_chain);
    encoder.u32(
        u32::try_from(reference_cut_identities.len())
            .map_err(|_| ReplayMarketFactsErrorV2::CanonicalEncodingUnavailable)?,
    );

    for identity in &reference_cut_identities {
        encoder.digest(*identity);
    }
    let canonical_bytes = encoder.finish()?;
    let identity = digest(FRONTIER_DOMAIN, &canonical_bytes);
    Ok(ReplayMarketFactsFrontierV2 {
        dependencies: dependencies.to_vec().into_boxed_slice(),
        native_chain,
        reference_cut_identities: reference_cut_identities.into_boxed_slice(),
        canonical_bytes,
        identity,
    })
}

fn encode_native_chain(encoder: &mut Encoder, chain: ReplayNativeChainV2) {
    encode_dependency(encoder, chain.observation_census);
    encode_dependency(encoder, chain.joined_cut);
    encoder.digest(chain.joined_cut_observation_subject);
    encoder.digest(chain.joined_cut_observation_subject_digest);
    encode_dependency(encoder, chain.sample_projection);
    encoder.digest(chain.sample_projection_joined_cut_subject);
    encoder.digest(chain.sample_projection_joined_cut_subject_digest);
}

fn issue_facts(
    request: &UntrustedReplayMarketFactsRequestV2,
    mut reference_cuts: Vec<ReplayReferenceFactCutV2>,
    frontier: ReplayMarketFactsFrontierV2,
) -> Result<ReplayMarketFactsV2, ReplayMarketFactsErrorV2> {
    reference_cuts.sort_by_key(|cut| cut.kind);
    let locator = request.pit_locator();
    let mut encoder = Encoder::new(MAX_AGGREGATE_BYTES);
    encoder.digest(locator.request_identity);
    encoder.digest(locator.request_digest);
    encoder.digest(locator.snapshot_identity);
    encoder.digest(locator.fact_digest);
    encoder.u64(locator.time_evidence.decision_cut.value);
    encoder.u64(locator.time_evidence.observed_at);
    encoder.u64(locator.time_evidence.valid_through);
    encoder.bytes(locator.time_evidence.decision_cut.clock_identity.as_bytes())?;
    encoder.bytes(locator.time_evidence.decision_cut.clock_epoch.as_bytes())?;
    encoder.i128(request.replay_start_event_ns());
    encoder.i128(request.replay_end_event_ns_exclusive());
    encoder.digest(frontier.identity());
    encoder.u32(
        u32::try_from(reference_cuts.len())
            .map_err(|_| ReplayMarketFactsErrorV2::CanonicalEncodingUnavailable)?,
    );

    for cut in &reference_cuts {
        encoder.u16(cut.kind() as u16);
        encoder.digest(cut.identity());
        encoder.nested_bytes(cut.canonical_bytes())?;
    }
    let canonical_bytes = encoder.finish()?;
    let identity = digest(FACTS_DOMAIN, &canonical_bytes);
    Ok(ReplayMarketFactsV2 {
        request_identity: locator.request_identity,
        request_digest: locator.request_digest,
        pit_snapshot_identity: locator.snapshot_identity,
        pit_fact_digest: locator.fact_digest,
        pit_decision_cut: locator.time_evidence.decision_cut.value,
        pit_observed_at: locator.time_evidence.observed_at,
        pit_valid_through: locator.time_evidence.valid_through,
        pit_clock_identity: locator
            .time_evidence
            .decision_cut
            .clock_identity
            .as_bytes()
            .to_vec()
            .into_boxed_slice(),
        pit_clock_epoch: locator
            .time_evidence
            .decision_cut
            .clock_epoch
            .as_bytes()
            .to_vec()
            .into_boxed_slice(),
        replay_start_event_ns: request.replay_start_event_ns(),
        replay_end_event_ns_exclusive: request.replay_end_event_ns_exclusive(),
        reference_cuts: reference_cuts.into_boxed_slice(),
        frontier,
        canonical_bytes,
        identity,
    })
}

fn issue_receipt(
    facts: &ReplayMarketFactsV2,
    stable_correlation: BindingDigest,
) -> Result<ReplayMarketFactsReceiptV2, ReplayMarketFactsErrorV2> {
    if stable_correlation.as_bytes() == &[0; 32] {
        return Err(ReplayMarketFactsErrorV2::InvalidRequest);
    }
    let mut encoder = Encoder::new(MAX_RECEIPT_BYTES);
    encoder.digest(facts.request_identity());
    encoder.digest(facts.identity());
    encoder.digest(facts.frontier().identity());
    encoder.digest(stable_correlation);
    let canonical_bytes = encoder.finish()?;
    let identity = digest(RECEIPT_DOMAIN, &canonical_bytes);
    Ok(ReplayMarketFactsReceiptV2 {
        request_identity: facts.request_identity(),
        facts_identity: facts.identity(),
        frontier_identity: facts.frontier().identity(),
        stable_correlation,
        canonical_bytes,
        identity,
    })
}

/// Recomputes every canonical layer and rejects scalar/byte/cross-splice drift.
#[must_use]
pub fn verify_replay_market_facts_readback_v2(readback: &ReplayMarketFactsReadbackV2) -> bool {
    let facts = readback.facts();
    let receipt = readback.receipt();
    let dependencies = facts.frontier.dependencies.as_ref();
    let sizes_valid = facts.canonical_bytes.len() <= MAX_AGGREGATE_BYTES
        && facts.frontier.canonical_bytes.len() <= MAX_FRONTIER_BYTES
        && receipt.canonical_bytes.len() <= MAX_RECEIPT_BYTES
        && !facts.pit_clock_identity.is_empty()
        && !facts.pit_clock_epoch.is_empty()
        && facts.pit_clock_identity.len() <= MAX_FIELD_BYTES
        && facts.pit_clock_epoch.len() <= MAX_FIELD_BYTES
        && facts.reference_cuts.len() == REQUIRED_REFERENCE_KINDS.len()
        && facts.reference_cuts.iter().all(|cut| {
            cut.canonical_bytes.len() <= MAX_CUT_BYTES
                && cut.scope_canonical_bytes.len() <= MAX_FIELD_BYTES
                && cut
                    .facts
                    .iter()
                    .all(|fact| fact.canonical_bytes.len() <= MAX_FACT_BYTES)
        });

    if !sizes_valid {
        return false;
    }
    let Ok(clock_digest) = pit_clock_digest(&facts.pit_clock_identity, &facts.pit_clock_epoch)
    else {
        return false;
    };
    let context = ReplayRequestContextV2 {
        pit_snapshot_identity: facts.pit_snapshot_identity,
        pit_fact_digest: facts.pit_fact_digest,
        pit_decision_cut: facts.pit_decision_cut,
        pit_observed_at: facts.pit_observed_at,
        pit_valid_through: facts.pit_valid_through,
        pit_clock_digest: clock_digest,
        replay_start_event_ns: facts.replay_start_event_ns,
        replay_end_event_ns_exclusive: facts.replay_end_event_ns_exclusive,
    };
    let semantic_valid =
        validate_stored_dependencies(context, dependencies, facts.frontier.native_chain)
            .and_then(|()| validate_replay_semantics(context, dependencies, &facts.reference_cuts))
            .is_ok();

    if !semantic_valid {
        return false;
    }
    let mut expected_cut_identities = facts
        .reference_cuts
        .iter()
        .map(ReplayReferenceFactCutV2::identity)
        .collect::<Vec<_>>();
    expected_cut_identities.sort();

    facts
        .reference_cuts
        .iter()
        .map(|cut| cut.kind)
        .eq(REQUIRED_REFERENCE_KINDS)
        && facts.frontier.reference_cut_identities.as_ref() == expected_cut_identities
        && canonical_facts_bytes(facts).is_ok_and(|bytes| bytes.as_ref() == facts.canonical_bytes())
        && facts.identity == digest(FACTS_DOMAIN, facts.canonical_bytes())
        && canonical_frontier_bytes(&facts.frontier)
            .is_ok_and(|bytes| bytes.as_ref() == facts.frontier.canonical_bytes())
        && facts.frontier.identity == digest(FRONTIER_DOMAIN, facts.frontier.canonical_bytes())
        && facts.reference_cuts.iter().all(verify_cut)
        && canonical_receipt_bytes(receipt)
            .is_ok_and(|bytes| bytes.as_ref() == receipt.canonical_bytes())
        && receipt.identity == digest(RECEIPT_DOMAIN, receipt.canonical_bytes())
        && receipt.request_identity == facts.request_identity
        && receipt.facts_identity == facts.identity
        && receipt.frontier_identity == facts.frontier.identity
}

fn validate_stored_dependencies(
    context: ReplayRequestContextV2,
    dependencies: &[ReplayMarketDependencyRefV2],
    native_chain: ReplayNativeChainV2,
) -> Result<(), ReplayMarketFactsErrorV2> {
    let kinds = dependencies
        .iter()
        .map(ReplayMarketDependencyRefV2::kind)
        .collect::<Vec<_>>();

    if dependencies.len() != REQUIRED_DEPENDENCY_KINDS.len()
        || (kinds.as_slice() != REQUIRED_DEPENDENCY_KINDS
            && kinds.as_slice() != REQUIRED_DEPENDENCY_KINDS_V4)
        || dependencies.iter().any(|dependency| {
            dependency.identity().as_bytes() == &[0; 32]
                || dependency.digest().as_bytes() == &[0; 32]
        })
    {
        return Err(ReplayMarketFactsErrorV2::DependencyMismatch);
    }
    let pit = &dependencies[0];
    validate_native_chain(native_chain)?;

    if pit.identity() != context.pit_snapshot_identity
        || pit.digest() != context.pit_fact_digest
        || dependencies[4] != native_chain.observation_census
        || dependencies[5] != native_chain.joined_cut
        || dependencies[6] != native_chain.sample_projection
        || context.pit_observed_at >= context.pit_valid_through
        || context.pit_decision_cut > context.pit_observed_at
        || context.pit_clock_digest.as_bytes() == &[0; 32]
    {
        Err(ReplayMarketFactsErrorV2::DependencyMismatch)
    } else {
        Ok(())
    }
}

fn verify_cut(cut: &ReplayReferenceFactCutV2) -> bool {
    cut.facts.iter().all(verify_fact)
        && canonical_cut_bytes(cut).is_ok_and(|bytes| bytes.as_ref() == cut.canonical_bytes())
        && cut.identity == digest(CUT_DOMAIN, cut.canonical_bytes())
}

fn verify_fact(fact: &ReplayReferenceFactV2) -> bool {
    canonical_fact_bytes(fact).is_ok_and(|bytes| bytes.as_ref() == fact.canonical_bytes())
        && fact.identity == digest(FACT_DOMAIN, fact.canonical_bytes())
}

fn canonical_fact_bytes(
    fact: &ReplayReferenceFactV2,
) -> Result<Box<[u8]>, ReplayMarketFactsErrorV2> {
    let mut encoder = Encoder::new(MAX_FACT_BYTES);
    encoder.nested_bytes(&canonical_scope_bytes(fact.scope)?)?;
    encode_value(&mut encoder, &fact.value)?;
    encode_time(&mut encoder, fact.time);
    encoder.digest(fact.source_identity);
    encoder.digest(fact.correction_identity);
    encoder.finish()
}

fn canonical_cut_bytes(
    cut: &ReplayReferenceFactCutV2,
) -> Result<Box<[u8]>, ReplayMarketFactsErrorV2> {
    let mut encoder = Encoder::new(MAX_CUT_BYTES);
    encoder.u16(cut.kind as u16);
    let scope_bytes = canonical_scope_bytes(cut.scope)?;
    if scope_bytes.as_ref() != cut.scope_canonical_bytes.as_ref() {
        return Err(ReplayMarketFactsErrorV2::DigestMismatch);
    }
    encoder.nested_bytes(&scope_bytes)?;
    encoder.u32(
        u32::try_from(cut.facts.len())
            .map_err(|_| ReplayMarketFactsErrorV2::CanonicalEncodingUnavailable)?,
    );

    for fact in &cut.facts {
        encoder.digest(fact.identity());
        encoder.nested_bytes(fact.canonical_bytes())?;
    }
    encoder.finish()
}

fn canonical_frontier_bytes(
    frontier: &ReplayMarketFactsFrontierV2,
) -> Result<Box<[u8]>, ReplayMarketFactsErrorV2> {
    let mut encoder = Encoder::new(MAX_FRONTIER_BYTES);
    encoder.u32(
        u32::try_from(frontier.dependencies.len())
            .map_err(|_| ReplayMarketFactsErrorV2::CanonicalEncodingUnavailable)?,
    );

    for dependency in &frontier.dependencies {
        encode_dependency(&mut encoder, *dependency);
    }
    encode_native_chain(&mut encoder, frontier.native_chain);
    encoder.u32(
        u32::try_from(frontier.reference_cut_identities.len())
            .map_err(|_| ReplayMarketFactsErrorV2::CanonicalEncodingUnavailable)?,
    );

    for identity in &frontier.reference_cut_identities {
        encoder.digest(*identity);
    }
    encoder.finish()
}

fn canonical_facts_bytes(
    facts: &ReplayMarketFactsV2,
) -> Result<Box<[u8]>, ReplayMarketFactsErrorV2> {
    let mut encoder = Encoder::new(MAX_AGGREGATE_BYTES);
    encoder.digest(facts.request_identity);
    encoder.digest(facts.request_digest);
    encoder.digest(facts.pit_snapshot_identity);
    encoder.digest(facts.pit_fact_digest);
    encoder.u64(facts.pit_decision_cut);
    encoder.u64(facts.pit_observed_at);
    encoder.u64(facts.pit_valid_through);
    encoder.bytes(&facts.pit_clock_identity)?;
    encoder.bytes(&facts.pit_clock_epoch)?;
    encoder.i128(facts.replay_start_event_ns);
    encoder.i128(facts.replay_end_event_ns_exclusive);
    encoder.digest(facts.frontier.identity);
    encoder.u32(
        u32::try_from(facts.reference_cuts.len())
            .map_err(|_| ReplayMarketFactsErrorV2::CanonicalEncodingUnavailable)?,
    );

    for cut in &facts.reference_cuts {
        encoder.u16(cut.kind() as u16);
        encoder.digest(cut.identity());
        encoder.nested_bytes(cut.canonical_bytes())?;
    }
    encoder.finish()
}

fn canonical_receipt_bytes(
    receipt: &ReplayMarketFactsReceiptV2,
) -> Result<Box<[u8]>, ReplayMarketFactsErrorV2> {
    let mut encoder = Encoder::new(MAX_RECEIPT_BYTES);
    encoder.digest(receipt.request_identity);
    encoder.digest(receipt.facts_identity);
    encoder.digest(receipt.frontier_identity);
    encoder.digest(receipt.stable_correlation);
    encoder.finish()
}
