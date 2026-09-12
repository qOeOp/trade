//! Compile-time-only Owner-sealed multi-leg/multi-timeframe input-join corpus.
//!
//! The zero-argument issuer runs the real Source Binding, PIT preparation/verification, static
//! role-binding, and event-frame paths. It performs no network, persistence, clock, provider,
//! deployment, production, or trading effect.

use std::{collections::BTreeSet, fmt::Display};

use super::{
    PitSnapshotError, UntrustedCorrectionPublicationTime, UntrustedEventEffectiveTime,
    UntrustedPitObservation, UntrustedPitObservationBatchProposal, UntrustedPitSnapshotEvidence,
    UntrustedPitSnapshotProposal, UntrustedPitSnapshotRequest, UntrustedPitSnapshotTimeEvidence,
    UntrustedProviderAvailableTime, UntrustedRetrievalTime, UntrustedSnapshotDecisionCut,
    VerifiedPitObservationBatch,
    authority::{
        TestOnlyCanonicalBasisResolver, TestOnlyPitSnapshotOwner, derive_observation_batch_digest,
        prepare_observation_batch, refresh_request_claims, verify_observation_batch,
    },
};
use crate::owner::sample_projection::joined_cut_readback_for_event_corpus_acceptance_v2;
use crate::owner::{
    instrument_master::{
        BACKTEST_OWNER_V1, InstrumentClass, InstrumentDecimal, InstrumentMasterError,
        InstrumentMasterFactProposalV1, InstrumentMasterReadbackV1, InstrumentMasterScopeV1,
        InstrumentVenueSourceMapping, UntrustedInstrumentMasterRequestV1,
        authority::{
            build_cut as build_instrument_cut, build_fact as build_instrument_fact,
            build_readback as build_instrument_readback, build_receipt as build_instrument_receipt,
            clock_projection,
        },
    },
    research_pit_terminal::derive_snapshot_correction_rule_digest,
    sealed_replay_input::{
        SealedReplayInput, UntrustedSealedReplayInputRequest, seal_replay_input,
    },
    shared_time_evidence::{SharedTimeEvidenceError, build_head_fact},
    source_binding::{
        BindingDigest, MarketDataClockAdmission, SourceBindingError, UntrustedAdapterBinding,
        UntrustedCompleteFrontier, UntrustedCredentialAudienceClaim,
        UntrustedCredentialCapabilityClaim, UntrustedLicensePolicy, UntrustedMarketDataAsOf,
        UntrustedMarketSemantics, UntrustedOpaqueCredentialHandle, UntrustedSourceBindingLocator,
        UntrustedSourceBindingProposal, UntrustedTrustPolicy,
        authority::{
            OwnerLineage, OwnerSourceBindingDecision, TestOnlyInMemorySourceBindingOwner,
            build_stored_aggregate, derive_binding_id, derive_time_evidence_identity,
        },
    },
    strategy_input_binding::{
        MarketDataFieldSemantic, StrategyInputBindingReceipt, StrategyInputBindingUnavailable,
        StrategyInputChannel, StrategyInputUnit, UntrustedStrategyInputBindingRequest,
        UntrustedStrategyInputScope, bind_complete_strategy_input_event_frame,
        bind_strategy_input_event_corpus, bind_strategy_input_event_frame,
        bind_strategy_input_role, split_strategy_input_event_frames_by_role,
    },
    strategy_input_event_corpus_v1::{
        StrategyInputEventCorpusCandidateV1, StrategyInputEventCorpusUnavailableV1,
        StrategyInputEventReplayPackageV1, StrategyInputEventSourceV1,
        issue_strategy_input_event_replay_package_v1, issue_strategy_input_event_source_v1,
    },
    strategy_input_joined_cut::{
        StrategyInputJoinRoleClaimV1, StrategyInputJoinedCutReceiptV1,
        StrategyInputJoinedCutUnavailable, UntrustedStrategyInputJoinClaimV1,
        derive_strategy_input_join_identity_v2, issue_strategy_input_joined_cut_v1,
        seal_strategy_input_join_census_v1,
    },
};

const CLOCK_IDENTITY: &str = "SEALED_ACCEPTANCE.INPUT_JOIN.CLOCK";
const CLOCK_EPOCH: &str = "SEALED_ACCEPTANCE.INPUT_JOIN.EPOCH.1";
const DECISION_CUT: u64 = 10_000_000_000;
const VALID_THROUGH: u64 = 20_000_000_000;
const SCALE: u8 = 2;
const RESEARCH_REQUEST_IDENTITY: [u8; 32] = [1; 32];
const JOIN_DESIGN_IDENTITY: [u8; 32] = [
    10, 75, 161, 163, 79, 111, 168, 159, 214, 171, 14, 91, 175, 82, 107, 251, 251, 80, 226, 17,
    176, 64, 252, 227, 195, 47, 152, 147, 119, 140, 41, 168,
];
const JOIN_ROLE_IDENTITIES: [[u8; 32]; 4] = [
    [
        125, 83, 94, 142, 184, 38, 200, 124, 97, 64, 73, 74, 156, 9, 82, 66, 64, 44, 103, 127, 64,
        91, 64, 158, 232, 186, 252, 216, 253, 34, 174, 4,
    ],
    [
        74, 208, 132, 35, 159, 29, 60, 59, 177, 88, 186, 249, 237, 112, 116, 203, 190, 135, 158,
        41, 28, 189, 88, 154, 155, 37, 226, 194, 150, 198, 4, 232,
    ],
    [
        21, 114, 236, 117, 208, 33, 22, 42, 182, 37, 92, 231, 9, 110, 206, 218, 87, 18, 171, 20,
        44, 168, 192, 75, 27, 60, 210, 150, 142, 139, 111, 39,
    ],
    [
        242, 2, 186, 91, 85, 83, 174, 184, 176, 6, 222, 118, 198, 142, 136, 214, 237, 151, 249, 40,
        13, 236, 211, 5, 235, 209, 219, 25, 243, 56, 116, 79,
    ],
];
const EVENT_DESIGN_IDENTITY: [u8; 32] = [
    220, 56, 75, 21, 232, 77, 96, 21, 109, 74, 180, 178, 33, 246, 60, 177, 103, 27, 183, 237, 84,
    192, 112, 130, 114, 84, 170, 28, 105, 92, 63, 252,
];
const EVENT_ROLE_IDENTITIES: [[u8; 32]; 4] = [
    [
        243, 75, 152, 138, 87, 85, 233, 125, 157, 236, 32, 78, 65, 190, 154, 144, 88, 43, 210, 108,
        62, 235, 8, 194, 66, 17, 170, 146, 159, 53, 91, 31,
    ],
    [
        242, 206, 120, 35, 163, 98, 30, 238, 189, 99, 129, 85, 77, 115, 146, 195, 39, 94, 219, 86,
        146, 160, 189, 105, 33, 117, 74, 105, 110, 213, 75, 189,
    ],
    [
        246, 98, 25, 142, 214, 192, 193, 147, 216, 173, 148, 162, 130, 155, 107, 157, 249, 134,
        120, 244, 146, 35, 205, 78, 247, 173, 255, 107, 89, 84, 230, 156,
    ],
    [
        153, 10, 116, 63, 47, 16, 180, 155, 96, 225, 162, 199, 163, 170, 55, 85, 42, 148, 99, 45,
        135, 215, 165, 244, 202, 91, 254, 254, 196, 189, 157, 30,
    ],
];

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum JoinedInputSealedAcceptanceError {
    SourceBinding(SourceBindingError),
    PitSnapshot(PitSnapshotError),
    StrategyInput(StrategyInputBindingUnavailable),
    JoinedCut(StrategyInputJoinedCutUnavailable),
    InstrumentMaster(InstrumentMasterError),
    TimeEvidence(SharedTimeEvidenceError),
}

impl Display for JoinedInputSealedAcceptanceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for JoinedInputSealedAcceptanceError {}

impl From<SourceBindingError> for JoinedInputSealedAcceptanceError {
    fn from(value: SourceBindingError) -> Self {
        Self::SourceBinding(value)
    }
}

impl From<PitSnapshotError> for JoinedInputSealedAcceptanceError {
    fn from(value: PitSnapshotError) -> Self {
        Self::PitSnapshot(value)
    }
}

impl From<StrategyInputBindingUnavailable> for JoinedInputSealedAcceptanceError {
    fn from(value: StrategyInputBindingUnavailable) -> Self {
        Self::StrategyInput(value)
    }
}

impl From<StrategyInputJoinedCutUnavailable> for JoinedInputSealedAcceptanceError {
    fn from(value: StrategyInputJoinedCutUnavailable) -> Self {
        Self::JoinedCut(value)
    }
}

impl From<StrategyInputEventCorpusUnavailableV1> for JoinedInputSealedAcceptanceError {
    fn from(value: StrategyInputEventCorpusUnavailableV1) -> Self {
        Self::StrategyInput(match value {
            StrategyInputEventCorpusUnavailableV1::IncompleteCensus => {
                StrategyInputBindingUnavailable::MissingLifecycleCoordinate
            }
            StrategyInputEventCorpusUnavailableV1::UnsupportedLifecycle
            | StrategyInputEventCorpusUnavailableV1::NonCanonicalOrder
            | StrategyInputEventCorpusUnavailableV1::Duplicate
            | StrategyInputEventCorpusUnavailableV1::CrossSplice => {
                StrategyInputBindingUnavailable::NonUniqueResolution
            }
        })
    }
}

impl From<InstrumentMasterError> for JoinedInputSealedAcceptanceError {
    fn from(value: InstrumentMasterError) -> Self {
        Self::InstrumentMaster(value)
    }
}

impl From<SharedTimeEvidenceError> for JoinedInputSealedAcceptanceError {
    fn from(value: SharedTimeEvidenceError) -> Self {
        Self::TimeEvidence(value)
    }
}

/// Feature-gated, zero-effect package for downstream behavioral acceptance tests.
///
/// The package carries only real Owner-issued receipts. It exposes no constructor and grants no
/// production, persistence, provider, deployment, or trading capability.
#[derive(Debug)]
pub struct SealedAcceptanceStrategyInputEventReplayPackageV1 {
    bindings: Box<[StrategyInputBindingReceipt]>,
    package: StrategyInputEventReplayPackageV1,
    instrument_master: InstrumentMasterReadbackV1,
}

impl SealedAcceptanceStrategyInputEventReplayPackageV1 {
    pub fn bindings(&self) -> &[StrategyInputBindingReceipt] {
        &self.bindings
    }

    pub fn into_parts(
        self,
    ) -> (
        Box<[StrategyInputBindingReceipt]>,
        StrategyInputEventReplayPackageV1,
    ) {
        (self.bindings, self.package)
    }

    /// Moves the inseparable Owner-issued inputs into the downstream preparation acceptance path.
    pub fn into_preparation_parts(
        self,
    ) -> (
        Box<[StrategyInputBindingReceipt]>,
        StrategyInputEventReplayPackageV1,
        InstrumentMasterReadbackV1,
    ) {
        (self.bindings, self.package, self.instrument_master)
    }
}

/// Issues a complete three-EVENT corpus through the real Source Binding, PIT, binding, join, and
/// sample-projection Owner paths without external effects.
///
/// # Errors
///
/// Returns the first fail-closed Owner rejection without a partial package.
pub fn issue_strategy_input_event_replay_package_for_sealed_acceptance_v1()
-> Result<SealedAcceptanceStrategyInputEventReplayPackageV1, JoinedInputSealedAcceptanceError> {
    issue_event_corpus_package(issue_strategy_input_event_join_corpus_v1()?)
}

fn issue_event_corpus_package(
    mut joined: SealedAcceptanceStrategyInputJoinCorpus,
) -> Result<SealedAcceptanceStrategyInputEventReplayPackageV1, JoinedInputSealedAcceptanceError> {
    let candidates = joined
        .events()
        .iter()
        .map(|event| {
            Ok(StrategyInputEventCorpusCandidateV1::new(
                event.clone(),
                joined_cut_readback_for_event_corpus_acceptance_v2(event)
                    .map_err(|_| StrategyInputBindingUnavailable::MissingLifecycleCoordinate)?,
            ))
        })
        .collect::<Result<Vec<_>, StrategyInputBindingUnavailable>>()?;
    let source = joined
        .take_event_source()
        .ok_or(StrategyInputBindingUnavailable::MissingLifecycleCoordinate)?;
    let replay_input = joined
        .take_event_replay_input()
        .ok_or(StrategyInputBindingUnavailable::MissingLifecycleCoordinate)?;
    let instrument_master = joined
        .take_event_instrument_master()
        .ok_or(StrategyInputBindingUnavailable::MissingLifecycleCoordinate)?;
    let bindings = joined.bindings().to_vec().into_boxed_slice();
    let package =
        issue_strategy_input_event_replay_package_v1(replay_input, source, &bindings, candidates)?;
    Ok(SealedAcceptanceStrategyInputEventReplayPackageV1 {
        bindings,
        package,
        instrument_master,
    })
}

#[allow(
    dead_code,
    reason = "EVENT-only fields are consumed by the feature-gated in-crate acceptance oracle"
)]
#[derive(Debug)]
pub struct SealedAcceptanceStrategyInputJoinCorpus {
    bindings: Box<[StrategyInputBindingReceipt]>,
    events: Box<[StrategyInputJoinedCutReceiptV1]>,
    repeated_first: StrategyInputJoinedCutReceiptV1,
    alternate_join_claim_for_negative_test: StrategyInputJoinedCutReceiptV1,
    stale_selection_basis_for_negative_test: Option<StrategyInputJoinedCutReceiptV1>,
    event_source: Option<StrategyInputEventSourceV1>,
    event_replay_input: Option<SealedReplayInput>,
    event_instrument_master: Option<InstrumentMasterReadbackV1>,
    nonterminal_event_replay_input: Option<SealedReplayInput>,
    equal_value_cross_snapshot_source: Option<StrategyInputEventSourceV1>,
    missing: StrategyInputJoinedCutUnavailable,
    stale: StrategyInputJoinedCutUnavailable,
    cross_splice: StrategyInputJoinedCutUnavailable,
}

impl SealedAcceptanceStrategyInputJoinCorpus {
    pub fn bindings(&self) -> &[StrategyInputBindingReceipt] {
        &self.bindings
    }

    pub fn events(&self) -> &[StrategyInputJoinedCutReceiptV1] {
        &self.events
    }

    pub const fn repeated_first(&self) -> &StrategyInputJoinedCutReceiptV1 {
        &self.repeated_first
    }

