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
        MarketDataFieldSemantic, StrategyInputBindingReceipt, StrategyInputBindingUnavailable,
        StrategyInputChannel, StrategyInputEventFrameReceipt, StrategyInputUnit,
        StrategyInputUniverseFrameReceipt, UntrustedStrategyInputBindingRequest,
        UntrustedStrategyInputScope, bind_strategy_input_event_frame, bind_strategy_input_role,
        bind_strategy_input_universe_frame, derive_strategy_input_universe_selection_identity,
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
const SOURCE_INTAKE_COMPOSER_RESEARCH_REQUEST_IDENTITY: [u8; 32] = [
    223, 5, 233, 127, 131, 44, 31, 89, 145, 164, 47, 53, 99, 79, 189, 249, 39, 161, 65, 101, 108,
    144, 51, 47, 139, 187, 12, 62, 199, 108, 216, 30,
];
const SOURCE_INTAKE_COMPOSER_STRATEGY_DESIGN_IDENTITY: [u8; 32] = [
    23, 101, 12, 129, 34, 127, 211, 104, 159, 109, 51, 8, 231, 70, 29, 88, 127, 26, 216, 112, 106,
    97, 74, 87, 171, 153, 193, 204, 95, 254, 83, 87,
];
const OPEN_ROLE_IDENTITY: [u8; 32] = [
    188, 119, 32, 67, 197, 45, 36, 25, 82, 171, 129, 189, 167, 136, 146, 135, 178, 160, 162, 108,
    2, 83, 105, 97, 42, 22, 217, 120, 49, 133, 15, 115,
];
const CLOSE_ROLE_IDENTITY: [u8; 32] = [
    104, 195, 30, 17, 126, 250, 168, 34, 91, 223, 251, 134, 191, 8, 138, 196, 0, 145, 143, 202,
    147, 146, 144, 96, 163, 22, 78, 125, 143, 96, 236, 90,
];
const EXACT_INSTRUMENT: &str = "AAPL.XNAS";
const EXACT_STRATEGY_DESIGN_IDENTITY: [u8; 32] = [
    167, 124, 130, 79, 168, 117, 252, 196, 109, 127, 162, 160, 71, 168, 80, 76, 247, 22, 53, 148,
    192, 131, 35, 155, 131, 163, 246, 151, 13, 47, 233, 209,
];
const EXACT_ROLE_IDENTITIES: [[u8; 32]; 6] = [
    [
        74, 208, 132, 35, 159, 29, 60, 59, 177, 88, 186, 249, 237, 112, 116, 203, 190, 135, 158,
        41, 28, 189, 88, 154, 155, 37, 226, 194, 150, 198, 4, 232,
    ],
    [
        125, 83, 94, 142, 184, 38, 200, 124, 97, 64, 73, 74, 156, 9, 82, 66, 64, 44, 103, 127, 64,
        91, 64, 158, 232, 186, 252, 216, 253, 34, 174, 4,
    ],
    [
        75, 63, 47, 210, 103, 203, 43, 42, 196, 2, 166, 207, 79, 212, 32, 96, 149, 100, 69, 203, 2,
        154, 7, 235, 119, 16, 135, 127, 28, 113, 109, 194,
    ],
    [
        189, 255, 230, 6, 166, 239, 190, 23, 35, 33, 96, 239, 132, 101, 42, 108, 23, 147, 161, 248,
        227, 120, 131, 169, 113, 235, 89, 202, 90, 154, 46, 4,
    ],
    [
        208, 176, 220, 155, 116, 219, 249, 232, 72, 32, 112, 207, 119, 18, 119, 17, 153, 120, 103,
        199, 252, 169, 64, 8, 96, 119, 191, 147, 50, 249, 234, 27,
    ],
    [
        54, 119, 114, 249, 14, 244, 84, 177, 6, 230, 171, 115, 72, 23, 166, 96, 156, 206, 221, 31,
        206, 27, 22, 188, 163, 49, 70, 97, 80, 77, 172, 186,
    ],
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

/// Closed six-role exact-instrument acceptance authority plus its real Owner-sealed event frame.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SealedAcceptanceExactInstrumentBarFrame {
    frame: StrategyInputEventFrameReceipt,
    bindings: Box<[StrategyInputBindingReceipt]>,
    role_bindings: Box<[SealedAcceptanceStrategyInputRoleBinding]>,
}

