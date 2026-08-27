//! Compile-time-only `SEALED_ACCEPTANCE` Market Data fixture.
//!
//! This module is absent unless the non-default `sealed-strategy-input-acceptance` feature is
//! selected. It accepts no caller input and performs no provider, PostgreSQL, network, clock,
//! deployment, or trading effect. Its sole positive is issued by the real crate-private Source
//! Binding and PIT preparation/aggregate/verification path before the real strategy-input binder is
//! called.
//!
//! Even with the feature enabled, a normal caller cannot construct or deserialize either positive:
//!
//! ```compile_fail
//! use vibe_data::owner::strategy_input_binding::StrategyInputUniverseFrameReceipt;
//!
//! let forged: StrategyInputUniverseFrameReceipt = serde_json::from_slice(b"{}").unwrap();
//! ```
//!
//! ```compile_fail
//! use vibe_data::owner::strategy_input_binding::StrategyInputUniverseSelectionReceipt;
//!
//! let forged = StrategyInputUniverseSelectionReceipt {};
//! ```

use std::{collections::BTreeSet, fmt::Display, ops::Deref};

use super::{
    PitSnapshotError, UntrustedCorrectionPublicationTime, UntrustedEventEffectiveTime,
    UntrustedPitObservation, UntrustedPitObservationBatchProposal, UntrustedPitSnapshotEvidence,
    UntrustedPitSnapshotProposal, UntrustedPitSnapshotRequest, UntrustedPitSnapshotTimeEvidence,
    UntrustedProviderAvailableTime, UntrustedRetrievalTime, UntrustedSnapshotDecisionCut,
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
        UntrustedMarketSemantics, UntrustedOpaqueCredentialHandle, UntrustedSourceBindingProposal,
        UntrustedTrustPolicy,
        authority::{
            OwnerSourceBindingDecision, TestOnlyInMemorySourceBindingOwner, derive_binding_id,
            derive_time_evidence_identity,
        },
    },
    strategy_input_binding::{
        MarketDataFieldSemantic, StrategyInputBindingUnavailable, StrategyInputChannel,
        StrategyInputUnit, StrategyInputUniverseFrameReceipt, UntrustedStrategyInputBindingRequest,
        UntrustedStrategyInputScope, bind_strategy_input_universe_frame,
        derive_strategy_input_universe_selection_identity,
    },
};

const CLOCK_IDENTITY: &str = "SEALED_ACCEPTANCE.MARKET_DATA.CLOCK";
const CLOCK_EPOCH: &str = "SEALED_ACCEPTANCE.EPOCH.1";
const DECISION_CUT: u64 = 40;
const TIMEFRAME: &str = "1D";
const SCALE: u8 = 2;
const RESEARCH_REQUEST_IDENTITY: [u8; 32] = [1; 32];
const STRATEGY_DESIGN_IDENTITY: [u8; 32] = [
    202, 109, 110, 206, 104, 192, 162, 0, 156, 57, 11, 175, 182, 163, 124, 136, 229, 156, 137, 195,
    38, 194, 2, 172, 51, 3, 187, 106, 84, 93, 174, 230,
];
const OPEN_ROLE_IDENTITY: [u8; 32] = [
    188, 119, 32, 67, 197, 45, 36, 25, 82, 171, 129, 189, 167, 136, 146, 135, 178, 160, 162, 108,
    2, 83, 105, 97, 42, 22, 217, 120, 49, 133, 15, 115,
];
const CLOSE_ROLE_IDENTITY: [u8; 32] = [
    104, 195, 30, 17, 126, 250, 168, 34, 91, 223, 251, 134, 191, 8, 138, 196, 0, 145, 143, 202,
    147, 146, 144, 96, 163, 22, 78, 125, 143, 96, 236, 90,
];

/// Failure from the closed `SEALED_ACCEPTANCE` issuance path.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SealedAcceptanceError {
    /// The fixed Source Binding corpus did not pass native Owner admission.
    SourceBinding(SourceBindingError),
    /// The fixed normalized corpus did not pass native PIT issuance or verification.
    PitSnapshot(PitSnapshotError),
    /// The verified corpus did not pass the real strategy-input universe binder.
    StrategyInput(StrategyInputBindingUnavailable),
}

/// One fixed Strategy Factory role request sealed into the closed acceptance frame.
///
/// The adapter exposes the Owner-bound identities for verification but has no public constructor.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SealedAcceptanceStrategyInputRoleBinding {
    research_request: BindingDigest,
    strategy_design: BindingDigest,
    input_role: BindingDigest,
}