    /// Returns fixed Owner-sealed evidence whose valid join claim intentionally differs from the
    /// canonical Strategy Plan. This exists only for cross-crate fail-close acceptance tests.
    pub const fn alternate_join_claim_for_negative_test(&self) -> &StrategyInputJoinedCutReceiptV1 {
        &self.alternate_join_claim_for_negative_test
    }

    /// Returns a valid cut from an incomplete census that omits the newest eligible non-trigger
    /// observation. Complete-corpus consumers must reject it against the retained full census.
    #[cfg(test)]
    pub(crate) fn stale_selection_basis_for_negative_test(
        &self,
    ) -> Option<&StrategyInputJoinedCutReceiptV1> {
        self.stale_selection_basis_for_negative_test.as_ref()
    }

    #[allow(dead_code, reason = "consumed only by the EVENT acceptance oracle")]
    pub(crate) fn take_event_source(&mut self) -> Option<StrategyInputEventSourceV1> {
        self.event_source.take()
    }

    pub(crate) fn take_event_replay_input(&mut self) -> Option<SealedReplayInput> {
        self.event_replay_input.take()
    }

    pub(crate) fn take_event_instrument_master(&mut self) -> Option<InstrumentMasterReadbackV1> {
        self.event_instrument_master.take()
    }

    #[allow(
        dead_code,
        reason = "consumed by the in-crate terminal-anchor rejection oracle"
    )]
    pub(crate) fn take_nonterminal_event_replay_input(&mut self) -> Option<SealedReplayInput> {
        self.nonterminal_event_replay_input.take()
    }

    #[allow(dead_code, reason = "consumed only by the EVENT acceptance oracle")]
    pub(crate) fn take_equal_value_cross_snapshot_source(
        &mut self,
    ) -> Option<StrategyInputEventSourceV1> {
        self.equal_value_cross_snapshot_source.take()
    }

    pub const fn stale(&self) -> StrategyInputJoinedCutUnavailable {
        self.stale
    }

    pub const fn missing(&self) -> StrategyInputJoinedCutUnavailable {
        self.missing
    }

    pub const fn cross_splice(&self) -> StrategyInputJoinedCutUnavailable {
        self.cross_splice
    }
}

/// Issues the immutable multi-leg/multi-timeframe acceptance corpus.
///
/// # Errors
///
/// Fails closed if any Source Binding, PIT, role-binding, or event-frame Owner check rejects.
///
pub fn issue_strategy_input_join_corpus()
-> Result<SealedAcceptanceStrategyInputJoinCorpus, JoinedInputSealedAcceptanceError> {
    let specs = [
        ("AAPL.XNAS", "1M", MarketDataFieldSemantic::BarOpenPrice),
        ("AAPL.XNAS", "1M", MarketDataFieldSemantic::BarClosePrice),
        ("MSFT.XNAS", "1H", MarketDataFieldSemantic::BarClosePrice),
        ("QQQ.XNAS", "1D", MarketDataFieldSemantic::BarClosePrice),
    ];
    issue_strategy_input_join_corpus_with_specs(specs, 500, false, 0)
}

/// Issues the acceptance-only three-EVENT variant through the same real Owner authorities.
#[allow(
    dead_code,
    reason = "consumed only by the feature-gated corpus acceptance oracle"
)]
pub(crate) fn issue_strategy_input_event_join_corpus_v1()
-> Result<SealedAcceptanceStrategyInputJoinCorpus, JoinedInputSealedAcceptanceError> {
    issue_event_join_corpus_from_batches(0, true)
}

