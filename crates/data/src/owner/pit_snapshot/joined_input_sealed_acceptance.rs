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
use crate::owner::{
    source_binding::{
        BindingDigest, MarketDataClockAdmission, SourceBindingError, UntrustedAdapterBinding,
        UntrustedCompleteFrontier, UntrustedCredentialAudienceClaim,
        UntrustedCredentialCapabilityClaim, UntrustedLicensePolicy, UntrustedMarketDataAsOf,
        UntrustedMarketSemantics, UntrustedOpaqueCredentialHandle, UntrustedSourceBindingLocator,
        UntrustedSourceBindingProposal, UntrustedTrustPolicy,
        authority::{
            OwnerSourceBindingDecision, TestOnlyInMemorySourceBindingOwner, derive_binding_id,
            derive_time_evidence_identity,
        },
    },
    strategy_input_binding::{
        MarketDataFieldSemantic, StrategyInputBindingReceipt, StrategyInputBindingUnavailable,
        StrategyInputChannel, StrategyInputUnit, UntrustedStrategyInputBindingRequest,
        UntrustedStrategyInputScope, bind_strategy_input_event_frame, bind_strategy_input_role,
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

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum JoinedInputSealedAcceptanceError {
    SourceBinding(SourceBindingError),
    PitSnapshot(PitSnapshotError),
    StrategyInput(StrategyInputBindingUnavailable),
    JoinedCut(StrategyInputJoinedCutUnavailable),
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

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SealedAcceptanceStrategyInputJoinCorpus {
    bindings: Box<[StrategyInputBindingReceipt]>,
    events: Box<[StrategyInputJoinedCutReceiptV1]>,
    repeated_first: StrategyInputJoinedCutReceiptV1,
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
/// # Panics
///
/// Panics only if this module's fixed four-role/three-event corpus exceeds its compile-time numeric
/// seeds or fails to create the first role binding before issuing its remaining fixed frames.
pub fn issue_strategy_input_join_corpus()
-> Result<SealedAcceptanceStrategyInputJoinCorpus, JoinedInputSealedAcceptanceError> {
    let specs = [
        ("AAPL.XNAS", "1M", MarketDataFieldSemantic::BarOpenPrice),
        ("AAPL.XNAS", "1M", MarketDataFieldSemantic::BarClosePrice),
        ("MSFT.XNAS", "1H", MarketDataFieldSemantic::BarClosePrice),
        ("QQQ.XNAS", "1D", MarketDataFieldSemantic::BarClosePrice),
    ];
    let event_times = [1_000_000_000_u64, 3_000_000_000, 5_000_000_000];
    let mut bindings = Vec::with_capacity(specs.len());
    let mut by_event = vec![Vec::with_capacity(specs.len()); event_times.len()];
    let mut stale = Vec::with_capacity(specs.len());
    let mut cross_splice = Vec::with_capacity(specs.len());

    for (role_index, (instrument, timeframe, field)) in specs.into_iter().enumerate() {
        let role_seed = u8::try_from(role_index + 61).expect("fixed role seed");
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

    let claim = join_claim();
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
    let stale = issue_strategy_input_joined_cut_v1(&claim, &bindings, &stale_census, 7_000_000_000)
        .expect_err("fixed stale census must fail closed");
    let cross_census = seal_strategy_input_join_census_v1(cross_splice)?;
    let cross_splice =
        issue_strategy_input_joined_cut_v1(&claim, &bindings, &cross_census, 9_000_000_000)
            .expect_err("fixed cross-Design census must fail closed");

    Ok(SealedAcceptanceStrategyInputJoinCorpus {
        bindings: bindings.into_boxed_slice(),
        events: events.into_boxed_slice(),
        repeated_first: repeated_first.expect("fixed corpus has a first event"),
        missing,
        stale,
        cross_splice,
    })
}

fn join_claim() -> UntrustedStrategyInputJoinClaimV1 {
    let mut roles = [
        "research.input.open.v1",
        "research.input.close.v1",
        "research.input.msft-hour-close.v1",
        "research.input.qqq-day-close.v1",
    ]
    .into_iter()
    .zip(JOIN_ROLE_IDENTITIES)
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
    let max_staleness_ns = 500;
    UntrustedStrategyInputJoinClaimV1 {
        strategy_design_identity: BindingDigest::from_untrusted_bytes(JOIN_DESIGN_IDENTITY),
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
            data_kind: "BAR".into(),
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
        _ => "UNSUPPORTED",
    }
}

fn digest_byte(value: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([value; 32])
}