impl SealedAcceptanceStrategyInputRoleBinding {
    pub const fn research_request_identity(&self) -> BindingDigest {
        self.research_request
    }

    pub const fn strategy_design_identity(&self) -> BindingDigest {
        self.strategy_design
    }

    pub const fn input_role_identity(&self) -> BindingDigest {
        self.input_role
    }
}

/// Closed Strategy Factory acceptance authority plus its real Owner-sealed universe frame.
///
/// Callers can inspect but cannot select or construct any Research, Design, role, member, or frame
/// authority carried by this adapter.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SealedAcceptanceStrategyInputUniverseFrame {
    frame: StrategyInputUniverseFrameReceipt,
    role_bindings: Box<[SealedAcceptanceStrategyInputRoleBinding]>,
}

impl SealedAcceptanceStrategyInputUniverseFrame {
    pub fn role_bindings(&self) -> &[SealedAcceptanceStrategyInputRoleBinding] {
        &self.role_bindings
    }

    pub const fn frame(&self) -> &StrategyInputUniverseFrameReceipt {
        &self.frame
    }
}

impl Deref for SealedAcceptanceStrategyInputUniverseFrame {
    type Target = StrategyInputUniverseFrameReceipt;

    fn deref(&self) -> &Self::Target {
        &self.frame
    }
}

impl Display for SealedAcceptanceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for SealedAcceptanceError {}

impl From<SourceBindingError> for SealedAcceptanceError {
    fn from(value: SourceBindingError) -> Self {
        Self::SourceBinding(value)
    }
}

impl From<PitSnapshotError> for SealedAcceptanceError {
    fn from(value: PitSnapshotError) -> Self {
        Self::PitSnapshot(value)
    }
}

impl From<StrategyInputBindingUnavailable> for SealedAcceptanceError {
    fn from(value: StrategyInputBindingUnavailable) -> Self {
        Self::StrategyInput(value)
    }
}