impl SealedAcceptanceExactInstrumentBarFrame {
    pub const fn frame(&self) -> &StrategyInputEventFrameReceipt {
        &self.frame
    }

    pub fn bindings(&self) -> &[StrategyInputBindingReceipt] {
        &self.bindings
    }

    pub fn role_bindings(&self) -> &[SealedAcceptanceStrategyInputRoleBinding] {
        &self.role_bindings
    }
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
    issue_universe_frame_for_compile_time_corpus(
        RESEARCH_REQUEST_IDENTITY,
        STRATEGY_DESIGN_IDENTITY,
    )
}

/// Issues the immutable A2 Source Intake-to-Research-to-Composer Market Data frame.
///
/// This no-argument adapter reuses the fixed Owner-sealed AAPL/MSFT corpus, but binds it to private
/// A2 Research and Design identities that are disjoint from the A1 and exact-instrument W3
/// acceptance paths. Callers can neither select those identities nor substitute Market facts.
///
/// # Errors
///
/// Fails closed if any fixed Source Binding, PIT, or universe-frame invariant is unavailable.
pub fn issue_source_intake_composer_universe_frame()
-> Result<SealedAcceptanceStrategyInputUniverseFrame, SealedAcceptanceError> {
    issue_universe_frame_for_compile_time_corpus(
        SOURCE_INTAKE_COMPOSER_RESEARCH_REQUEST_IDENTITY,
        SOURCE_INTAKE_COMPOSER_STRATEGY_DESIGN_IDENTITY,
    )
}

/// Reissues the immutable A2 Market corpus for an R&D Owner-verified runtime lineage.
///
/// Only typed canonical digests cross this boundary. Market facts, clock, provider, selection, and
/// role identities remain compile-time owned by this module and cannot be supplied by an API DTO.
pub fn issue_source_intake_composer_universe_frame_for_owner_lineage(
    research_request_identity: BindingDigest,
    strategy_design_identity: BindingDigest,
) -> Result<SealedAcceptanceStrategyInputUniverseFrame, SealedAcceptanceError> {
    issue_universe_frame_for_compile_time_corpus(
        *research_request_identity.as_bytes(),
        *strategy_design_identity.as_bytes(),
    )
}