fn issue_event_join_corpus_from_batches(
    authority_seed_offset: u8,
    include_foreign_source: bool,
) -> Result<SealedAcceptanceStrategyInputJoinCorpus, JoinedInputSealedAcceptanceError> {
    let specs = [
        ("AAPL.XNAS", "TICK", MarketDataFieldSemantic::QuoteBidPrice),
        ("AAPL.XNAS", "TICK", MarketDataFieldSemantic::QuoteAskPrice),
        ("MSFT.XNAS", "TICK", MarketDataFieldSemantic::TradeLastPrice),
        ("QQQ.XNAS", "TICK", MarketDataFieldSemantic::TradeLastPrice),
    ];
    let event_times = [1_000_000_000_u64, 3_000_000_000, 5_000_000_000];
    let seed = 61_u8.wrapping_add(authority_seed_offset);
    let clock = clock();
    let source_owner = TestOnlyInMemorySourceBindingOwner::default();
    let source_proposal = source_proposal(seed);
    let source_identity = derive_binding_id(&source_proposal);
    let stored_source = build_stored_aggregate(
        source_proposal.clone(),
        OwnerSourceBindingDecision {
            blockers: BTreeSet::new(),
        },
        OwnerLineage {
            root: source_identity,
            version: 1,
            predecessor_binding_id: None,
            predecessor_fact_digest: None,
        },
    );
    let source = source_owner.commit_initial(
        source_proposal,
        OwnerSourceBindingDecision {
            blockers: BTreeSet::new(),
        },
        &clock,
    )?;
    let instrument_master = issue_event_instrument_master(source.receipt().locator())?;
    let instrument_master_digest = instrument_master.digest();
    let mut aggregates = Vec::new();
    let mut batches = Vec::new();

    for (event_index, logical_time) in event_times.into_iter().enumerate() {
        let time_evidence = UntrustedPitSnapshotTimeEvidence {
            event_effective: UntrustedEventEffectiveTime::from_untrusted(
                logical_time,
                CLOCK_IDENTITY,
                CLOCK_EPOCH,
            ),
            provider_available: UntrustedProviderAvailableTime::from_untrusted(
                logical_time,
                CLOCK_IDENTITY,
                CLOCK_EPOCH,
            ),
            retrieval: UntrustedRetrievalTime::from_untrusted(
                logical_time + 1,
                CLOCK_IDENTITY,
                CLOCK_EPOCH,
            ),
            correction_publication: Some(UntrustedCorrectionPublicationTime::from_untrusted(
                logical_time,
                CLOCK_IDENTITY,
                CLOCK_EPOCH,
            )),
            decision_cut: UntrustedSnapshotDecisionCut::from_untrusted(
                DECISION_CUT,
                CLOCK_IDENTITY,
                CLOCK_EPOCH,
            ),
            monotonic_sequence: 1,
            restart_continuity_digest: digest_byte(7),
            skew_bound: 2,
            uncertainty_bound: 1,
            observed_at: DECISION_CUT,
            valid_through: VALID_THROUGH,
        };
        let mut request = UntrustedPitSnapshotRequest {
            claimed_request_identity: digest_byte(0),
            claimed_request_digest: digest_byte(0),
            correlation_identity: digest_byte(
                seed.wrapping_add(u8::try_from(event_index + 1).expect("bounded event fixture")),
            ),
            requester_identity: digest_byte(0xb1),
            scope_digest: digest_byte(0xd1),
            source_binding: source.receipt().locator().clone(),
            instrument_master_digest,
            universe_selection_digest: digest_byte(0xc2),
            market_semantics_identity: digest_byte(0xc3),
            time_evidence,
        };
        refresh_request_claims(&mut request);
        let evidence = UntrustedPitSnapshotEvidence {
            normalized_records_digest: digest_byte(0),
            source_frontier: source.receipt().locator().source_frontier.clone(),
            correction_frontier: source.receipt().locator().correction_frontier.clone(),
            coverage_complete: true,
            semantics_compatible: true,
            source_available: true,
        };
        let mut proposal = UntrustedPitSnapshotProposal { request, evidence };
        let mut rows = specs
            .iter()
            .enumerate()
            .map(
                |(role_index, (instrument, timeframe, field))| UntrustedPitObservation {
                    symbolic_key: format!("{instrument}.{timeframe}.{}", field_name(*field)),
                    member_key: (*instrument).into(),
                    instrument: (*instrument).into(),
                    channel: "MARKET".into(),
                    data_kind: data_kind(*field).into(),
                    timeframe: (*timeframe).into(),
                    field: field_name(*field).into(),
                    value_mantissa: 16_101
                        + i128::try_from(role_index * 10 + event_index).expect("bounded fixture"),
                    value_scale: SCALE,
                    event_effective: logical_time,
                    provider_available: logical_time,
                    retrieval: logical_time + 1,
                    correction_publication: logical_time,
                    source_binding_identity: proposal.request.source_binding.binding_id,
                    source_frontier_digest: proposal.evidence.source_frontier.digest,
                    instrument_master_digest: proposal.request.instrument_master_digest,
                    universe_selection_digest: proposal.request.universe_selection_digest,
                    market_semantics_identity: proposal.request.market_semantics_identity,
                    correction_stream_identity: proposal
                        .evidence
                        .correction_frontier
                        .stream_identity
                        .clone(),
                    correction_sequence: proposal.evidence.correction_frontier.sequence,
                    correction_frontier_digest: proposal.evidence.correction_frontier.digest,
                },
            )
            .collect::<Vec<_>>();
        rows.sort_by(|left, right| {
            (left.symbolic_key.as_str(), left.member_key.as_str())
                .cmp(&(right.symbolic_key.as_str(), right.member_key.as_str()))
        });
        let observations = UntrustedPitObservationBatchProposal { rows };
        proposal.evidence.normalized_records_digest =
            derive_observation_batch_digest(&observations)?;
        let prepared = prepare_observation_batch(&proposal, &observations)?;
        let basis = TestOnlyCanonicalBasisResolver::seal_for_test(
            proposal.request.clone(),
            proposal.evidence.clone(),
            clock.clone(),
        );
        let aggregate = TestOnlyPitSnapshotOwner::default().commit_initial(
            proposal,
            &basis,
            &source_owner,
            &clock,
        )?;
        let native_rows = prepared.native_rows()?;
        let verified = verify_observation_batch(
            &aggregate,
            aggregate.fact().source_binding_identity(),
            aggregate.fact().source_binding_lineage_root(),
            aggregate.fact().source_binding_lineage_version(),
            prepared.digest(),
            prepared.bytes(),
            &native_rows,
        )?;
        aggregates.push(aggregate);
        batches.push(verified);
    }
    let requests = specs
        .iter()
        .enumerate()
        .map(|(index, (instrument, timeframe, field))| {
            binding_request(
                &batches[0],
                BindingDigest::from_untrusted_bytes(EVENT_DESIGN_IDENTITY),
                BindingDigest::from_untrusted_bytes(EVENT_ROLE_IDENTITIES[index]),
                instrument,
                timeframe,
                *field,
            )
        })
        .collect::<Vec<_>>();
    let (bindings, first_frame) = bind_strategy_input_event_corpus(&requests, &batches[0])?;
    let mut frames = vec![first_frame];
    for batch in &batches[1..] {
        frames.push(bind_complete_strategy_input_event_frame(&bindings, batch)?);
    }
    let join_frames = split_strategy_input_event_frames_by_role(&frames);
    let claim = event_join_claim(3_000_000_000);
    let mut cumulative = Vec::new();
    let mut events = Vec::new();

    for (index, event_time) in event_times.into_iter().enumerate() {
        cumulative.extend(
            join_frames
                .iter()
                .filter(|frame| frame.trigger().lifecycle().logical_time() == event_time)
                .cloned(),
        );
        events.push(issue_strategy_input_joined_cut_v1(
            &claim,
            &bindings,
            &seal_strategy_input_join_census_v1(cumulative.clone())?,
            event_times[index],
        )?);
    }
    let repeated_first = issue_strategy_input_joined_cut_v1(
        &claim,
        &bindings,
        &seal_strategy_input_join_census_v1(
            join_frames
                .iter()
                .filter(|frame| frame.trigger().lifecycle().logical_time() == event_times[0])
                .cloned()
                .collect(),
        )?,
        event_times[0],
    )?;
    let alternate_join_claim_for_negative_test = issue_strategy_input_joined_cut_v1(
        &alternate_event_join_claim_for_negative_test(3_000_000_000),
        &bindings,
        &seal_strategy_input_join_census_v1(cumulative.clone())?,
        event_times[2],
    )?;
    let stale_selection_basis_for_negative_test = Some(issue_strategy_input_joined_cut_v1(
        &claim,
        &bindings,
        &seal_strategy_input_join_census_v1(
            join_frames
                .iter()
                .filter(|frame| {
                    frame.trigger().lifecycle().logical_time() < event_times[2]
                        || frame.values()[0].input_role_identity()
                            != BindingDigest::from_untrusted_bytes(EVENT_ROLE_IDENTITIES[0])
                })
                .cloned()
                .collect(),
        )?,
        event_times[2],
    )?);
    let event_source = issue_strategy_input_event_source_v1(&bindings, &batches)?;
    let aggregate = aggregates.last().expect("three EVENT aggregates");
    let verified = batches.last().expect("three EVENT batches");
    let event_replay_input = seal_event_replay_input(aggregate, &stored_source, verified)?;
    let nonterminal_event_replay_input =
        seal_event_replay_input(&aggregates[1], &stored_source, &batches[1])?;
    let equal_value_cross_snapshot_source = if include_foreign_source {
        issue_event_join_corpus_from_batches(20, false)?.event_source
    } else {
        None
    };
    Ok(SealedAcceptanceStrategyInputJoinCorpus {
        bindings,
        events: events.into_boxed_slice(),
        repeated_first,
        alternate_join_claim_for_negative_test,
        stale_selection_basis_for_negative_test,
        event_source: Some(event_source),
        event_replay_input: Some(event_replay_input),
        event_instrument_master: Some(instrument_master),
        nonterminal_event_replay_input: Some(nonterminal_event_replay_input),
        equal_value_cross_snapshot_source,
        missing: StrategyInputJoinedCutUnavailable::IncompleteCensus,
        stale: StrategyInputJoinedCutUnavailable::StaleComponent,
        cross_splice: StrategyInputJoinedCutUnavailable::CrossDesign,
    })
}