/// Issues the one immutable AAPL/MSFT `SEALED_ACCEPTANCE` universe frame.
///
/// The function deliberately takes no arguments. Callers cannot select rows, requests, authority,
/// locators, clocks, providers, persistence, or runtime cases.
///
/// # Errors
///
/// Fails closed if any fixed fixture claim fails Source Binding admission, PIT preparation,
/// aggregate issuance, complete-batch verification, or universe-frame binding.
pub fn issue_strategy_input_universe_frame()
-> Result<SealedAcceptanceStrategyInputUniverseFrame, SealedAcceptanceError> {
    let source_clock = clock();
    let source_owner = TestOnlyInMemorySourceBindingOwner::default();
    let source = source_owner.commit_initial(
        source_proposal(),
        OwnerSourceBindingDecision {
            blockers: BTreeSet::new(),
        },
        &source_clock,
    )?;

    let mut snapshot = snapshot_proposal(source.receipt().locator());
    let observations = observation_proposal(&snapshot);
    snapshot.evidence.normalized_records_digest = derive_observation_batch_digest(&observations)?;
    let prepared = prepare_observation_batch(&snapshot, &observations)?;
    let basis = TestOnlyCanonicalBasisResolver::seal_for_test(
        snapshot.request.clone(),
        snapshot.evidence.clone(),
        source_clock.clone(),
    );
    let aggregate = TestOnlyPitSnapshotOwner::default().commit_initial(
        snapshot,
        &basis,
        &source_owner,
        &source_clock,
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

    let selection_identity = derive_strategy_input_universe_selection_identity(&verified)?;
    let requests = [
        binding_request(
            &verified,
            selection_identity,
            BindingDigest::from_untrusted_bytes(OPEN_ROLE_IDENTITY),
            MarketDataFieldSemantic::BarOpenPrice,
        ),
        binding_request(
            &verified,
            selection_identity,
            BindingDigest::from_untrusted_bytes(CLOSE_ROLE_IDENTITY),
            MarketDataFieldSemantic::BarClosePrice,
        ),
    ];
    let frame = bind_strategy_input_universe_frame(&requests, &verified)?;
    let role_bindings = requests
        .iter()
        .map(|request| SealedAcceptanceStrategyInputRoleBinding {
            research_request: request.research_request_identity,
            strategy_design: request.strategy_design_identity,
            input_role: request.input_role_identity,
        })
        .collect::<Vec<_>>()
        .into_boxed_slice();
    Ok(SealedAcceptanceStrategyInputUniverseFrame {
        frame,
        role_bindings,
    })
}

fn digest_byte(value: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([value; 32])
}

fn clock() -> MarketDataClockAdmission {
    MarketDataClockAdmission::seal_for_test(
        CLOCK_IDENTITY,
        CLOCK_EPOCH,
        1,
        DECISION_CUT,
        DECISION_CUT,
        DECISION_CUT + 60,
        digest_byte(7),
        1,
        2,
    )
}

fn source_proposal() -> UntrustedSourceBindingProposal {
    let mut proposal = UntrustedSourceBindingProposal {
        claimed_binding_id: digest_byte(0),
        schema_version: 1,
        adapter: UntrustedAdapterBinding {
            implementation_digest: digest_byte(1),
            configuration_digest: digest_byte(2),
            authenticated_endpoint_identity: "sealed-acceptance://fixed-market-corpus".into(),
            dataset_mapping: "AAPL-MSFT-OHLC-V1".into(),
            account_mapping: "NO_ACCOUNT_SEALED_ACCEPTANCE".into(),
        },
        credential_handle: UntrustedOpaqueCredentialHandle::from_untrusted_identity(
            digest_byte(6),
            UntrustedCredentialAudienceClaim::MarketData,
            [
                UntrustedCredentialCapabilityClaim::MarketDataRead,
                UntrustedCredentialCapabilityClaim::ReferenceDataRead,
                UntrustedCredentialCapabilityClaim::MetadataRead,
            ],
        ),
        trust_policy: UntrustedTrustPolicy {
            identity: "SEALED_ACCEPTANCE.FIXED.CORPUS".into(),
            version: 1,
        },
        semantics: UntrustedMarketSemantics {
            normalization: "SEALED_ACCEPTANCE.NORMALIZATION.V1".into(),
            adjustment: "RAW.V1".into(),
            price_meaning: "USD_PER_SHARE.V1".into(),
            calendar_rules: "XNAS.CALENDAR.V1".into(),
            session_rules: "XNAS.REGULAR.V1".into(),
            timezone_rules: "AMERICA_NEW_YORK.V1".into(),
            instrument_lifecycle_rules: "FIXED_EQUITY.V1".into(),
            corporate_action_rules: "NO_ACTIONS.FIXTURE.V1".into(),
            membership_rules: "FIXED_AAPL_MSFT.V1".into(),
            universe_rules: "SEALED_ACCEPTANCE.EXACT_TWO.V1".into(),
            correction_policy: "SUCCESSOR_ONLY.V1".into(),
        },
        license: UntrustedLicensePolicy {
            use_scope: "SEALED_ACCEPTANCE.TEST_ONLY".into(),
            redistribution_scope: "FIXTURE_ONLY".into(),
            retention_policy: "COMPILE_TIME_ONLY".into(),
            redaction_policy: "NO_SECRET".into(),
        },
        source_frontier: UntrustedCompleteFrontier {
            stream_identity: "SEALED_ACCEPTANCE.SOURCE".into(),
            cut_identity: "SEALED_ACCEPTANCE.SOURCE.CUT.1".into(),
            sequence: 1,
            digest: digest_byte(3),
        },
        correction_frontier: UntrustedCompleteFrontier {
            stream_identity: "SEALED_ACCEPTANCE.CORRECTION".into(),
            cut_identity: "SEALED_ACCEPTANCE.CORRECTION.CUT.1".into(),
            sequence: 1,
            digest: digest_byte(4),
        },
        time_evidence: UntrustedMarketDataAsOf {
            claimed_evidence_identity: digest_byte(0),
            clock_identity: CLOCK_IDENTITY.into(),
            clock_epoch: CLOCK_EPOCH.into(),
            monotonic_sequence: 1,
            restart_continuity_digest: digest_byte(7),
            skew_bound: 2,
            uncertainty_bound: 1,
            event_effective: 10,
            provider_available: 20,
            retrieval: 30,
            correction_publication: 25,
            observed_at: DECISION_CUT,
            effective_at: DECISION_CUT,
            valid_through: DECISION_CUT + 60,
        },
    };
    proposal.time_evidence.claimed_evidence_identity =
        derive_time_evidence_identity(&proposal.time_evidence);
    proposal.claimed_binding_id = derive_binding_id(&proposal);
    proposal
}

fn snapshot_proposal(
    source: &crate::owner::source_binding::UntrustedSourceBindingLocator,
) -> UntrustedPitSnapshotProposal {
    let mut request = UntrustedPitSnapshotRequest {
        claimed_request_identity: digest_byte(0),
        claimed_request_digest: digest_byte(0),
        correlation_identity: digest_byte(20),
        requester_identity: digest_byte(19),
        scope_digest: digest_byte(21),
        source_binding: source.clone(),
        instrument_master_digest: digest_byte(22),
        universe_selection_digest: digest_byte(23),
        market_semantics_identity: digest_byte(24),
        time_evidence: UntrustedPitSnapshotTimeEvidence {
            event_effective: UntrustedEventEffectiveTime::from_untrusted(
                10,
                CLOCK_IDENTITY,
                CLOCK_EPOCH,
            ),
            provider_available: UntrustedProviderAvailableTime::from_untrusted(
                20,
                CLOCK_IDENTITY,
                CLOCK_EPOCH,
            ),
            retrieval: UntrustedRetrievalTime::from_untrusted(30, CLOCK_IDENTITY, CLOCK_EPOCH),
            correction_publication: Some(UntrustedCorrectionPublicationTime::from_untrusted(
                25,
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
            valid_through: DECISION_CUT + 60,
        },
    };
    refresh_request_claims(&mut request);
    UntrustedPitSnapshotProposal {
        request,
        evidence: UntrustedPitSnapshotEvidence {
            normalized_records_digest: digest_byte(1),
            source_frontier: source.source_frontier.clone(),
            correction_frontier: source.correction_frontier.clone(),
            coverage_complete: true,
            semantics_compatible: true,
            source_available: true,
        },
    }
}

fn observation_proposal(
    snapshot: &UntrustedPitSnapshotProposal,
) -> UntrustedPitObservationBatchProposal {
    let rows = [
        ("AAPL.CLOSE", "AAPL", "AAPL.XNAS", "CLOSE", 18_725),
        ("AAPL.OPEN", "AAPL", "AAPL.XNAS", "OPEN", 18_641),
        ("MSFT.CLOSE", "MSFT", "MSFT.XNAS", "CLOSE", 42_115),
        ("MSFT.OPEN", "MSFT", "MSFT.XNAS", "OPEN", 41_981),
    ]
    .into_iter()
    .map(
        |(symbolic_key, member_key, instrument, field, value_mantissa)| UntrustedPitObservation {
            symbolic_key: symbolic_key.into(),
            member_key: member_key.into(),
            instrument: instrument.into(),
            channel: "MARKET".into(),
            data_kind: "BAR".into(),
            timeframe: TIMEFRAME.into(),
            field: field.into(),
            value_mantissa,
            value_scale: SCALE,
            event_effective: 10,
            provider_available: 20,
            retrieval: 30,
            correction_publication: 25,
            source_binding_identity: snapshot.request.source_binding.binding_id,
            source_frontier_digest: snapshot.evidence.source_frontier.digest,
            instrument_master_digest: snapshot.request.instrument_master_digest,
            universe_selection_digest: snapshot.request.universe_selection_digest,
            market_semantics_identity: snapshot.request.market_semantics_identity,
            correction_stream_identity: snapshot
                .evidence
                .correction_frontier
                .stream_identity
                .clone(),
            correction_sequence: snapshot.evidence.correction_frontier.sequence,
            correction_frontier_digest: snapshot.evidence.correction_frontier.digest,
        },
    )
    .collect();
    UntrustedPitObservationBatchProposal { rows }
}

fn binding_request(
    batch: &super::VerifiedPitObservationBatch,
    selection_identity: BindingDigest,
    input_role_identity: BindingDigest,
    field_semantic: MarketDataFieldSemantic,
) -> UntrustedStrategyInputBindingRequest {
    UntrustedStrategyInputBindingRequest {
        research_request_identity: BindingDigest::from_untrusted_bytes(RESEARCH_REQUEST_IDENTITY),
        strategy_design_identity: BindingDigest::from_untrusted_bytes(STRATEGY_DESIGN_IDENTITY),
        input_role_identity,
        scope: UntrustedStrategyInputScope::UniverseSelection { selection_identity },
        field_semantic,
        channel: StrategyInputChannel::Market,
        timeframe: TIMEFRAME.into(),
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