fn issue_universe_frame_for_compile_time_corpus(
    research_request_identity: [u8; 32],
    strategy_design_identity: [u8; 32],
) -> Result<SealedAcceptanceStrategyInputUniverseFrame, SealedAcceptanceError> {
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
            research_request_identity,
            strategy_design_identity,
            BindingDigest::from_untrusted_bytes(OPEN_ROLE_IDENTITY),
            MarketDataFieldSemantic::BarOpenPrice,
        ),
        binding_request(
            &verified,
            selection_identity,
            research_request_identity,
            strategy_design_identity,
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

/// Issues the one immutable AAPL exact-instrument six-BAR-role acceptance frame.
///
/// The no-argument fixture exercises the same Source Binding, PIT verification, role binding, and
/// event-frame issuance paths as runtime Owner input while exposing no caller-selected fact.
///
/// # Errors
///
/// Fails closed if any fixed Source Binding, PIT, binding, or frame invariant is unavailable.
pub fn issue_strategy_input_exact_instrument_bar_frame()
-> Result<SealedAcceptanceExactInstrumentBarFrame, SealedAcceptanceError> {
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
    let observations = exact_instrument_observation_proposal(&snapshot);
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

    let coordinates = [
        (MarketDataFieldSemantic::BarClosePrice, "1M"),
        (MarketDataFieldSemantic::BarOpenPrice, "1M"),
        (MarketDataFieldSemantic::BarHighPrice, "1M"),
        (MarketDataFieldSemantic::BarLowPrice, "1M"),
        (MarketDataFieldSemantic::BarClosePrice, "1H"),
        (MarketDataFieldSemantic::BarClosePrice, "1D"),
    ];
    let requests = coordinates
        .into_iter()
        .zip(EXACT_ROLE_IDENTITIES)
        .map(|((field, timeframe), role)| exact_binding_request(&verified, role, field, timeframe))
        .collect::<Vec<_>>();
    let bindings = requests
        .iter()
        .map(|request| bind_strategy_input_role(request, &verified))
        .collect::<Result<Vec<_>, _>>()?;
    let frame = bind_strategy_input_event_frame(&bindings, &verified)?;
    let role_bindings = requests
        .iter()
        .map(|request| SealedAcceptanceStrategyInputRoleBinding {
            research_request: request.research_request_identity,
            strategy_design: request.strategy_design_identity,
            input_role: request.input_role_identity,
        })
        .collect::<Vec<_>>()
        .into_boxed_slice();
    Ok(SealedAcceptanceExactInstrumentBarFrame {
        frame,
        bindings: bindings.into_boxed_slice(),
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

fn exact_instrument_observation_proposal(
    snapshot: &UntrustedPitSnapshotProposal,
) -> UntrustedPitObservationBatchProposal {
    let rows = [
        ("AAPL.CLOSE.1H", "CLOSE", "1H", 18_701),
        ("AAPL.CLOSE.1M", "CLOSE", "1M", 18_725),
        ("AAPL.CLOSE.EXCHANGE_SESSION_1D", "CLOSE", "1D", 18_681),
        ("AAPL.HIGH.1M", "HIGH", "1M", 18_761),
        ("AAPL.LOW.1M", "LOW", "1M", 18_611),
        ("AAPL.OPEN.1M", "OPEN", "1M", 18_641),
    ]
    .into_iter()
    .map(
        |(symbolic_key, field, timeframe, value_mantissa)| UntrustedPitObservation {
            symbolic_key: symbolic_key.into(),
            member_key: "AAPL".into(),
            instrument: EXACT_INSTRUMENT.into(),
            channel: "MARKET".into(),
            data_kind: "BAR".into(),
            timeframe: timeframe.into(),
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
    research_request_identity: [u8; 32],
    strategy_design_identity: [u8; 32],
    input_role_identity: BindingDigest,
    field_semantic: MarketDataFieldSemantic,
) -> UntrustedStrategyInputBindingRequest {
    UntrustedStrategyInputBindingRequest {
        research_request_identity: BindingDigest::from_untrusted_bytes(research_request_identity),
        strategy_design_identity: BindingDigest::from_untrusted_bytes(strategy_design_identity),
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

fn exact_binding_request(
    batch: &super::VerifiedPitObservationBatch,
    input_role_identity: [u8; 32],
    field_semantic: MarketDataFieldSemantic,
    timeframe: &str,
) -> UntrustedStrategyInputBindingRequest {
    UntrustedStrategyInputBindingRequest {
        research_request_identity: BindingDigest::from_untrusted_bytes(RESEARCH_REQUEST_IDENTITY),
        strategy_design_identity: BindingDigest::from_untrusted_bytes(
            EXACT_STRATEGY_DESIGN_IDENTITY,
        ),
        input_role_identity: BindingDigest::from_untrusted_bytes(input_role_identity),
        scope: UntrustedStrategyInputScope::ExactInstrument {
            instrument: EXACT_INSTRUMENT.into(),
        },
        field_semantic,
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

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    #[rstest]
    fn a2_universe_frame_is_stable_and_identity_disjoint() {
        let a1 = issue_strategy_input_universe_frame().expect("A1 sealed frame");
        let a2 = issue_source_intake_composer_universe_frame().expect("A2 sealed frame");
        let replay = issue_source_intake_composer_universe_frame().expect("A2 sealed replay");

        assert_eq!(a2, replay);
        assert_ne!(a1, a2);
        assert_eq!(a1.selection(), a2.selection());
        assert_eq!(
            a1.values()
                .iter()
                .map(|value| (value.member_key(), value.value_bytes()))
                .collect::<Vec<_>>(),
            a2.values()
                .iter()
                .map(|value| (value.member_key(), value.value_bytes()))
                .collect::<Vec<_>>()
        );
        assert_ne!(
            SOURCE_INTAKE_COMPOSER_RESEARCH_REQUEST_IDENTITY,
            RESEARCH_REQUEST_IDENTITY
        );
        assert_ne!(
            SOURCE_INTAKE_COMPOSER_STRATEGY_DESIGN_IDENTITY,
            STRATEGY_DESIGN_IDENTITY
        );
        assert_ne!(
            SOURCE_INTAKE_COMPOSER_STRATEGY_DESIGN_IDENTITY,
            EXACT_STRATEGY_DESIGN_IDENTITY
        );
        assert!(a2.role_bindings().iter().all(|binding| {
            binding.research_request_identity()
                == BindingDigest::from_untrusted_bytes(
                    SOURCE_INTAKE_COMPOSER_RESEARCH_REQUEST_IDENTITY,
                )
                && binding.strategy_design_identity()
                    == BindingDigest::from_untrusted_bytes(
                        SOURCE_INTAKE_COMPOSER_STRATEGY_DESIGN_IDENTITY,
                    )
        }));
    }

    #[rstest]
    fn a2_runtime_lineages_reuse_only_the_compile_time_market_corpus() {
        let first_research = BindingDigest::from_untrusted_bytes([41; 32]);
        let first_design = BindingDigest::from_untrusted_bytes([42; 32]);
        let second_research = BindingDigest::from_untrusted_bytes([51; 32]);
        let second_design = BindingDigest::from_untrusted_bytes([52; 32]);
        let first = issue_source_intake_composer_universe_frame_for_owner_lineage(
            first_research,
            first_design,
        )
        .expect("first Owner lineage");
        let second = issue_source_intake_composer_universe_frame_for_owner_lineage(
            second_research,
            second_design,
        )
        .expect("second Owner lineage");

        assert_eq!(first.selection(), second.selection());
        assert_eq!(
            first
                .values()
                .iter()
                .map(|value| (value.member_key(), value.instrument(), value.value_bytes()))
                .collect::<Vec<_>>(),
            second
                .values()
                .iter()
                .map(|value| (value.member_key(), value.instrument(), value.value_bytes()))
                .collect::<Vec<_>>()
        );
        assert!(first.role_bindings().iter().all(|binding| {
            binding.research_request_identity() == first_research
                && binding.strategy_design_identity() == first_design
        }));
        assert!(second.role_bindings().iter().all(|binding| {
            binding.research_request_identity() == second_research
                && binding.strategy_design_identity() == second_design
        }));
        assert_ne!(first.role_bindings(), second.role_bindings());
    }

    #[rstest]
    fn a2_runtime_lineage_does_not_accept_a_single_changed_identity_as_the_expected_lineage() {
        let research = BindingDigest::from_untrusted_bytes([61; 32]);
        let design = BindingDigest::from_untrusted_bytes([62; 32]);
        let wrong = issue_source_intake_composer_universe_frame_for_owner_lineage(
            research,
            BindingDigest::from_untrusted_bytes([63; 32]),
        )
        .expect("typed but different Owner lineage");

        assert!(wrong.role_bindings().iter().all(|binding| {
            binding.research_request_identity() == research
                && binding.strategy_design_identity() != design
        }));
    }

    #[rstest]
    fn exact_instrument_six_bar_frame_is_stable_and_complete() {
        let first = issue_strategy_input_exact_instrument_bar_frame().expect("exact BAR frame");
        let repeated = issue_strategy_input_exact_instrument_bar_frame().expect("stable replay");
        assert_eq!(first, repeated);
        assert_eq!(first.bindings().len(), 6);
        assert_eq!(first.role_bindings().len(), 6);
        assert_eq!(first.frame().values().len(), 6);
        let coordinates = first
            .bindings()
            .iter()
            .map(|binding| {
                (
                    binding.locator().instrument().to_owned(),
                    binding.locator().field_semantic_identity().to_owned(),
                    binding.locator().timeframe().to_owned(),
                )
            })
            .collect::<BTreeSet<_>>();
        assert_eq!(coordinates.len(), 6);
        assert!(
            coordinates
                .iter()
                .all(|coordinate| coordinate.0 == EXACT_INSTRUMENT)
        );

        for expected in [
            ("MARKET_DATA.BAR.OPEN.PRICE.V1", "1M"),
            ("MARKET_DATA.BAR.HIGH.PRICE.V1", "1M"),
            ("MARKET_DATA.BAR.LOW.PRICE.V1", "1M"),
            ("MARKET_DATA.BAR.CLOSE.PRICE.V1", "1M"),
            ("MARKET_DATA.BAR.CLOSE.PRICE.V1", "1H"),
            ("MARKET_DATA.BAR.CLOSE.PRICE.V1", "1D"),
        ] {
            assert!(coordinates.contains(&(
                EXACT_INSTRUMENT.to_owned(),
                expected.0.to_owned(),
                expected.1.to_owned(),
            )));
        }
    }
}