fn issue_event_instrument_master(
    source: &crate::owner::source_binding::UntrustedSourceBindingLocator,
) -> Result<InstrumentMasterReadbackV1, JoinedInputSealedAcceptanceError> {
    let clock = MarketDataClockAdmission::seal_for_test(
        "12345678901234567890123456789012",
        "abcdefghijklmnopqrstuvwxyzABCDEF",
        1,
        DECISION_CUT,
        DECISION_CUT,
        VALID_THROUGH,
        digest_byte(7),
        1,
        2,
    );
    let head = build_head_fact(&clock, None)?;
    let lifecycle_frontier = digest_byte(0xc4);
    let corporate_action_frontier = digest_byte(0xc5);
    let historical_membership_frontier = digest_byte(0xc6);
    let market_semantics_identity = digest_byte(0xc3);
    let members = ["AAPL.XNAS", "MSFT.XNAS", "QQQ.XNAS"]
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let facts = members
        .iter()
        .map(|instrument| {
            build_instrument_fact(
                InstrumentMasterFactProposalV1 {
                    canonical_identity: instrument.clone(),
                    predecessor_fact_digest: None,
                    mappings: vec![InstrumentVenueSourceMapping {
                        venue_identity: "XNAS".into(),
                        source_identity: "SIP".into(),
                        source_instrument: instrument.as_bytes().to_vec(),
                    }],
                    instrument_class: InstrumentClass::Equity,
                    base_currency: Some("USD".into()),
                    quote_currency: None,
                    settlement_currency: Some("USD".into()),
                    margin_currency: None,
                    price_increment: InstrumentDecimal {
                        mantissa: 1,
                        scale: 2,
                    },
                    quantity_increment: InstrumentDecimal {
                        mantissa: 1,
                        scale: 0,
                    },
                    contract_multiplier: InstrumentDecimal {
                        mantissa: 1,
                        scale: 0,
                    },
                    calendar_identity: "XNAS.CALENDAR.V1".into(),
                    session_identity: "XNAS.REGULAR.V1".into(),
                    time_zone_identity: "AMERICA_NEW_YORK.V1".into(),
                    lifecycle_frontier,
                    corporate_action_frontier,
                    historical_membership_frontier,
                    market_semantics_identity,
                    source_frontier: source.source_frontier.digest,
                    correction_frontier: source.correction_frontier.digest,
                    effective_from: 0,
                    effective_until: None,
                    provider_available: 5_000_000_001,
                    retrieval: 5_000_000_002,
                    correction_publication: 5_000_000_003,
                    owner_observation: 5_000_000_004,
                },
                &head.handoff,
                None,
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    let request = UntrustedInstrumentMasterRequestV1 {
        request_identity: digest_byte(0xc7),
        request_meaning_digest: digest_byte(0xc8),
        consumer_role: BACKTEST_OWNER_V1.into(),
        scope: InstrumentMasterScopeV1::UniverseSelectionRecord(digest_byte(0xc2)),
        effective_instant: 5_000_000_000,
        owner_observation: 5_000_000_004,
        decision_cut: DECISION_CUT,
        clock_head: head.handoff.locator().clone(),
        lifecycle_frontier,
        corporate_action_frontier,
        historical_membership_frontier,
        market_semantics_identity,
        source_frontier: source.source_frontier.digest,
        correction_frontier: source.correction_frontier.digest,
        stable_correlation: digest_byte(0xc9),
    };
    let cut = build_instrument_cut(
        &request,
        members,
        &facts,
        clock_projection(&head.handoff, None)?,
    )?;
    let receipt = build_instrument_receipt(&request, &facts, &cut, digest_byte(0xca), 1)?;
    Ok(build_instrument_readback(&receipt)?)
}

fn seal_event_replay_input(
    aggregate: &super::PitSnapshotCommitAggregate,
    source: &crate::owner::source_binding::authority::SourceBindingStoredAggregate,
    batch: &VerifiedPitObservationBatch,
) -> Result<SealedReplayInput, JoinedInputSealedAcceptanceError> {
    let fact = aggregate.fact();
    let semantics = &source.commit().fact().proposal().semantics;
    let replay_request = UntrustedSealedReplayInputRequest {
        consumer_role: "STRATEGY_FACTORY_RD_OWNER_API_V1".into(),
        locator: aggregate.receipt().locator().clone(),
        request_identity: fact.request_identity(),
        request_digest: fact.request_digest(),
        scope_digest: fact.request().scope_digest,
        source_binding_identity: fact.source_binding_identity(),
        source_binding_lineage_root: fact.source_binding_lineage_root(),
        source_binding_lineage_version: fact.source_binding_lineage_version(),
        source_frontier: fact.evidence().source_frontier.clone(),
        correction_frontier: fact.evidence().correction_frontier.clone(),
        instrument_master_digest: fact.request().instrument_master_digest,
        universe_selection_digest: fact.request().universe_selection_digest,
        market_semantics_identity: fact.request().market_semantics_identity,
        snapshot_correction_rule_digest: derive_snapshot_correction_rule_digest(
            fact.request(),
            fact.evidence().correction_frontier.clone(),
        )?,
        calendar_rules: semantics.calendar_rules.clone(),
        session_rules: semantics.session_rules.clone(),
        time_zone_rules: semantics.timezone_rules.clone(),
        corporate_action_rules: semantics.corporate_action_rules.clone(),
        historical_membership_rules: semantics.membership_rules.clone(),
    };
    Ok(seal_replay_input(
        aggregate,
        source,
        batch,
        &replay_request,
    )?)
}

fn issue_strategy_input_join_corpus_with_specs(
    specs: [(&str, &str, MarketDataFieldSemantic); 4],
    max_staleness_ns: u64,
    include_stale_selection_negative: bool,
    authority_seed_offset: u8,
) -> Result<SealedAcceptanceStrategyInputJoinCorpus, JoinedInputSealedAcceptanceError> {
    let event_times = [1_000_000_000_u64, 3_000_000_000, 5_000_000_000];
    let mut bindings = Vec::with_capacity(specs.len());
    let mut by_event = vec![Vec::with_capacity(specs.len()); event_times.len()];
    let mut stale = Vec::with_capacity(specs.len());
    let mut cross_splice = Vec::with_capacity(specs.len());
    let mut source_batches = Vec::with_capacity(specs.len() * event_times.len());
    let mut equal_value_foreign_batch = None;
    let mut equal_value_foreign_position = None;

    for (role_index, (instrument, timeframe, field)) in specs.into_iter().enumerate() {
        let role_seed = u8::try_from(role_index + 61)
            .expect("fixed role seed")
            .wrapping_add(authority_seed_offset);
        let clock = clock();
        let source_owner = TestOnlyInMemorySourceBindingOwner::default();
        let source = source_owner.commit_initial(
            source_proposal(role_seed),
            OwnerSourceBindingDecision {
                blockers: BTreeSet::new(),
            },
            &clock,
        )?;
        let mut role_binding = None;

        for (event_index, driver_time) in event_times.into_iter().enumerate() {
            let lag = match role_index {
                0 | 1 => 0,
                2 => 100,
                _ => 200,
            };
            let verified = verified_batch(
                &source_owner,
                source.receipt().locator(),
                &clock,
                role_seed,
                u8::try_from(event_index + 1).expect("fixed event seed"),
                instrument,
                timeframe,
                field,
                10_001 + i128::from(role_seed) * 100 + i128::from(event_index as u16),
                driver_time - lag,
            )?;
            source_batches.push(verified.clone());

            if role_binding.is_none() {
                role_binding = Some(bind_strategy_input_role(
                    &binding_request(
                        &verified,
                        BindingDigest::from_untrusted_bytes(JOIN_DESIGN_IDENTITY),
                        BindingDigest::from_untrusted_bytes(JOIN_ROLE_IDENTITIES[role_index]),
                        instrument,
                        timeframe,
                        field,
                    ),
                    &verified,
                )?);
            }
            by_event[event_index].push(bind_strategy_input_event_frame(
                std::slice::from_ref(role_binding.as_ref().expect("role binding exists")),
                &verified,
            )?);

            if include_stale_selection_negative && role_index == 0 && event_index == 2 {
                let foreign = verified_batch(
                    &source_owner,
                    source.receipt().locator(),
                    &clock,
                    role_seed,
                    99,
                    instrument,
                    timeframe,
                    field,
                    10_001 + i128::from(role_seed) * 100 + i128::from(event_index as u16),
                    driver_time - lag,
                )?;
                equal_value_foreign_position = Some(source_batches.len() - 1);
                equal_value_foreign_batch = Some(foreign);
            }
        }

        let stale_batch = verified_batch(
            &source_owner,
            source.receipt().locator(),
            &clock,
            role_seed,
            9,
            instrument,
            timeframe,
            field,
            20_000 + i128::from(role_seed),
            if role_index == 3 {
                6_999_999_000
            } else {
                7_000_000_000
            },
        )?;
        stale.push(bind_strategy_input_event_frame(
            std::slice::from_ref(role_binding.as_ref().expect("role binding exists")),
            &stale_batch,
        )?);

        let cross_batch = verified_batch(
            &source_owner,
            source.receipt().locator(),
            &clock,
            role_seed,
            10,
            instrument,
            timeframe,
            field,
            30_000 + i128::from(role_seed),
            9_000_000_000,
        )?;

        if role_index == 2 {
            let foreign = bind_strategy_input_role(
                &binding_request(
                    &cross_batch,
                    digest_byte(0xee),
                    BindingDigest::from_untrusted_bytes(JOIN_ROLE_IDENTITIES[role_index]),
                    instrument,
                    timeframe,
                    field,
                ),
                &cross_batch,
            )?;
            cross_splice.push(bind_strategy_input_event_frame(
                std::slice::from_ref(&foreign),
                &cross_batch,
            )?);
        } else {
            cross_splice.push(bind_strategy_input_event_frame(
                std::slice::from_ref(role_binding.as_ref().expect("role binding exists")),
                &cross_batch,
            )?);
        }
        bindings.push(role_binding.expect("role binding exists"));
    }

    let claim = join_claim(max_staleness_ns);
    let mut cumulative = Vec::new();
    let mut events = Vec::with_capacity(event_times.len());
    let mut repeated_first = None;

    for (event_index, frames) in by_event.into_iter().enumerate() {
        cumulative.extend(frames);
        let census = seal_strategy_input_join_census_v1(cumulative.clone())?;
        let receipt = issue_strategy_input_joined_cut_v1(
            &claim,
            &bindings,
            &census,
            event_times[event_index],
        )?;

        if event_index == 0 {
            repeated_first = Some(issue_strategy_input_joined_cut_v1(
                &claim,
                &bindings,
                &census,
                event_times[event_index],
            )?);
        }
        events.push(receipt);
    }
    let alternate_join_claim_for_negative_test = issue_strategy_input_joined_cut_v1(
        &alternate_join_claim_for_negative_test(max_staleness_ns),
        &bindings,
        &seal_strategy_input_join_census_v1(cumulative.clone())?,
        event_times[2],
    )?;
    let event_source = include_stale_selection_negative
        .then(|| issue_strategy_input_event_source_v1(&bindings, &source_batches))
        .transpose()?;
    let equal_value_cross_snapshot_source = if include_stale_selection_negative {
        let foreign = equal_value_foreign_batch
            .expect("fixed EVENT corpus produces equal-valued foreign snapshot evidence");
        let position = equal_value_foreign_position
            .expect("fixed EVENT source retains the substituted batch coordinate");
        let mut batches = source_batches;
        batches[position] = foreign;
        Some(issue_strategy_input_event_source_v1(&bindings, &batches)?)
    } else {
        None
    };
    let stale_selection_basis_for_negative_test = if include_stale_selection_negative {
        let stale_selection_census = seal_strategy_input_join_census_v1(
            cumulative
                .iter()
                .filter(|frame| {
                    let value = &frame.values()[0];
                    value.input_role_identity()
                        != BindingDigest::from_untrusted_bytes(JOIN_ROLE_IDENTITIES[0])
                        || frame.trigger().lifecycle().logical_time() != event_times[2]
                })
                .cloned()
                .collect(),
        )?;
        Some(issue_strategy_input_joined_cut_v1(
            &claim,
            &bindings,
            &stale_selection_census,
            event_times[2],
        )?)
    } else {
        None
    };
    let missing_census = seal_strategy_input_join_census_v1(
        cumulative
            .iter()
            .filter(|frame| {
                frame.values()[0].input_role_identity()
                    != BindingDigest::from_untrusted_bytes(JOIN_ROLE_IDENTITIES[3])
            })
            .cloned()
            .collect(),
    )?;
    let missing =
        issue_strategy_input_joined_cut_v1(&claim, &bindings, &missing_census, event_times[2])
            .expect_err("fixed incomplete census must fail closed");
    let stale_census = seal_strategy_input_join_census_v1(stale)?;
    let stale = issue_strategy_input_joined_cut_v1(
        &join_claim(500),
        &bindings,
        &stale_census,
        7_000_000_000,
    )
    .expect_err("fixed stale census must fail closed");
    let cross_census = seal_strategy_input_join_census_v1(cross_splice)?;
    let cross_splice =
        issue_strategy_input_joined_cut_v1(&claim, &bindings, &cross_census, 9_000_000_000)
            .expect_err("fixed cross-Design census must fail closed");

    Ok(SealedAcceptanceStrategyInputJoinCorpus {
        bindings: bindings.into_boxed_slice(),
        events: events.into_boxed_slice(),
        repeated_first: repeated_first.expect("fixed corpus has a first event"),
        alternate_join_claim_for_negative_test,
        stale_selection_basis_for_negative_test,
        event_source,
        event_replay_input: None,
        event_instrument_master: None,
        nonterminal_event_replay_input: None,
        equal_value_cross_snapshot_source,
        missing,
        stale,
        cross_splice,
    })
}

fn join_claim(max_staleness_ns: u64) -> UntrustedStrategyInputJoinClaimV1 {
    join_claim_with_identities(max_staleness_ns, JOIN_DESIGN_IDENTITY, JOIN_ROLE_IDENTITIES)
}

fn event_join_claim(max_staleness_ns: u64) -> UntrustedStrategyInputJoinClaimV1 {
    join_claim_with_identities(
        max_staleness_ns,
        EVENT_DESIGN_IDENTITY,
        EVENT_ROLE_IDENTITIES,
    )
}

fn join_claim_with_identities(
    max_staleness_ns: u64,
    design_identity: [u8; 32],
    role_identities: [[u8; 32]; 4],
) -> UntrustedStrategyInputJoinClaimV1 {
    let mut roles = [
        "research.input.open.v1",
        "research.input.close.v1",
        "research.input.msft-hour-close.v1",
        "research.input.qqq-day-close.v1",
    ]
    .into_iter()
    .zip(role_identities)
    .map(|(semantic_id, identity)| StrategyInputJoinRoleClaimV1 {
        semantic_id: semantic_id.into(),
        input_role_identity: BindingDigest::from_untrusted_bytes(identity),
    })
    .collect::<Vec<_>>();
    roles.sort_by(|left, right| left.semantic_id.cmp(&right.semantic_id));
    let inputs = roles
        .iter()
        .map(|role| role.semantic_id.clone())
        .collect::<Vec<_>>();
    let join_semantic_id = "research.input-join.cross-leg-regime.v1";
    let alignment_semantic_id = "strategy.input-join.latest-not-after-trigger.v1";
    let trigger_input_id = "research.input.close.v1";
    UntrustedStrategyInputJoinClaimV1 {
        strategy_design_identity: BindingDigest::from_untrusted_bytes(design_identity),
        join_semantic_id: join_semantic_id.into(),
        join_identity: derive_strategy_input_join_identity_v2(
            join_semantic_id,
            &inputs,
            alignment_semantic_id,
            trigger_input_id,
            max_staleness_ns,
        ),
        alignment_semantic_id: alignment_semantic_id.into(),
        trigger_input_id: trigger_input_id.into(),
        max_staleness_ns,
        roles,
    }
}

fn alternate_join_claim_for_negative_test(
    max_staleness_ns: u64,
) -> UntrustedStrategyInputJoinClaimV1 {
    alternate_join_claim(join_claim(max_staleness_ns))
}

fn alternate_event_join_claim_for_negative_test(
    max_staleness_ns: u64,
) -> UntrustedStrategyInputJoinClaimV1 {
    alternate_join_claim(event_join_claim(max_staleness_ns))
}

fn alternate_join_claim(
    mut claim: UntrustedStrategyInputJoinClaimV1,
) -> UntrustedStrategyInputJoinClaimV1 {
    claim.join_semantic_id = "research.input-join.alternate-negative-test.v1".into();
    let inputs = claim
        .roles
        .iter()
        .map(|role| role.semantic_id.clone())
        .collect::<Vec<_>>();
    claim.join_identity = derive_strategy_input_join_identity_v2(
        &claim.join_semantic_id,
        &inputs,
        &claim.alignment_semantic_id,
        &claim.trigger_input_id,
        claim.max_staleness_ns,
    );
    claim
}

fn clock() -> MarketDataClockAdmission {
    MarketDataClockAdmission::seal_for_test(
        CLOCK_IDENTITY,
        CLOCK_EPOCH,
        1,
        DECISION_CUT,
        DECISION_CUT,
        VALID_THROUGH,
        digest_byte(7),
        1,
        2,
    )
}

fn source_proposal(seed: u8) -> UntrustedSourceBindingProposal {
    let mut proposal = UntrustedSourceBindingProposal {
        claimed_binding_id: digest_byte(0),
        schema_version: 1,
        adapter: UntrustedAdapterBinding {
            implementation_digest: digest_byte(seed),
            configuration_digest: digest_byte(seed.wrapping_add(1)),
            authenticated_endpoint_identity: format!("sealed-acceptance://input-join/{seed}"),
            dataset_mapping: format!("INPUT-JOIN-ROLE-{seed}"),
            account_mapping: "NO_ACCOUNT_SEALED_ACCEPTANCE".into(),
        },
        credential_handle: UntrustedOpaqueCredentialHandle::from_untrusted_identity(
            digest_byte(seed.wrapping_add(4)),
            UntrustedCredentialAudienceClaim::MarketData,
            [
                UntrustedCredentialCapabilityClaim::MarketDataRead,
                UntrustedCredentialCapabilityClaim::ReferenceDataRead,
                UntrustedCredentialCapabilityClaim::MetadataRead,
            ],
        ),
        trust_policy: UntrustedTrustPolicy {
            identity: format!("SEALED_ACCEPTANCE.INPUT_JOIN.{seed}"),
            version: 1,
        },
        semantics: UntrustedMarketSemantics {
            normalization: "SEALED_ACCEPTANCE.INPUT_JOIN.NORMALIZATION.V1".into(),
            adjustment: "RAW.V1".into(),
            price_meaning: "USD_PER_SHARE.V1".into(),
            calendar_rules: "XNAS.CALENDAR.V1".into(),
            session_rules: "XNAS.REGULAR.V1".into(),
            timezone_rules: "AMERICA_NEW_YORK.V1".into(),
            instrument_lifecycle_rules: "FIXED_EQUITY.V1".into(),
            corporate_action_rules: "NO_ACTIONS.FIXTURE.V1".into(),
            membership_rules: "FIXED_INPUT_JOIN.V1".into(),
            universe_rules: "EXACT_INSTRUMENTS.V1".into(),
            correction_policy: "SUCCESSOR_ONLY.V1".into(),
        },
        license: UntrustedLicensePolicy {
            use_scope: "SEALED_ACCEPTANCE.TEST_ONLY".into(),
            redistribution_scope: "FIXTURE_ONLY".into(),
            retention_policy: "COMPILE_TIME_ONLY".into(),
            redaction_policy: "NO_SECRET".into(),
        },
        source_frontier: UntrustedCompleteFrontier {
            stream_identity: format!("INPUT_JOIN.SOURCE.{seed}"),
            cut_identity: format!("INPUT_JOIN.SOURCE.CUT.{seed}"),
            sequence: 1,
            digest: digest_byte(seed.wrapping_add(2)),
        },
        correction_frontier: UntrustedCompleteFrontier {
            stream_identity: format!("INPUT_JOIN.CORRECTION.{seed}"),
            cut_identity: format!("INPUT_JOIN.CORRECTION.CUT.{seed}"),
            sequence: 1,
            digest: digest_byte(seed.wrapping_add(3)),
        },
        time_evidence: UntrustedMarketDataAsOf {
            claimed_evidence_identity: digest_byte(0),
            clock_identity: CLOCK_IDENTITY.into(),
            clock_epoch: CLOCK_EPOCH.into(),
            monotonic_sequence: 1,
            restart_continuity_digest: digest_byte(7),
            skew_bound: 2,
            uncertainty_bound: 1,
            event_effective: 1,
            provider_available: 2,
            retrieval: 3,
            correction_publication: 2,
            observed_at: DECISION_CUT,
            effective_at: DECISION_CUT,
            valid_through: VALID_THROUGH,
        },
    };
    proposal.time_evidence.claimed_evidence_identity =
        derive_time_evidence_identity(&proposal.time_evidence);
    proposal.claimed_binding_id = derive_binding_id(&proposal);
    proposal
}

#[allow(clippy::too_many_arguments)]
fn verified_batch(
    source_owner: &TestOnlyInMemorySourceBindingOwner,
    source: &UntrustedSourceBindingLocator,
    clock: &MarketDataClockAdmission,
    role_seed: u8,
    event_seed: u8,
    instrument: &str,
    timeframe: &str,
    field: MarketDataFieldSemantic,
    value_mantissa: i128,
    logical_time: u64,
) -> Result<VerifiedPitObservationBatch, JoinedInputSealedAcceptanceError> {
    let time_evidence = UntrustedPitSnapshotTimeEvidence {
        event_effective: UntrustedEventEffectiveTime::from_untrusted(
            logical_time,
            CLOCK_IDENTITY,
            CLOCK_EPOCH,
        ),
        provider_available: UntrustedProviderAvailableTime::from_untrusted(
            logical_time,
            CLOCK_IDENTITY,
            CLOCK_EPOCH,
        ),
        retrieval: UntrustedRetrievalTime::from_untrusted(
            logical_time.saturating_add(1),
            CLOCK_IDENTITY,
            CLOCK_EPOCH,
        ),
        correction_publication: Some(UntrustedCorrectionPublicationTime::from_untrusted(
            logical_time,
            CLOCK_IDENTITY,
            CLOCK_EPOCH,
        )),
        decision_cut: UntrustedSnapshotDecisionCut::from_untrusted(
            DECISION_CUT,
            CLOCK_IDENTITY,
            CLOCK_EPOCH,
        ),
        monotonic_sequence: 1,
        restart_continuity_digest: digest_byte(7),
        skew_bound: 2,
        uncertainty_bound: 1,
        observed_at: DECISION_CUT,
        valid_through: VALID_THROUGH,
    };
    let mut request = UntrustedPitSnapshotRequest {
        claimed_request_identity: digest_byte(0),
        claimed_request_digest: digest_byte(0),
        correlation_identity: digest_byte(role_seed.wrapping_add(event_seed)),
        requester_identity: digest_byte(0xb1),
        scope_digest: digest_byte(role_seed.wrapping_add(event_seed).wrapping_add(1)),
        source_binding: source.clone(),
        instrument_master_digest: digest_byte(0xc1),
        universe_selection_digest: digest_byte(0xc2),
        market_semantics_identity: digest_byte(0xc3),
        time_evidence,
    };
    refresh_request_claims(&mut request);
    let evidence = UntrustedPitSnapshotEvidence {
        normalized_records_digest: digest_byte(0),
        source_frontier: source.source_frontier.clone(),
        correction_frontier: source.correction_frontier.clone(),
        coverage_complete: true,
        semantics_compatible: true,
        source_available: true,
    };
    let mut proposal = UntrustedPitSnapshotProposal { request, evidence };
    let observations = UntrustedPitObservationBatchProposal {
        rows: vec![UntrustedPitObservation {
            symbolic_key: format!("{instrument}.{timeframe}.{}", field_name(field)),
            member_key: instrument.into(),
            instrument: instrument.into(),
            channel: "MARKET".into(),
            data_kind: data_kind(field).into(),
            timeframe: timeframe.into(),
            field: field_name(field).into(),
            value_mantissa,
            value_scale: SCALE,
            event_effective: logical_time,
            provider_available: logical_time,
            retrieval: logical_time.saturating_add(1),
            correction_publication: logical_time,
            source_binding_identity: proposal.request.source_binding.binding_id,
            source_frontier_digest: proposal.evidence.source_frontier.digest,
            instrument_master_digest: proposal.request.instrument_master_digest,
            universe_selection_digest: proposal.request.universe_selection_digest,
            market_semantics_identity: proposal.request.market_semantics_identity,
            correction_stream_identity: proposal
                .evidence
                .correction_frontier
                .stream_identity
                .clone(),
            correction_sequence: proposal.evidence.correction_frontier.sequence,
            correction_frontier_digest: proposal.evidence.correction_frontier.digest,
        }],
    };
    proposal.evidence.normalized_records_digest = derive_observation_batch_digest(&observations)?;
    let prepared = prepare_observation_batch(&proposal, &observations)?;
    let basis = TestOnlyCanonicalBasisResolver::seal_for_test(
        proposal.request.clone(),
        proposal.evidence.clone(),
        clock.clone(),
    );
    let aggregate = TestOnlyPitSnapshotOwner::default().commit_initial(
        proposal,
        &basis,
        source_owner,
        clock,
    )?;
    let rows = prepared.native_rows()?;
    Ok(verify_observation_batch(
        &aggregate,
        aggregate.fact().source_binding_identity(),
        aggregate.fact().source_binding_lineage_root(),
        aggregate.fact().source_binding_lineage_version(),
        prepared.digest(),
        prepared.bytes(),
        &rows,
    )?)
}

fn binding_request(
    batch: &VerifiedPitObservationBatch,
    design_identity: BindingDigest,
    role_identity: BindingDigest,
    instrument: &str,
    timeframe: &str,
    field: MarketDataFieldSemantic,
) -> UntrustedStrategyInputBindingRequest {
    UntrustedStrategyInputBindingRequest {
        research_request_identity: BindingDigest::from_untrusted_bytes(RESEARCH_REQUEST_IDENTITY),
        strategy_design_identity: design_identity,
        input_role_identity: role_identity,
        scope: UntrustedStrategyInputScope::ExactInstrument {
            instrument: instrument.into(),
        },
        field_semantic: field,
        channel: StrategyInputChannel::Market,
        timeframe: timeframe.into(),
        unit: StrategyInputUnit::Price,
        scale: SCALE,
        pit_request_identity: batch.request_identity(),
        pit_request_digest: batch.request_digest(),
        snapshot_identity: batch.snapshot_identity(),
        snapshot_fact_digest: batch.fact_digest(),
        observation_batch_digest: batch.digest(),
        source_binding_identity: batch.source_binding_identity(),
        source_frontier_digest: batch.source_frontier_digest(),
        correction_frontier_digest: batch.correction_frontier_digest(),
        instrument_master_digest: batch.instrument_master_digest(),
        universe_selection_digest: batch.universe_selection_digest(),
        market_semantics_identity: batch.market_semantics_identity(),
        decision_cut: batch.time_evidence().decision_cut.value,
    }
}

const fn field_name(field: MarketDataFieldSemantic) -> &'static str {
    match field {
        MarketDataFieldSemantic::BarOpenPrice => "OPEN",
        MarketDataFieldSemantic::BarClosePrice => "CLOSE",
        MarketDataFieldSemantic::QuoteBidPrice => "BID_PRICE",
        MarketDataFieldSemantic::QuoteAskPrice => "ASK_PRICE",
        MarketDataFieldSemantic::TradeLastPrice => "LAST_PRICE",
        _ => "UNSUPPORTED",
    }
}

const fn data_kind(field: MarketDataFieldSemantic) -> &'static str {
    match field {
        MarketDataFieldSemantic::BarOpenPrice | MarketDataFieldSemantic::BarClosePrice => "BAR",
        MarketDataFieldSemantic::QuoteBidPrice | MarketDataFieldSemantic::QuoteAskPrice => "QUOTE",
        MarketDataFieldSemantic::TradeLastPrice => "TRADE",
        _ => "UNSUPPORTED",
    }
}

fn digest_byte(value: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([value; 32])
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;
    use crate::owner::sealed_replay_input::sealed_replay_input_contains_joined_cut_v1;

    #[rstest]
    fn alternate_join_claim_is_owner_valid_and_differs_only_in_join_identity() {
        let corpus = issue_strategy_input_join_corpus().expect("Owner-sealed joined corpus");
        let canonical = corpus.events().last().expect("fixed final joined cut");
        let alternate = corpus.alternate_join_claim_for_negative_test();

        assert!(alternate.has_valid_digest());
        assert_eq!(
            alternate.strategy_design_identity(),
            canonical.strategy_design_identity()
        );
        assert_ne!(alternate.join_identity(), canonical.join_identity());
        assert_eq!(
            alternate.alignment_semantic_id(),
            canonical.alignment_semantic_id()
        );
        assert_eq!(alternate.trigger_input_id(), canonical.trigger_input_id());
        assert_eq!(alternate.trigger_digest(), canonical.trigger_digest());
        assert_eq!(alternate.max_staleness_ns(), canonical.max_staleness_ns());
        assert_eq!(
            alternate.market_semantics_identity(),
            canonical.market_semantics_identity()
        );
        assert_eq!(alternate.components(), canonical.components());
        assert_eq!(alternate.components().len(), corpus.bindings().len());
    }

    #[rstest]
    fn replay_custody_rejects_an_authentic_prior_snapshot_cut() {
        let mut corpus = issue_strategy_input_event_join_corpus_v1()
            .expect("Owner-sealed multi-snapshot joined corpus");
        let exact = corpus.events().last().expect("terminal cut").clone();
        let prior = corpus.events().first().expect("prior cut").clone();
        let replay = corpus
            .take_event_replay_input()
            .expect("terminal sealed replay input");

        assert!(sealed_replay_input_contains_joined_cut_v1(&replay, &exact));
        assert!(!sealed_replay_input_contains_joined_cut_v1(&replay, &prior));
    }
}
