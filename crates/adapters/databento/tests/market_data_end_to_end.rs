//! One frozen PIT Market Snapshot Request answered from live vendor data.
//!
//! Every leg here is the production composition root, not a fixture: Operations admits a Source
//! Binding, admits the historical membership behind one eligible frontier, and has the Owner
//! evaluate a selection rule; R&D then reads the Owner's decision cut, freezes a request against
//! it, and receives a terminal. Nothing in the test supplies an observation, an evidence field, a
//! digest, a clock or a disposition.
//!
//! It needs the disposable PostgreSQL harness and a local `DATABENTO_API_KEY`, so it is `#[ignore]`
//! and runs through `crates/adapters/databento/tests/run_market_data_end_to_end.bash`.

use std::{path::PathBuf, sync::Arc};

use vibe_data::owner::{
    instrument_master_admission_v1::{
        InstrumentDecimalSubmissionV1, InstrumentMasterFactSubmissionV1,
        InstrumentVenueSourceMappingSubmissionV1, instrument_master_admission_from_environment_v1,
    },
    pit_market_snapshot_intake_v1::{
        MarketDataDecisionCutV1, PitMarketSnapshotDispositionV1,
        pit_market_snapshot_intake_from_environment_v1,
    },
    pit_observation_source_v1::PitObservationSourceV1,
    pit_snapshot::{
        UntrustedCorrectionPublicationTime, UntrustedEventEffectiveTime,
        UntrustedPitSnapshotRequest, UntrustedPitSnapshotTimeEvidence,
        UntrustedProviderAvailableTime, UntrustedRetrievalTime, UntrustedSnapshotDecisionCut,
        seal_request_claims_v1,
    },
    source_binding::{
        BindingDigest, UntrustedAdapterBinding, UntrustedCompleteFrontier,
        UntrustedCredentialAudienceClaim, UntrustedCredentialCapabilityClaim,
        UntrustedLicensePolicy, UntrustedMarketDataAsOf, UntrustedMarketSemantics,
        UntrustedOpaqueCredentialHandle, UntrustedSourceBindingLocator,
        UntrustedSourceBindingProposal, UntrustedTrustPolicy, seal_binding_claim_v1,
    },
    source_binding_admission_v1::{
        ProviderReachabilityEvidenceV1, ProviderRightsEvidenceV1,
        SourceBindingAdmissionDispositionV1, SourceBindingAdmissionRequestV1,
        source_binding_admission_from_environment_v1,
    },
    universe_selection::{
        UntrustedUniverseSelectionLocatorV1, UntrustedUniverseSelectionRequestV1,
    },
    universe_selection_admission_v1::{
        HistoricalMembershipAdmissionRequestV1, HistoricalMembershipSubmissionV1,
        UniverseSelectionTerminalV1, universe_selection_admission_from_environment_v1,
    },
};
use vibe_databento::{
    common::Credential, historical::DatabentoHistoricalClient,
    pit_observation_source_v1::DatabentoBboObservationSourceV1, pit_probe::PIT_PROBE_INSTRUMENT,
};

/// 2025-06-02 15:00:00Z, mid-session, a window this account carries real quotes for.
const EFFECTIVE_NS: u64 = 1_748_876_400_000_000_000;

fn digest(byte: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([byte; 32])
}

#[tokio::test]
#[ignore = "requires the disposable PostgreSQL harness and a local DATABENTO_API_KEY"]
async fn market_data_answers_one_frozen_request_from_live_vendor_data() {
    let api_key = std::env::var("DATABENTO_API_KEY").expect("the live vendor leg requires a key");
    let ceiling = std::env::var("DATABENTO_MAX_PROBE_COST_USD")
        .ok()
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(1.0);

    // 1. Operations admits the Source Binding. The Owner decides the disposition.
    let admission = source_binding_admission_from_environment_v1()
        .await
        .expect("the configured Market Data store opens");
    let proposal = databento_source_proposal();
    let binding_lineage_root;
    let binding_locator;
    let semantics_identity;
    {
        let terminal = admission
            .admit(SourceBindingAdmissionRequestV1 {
                proposal: proposal.clone(),
                rights: ProviderRightsEvidenceV1::Granted,
                reachability: ProviderReachabilityEvidenceV1::Reachable,
            })
            .await
            .expect("an admitted binding commits");
        assert_eq!(
            terminal.disposition(),
            SourceBindingAdmissionDispositionV1::Admitted,
            "granted rights and a reachable endpoint admit the binding"
        );
        binding_lineage_root = terminal.lineage_root();
        binding_locator = terminal.locator().clone();
        semantics_identity = terminal.market_semantics_identity();
    }

    // 2. Operations admits the instrument's master fact under the Owner's clock head. Without
    //    it the intake has no resolution to stamp and refuses the request outright.
    let instruments = instrument_master_admission_from_environment_v1()
        .await
        .expect("the configured Market Data store opens");
    let instrument = instruments
        .admit_fact(probe_instrument_submission(
            semantics_identity,
            proposal.source_frontier.digest,
            proposal.correction_frontier.digest,
        ))
        .await
        .expect("the probe instrument is admitted");
    assert_eq!(instrument.canonical_identity(), PIT_PROBE_INSTRUMENT);

    // 3. Operations admits the membership behind one eligible frontier.
    let universe = universe_selection_admission_from_environment_v1()
        .await
        .expect("the configured Market Data store opens");
    let frontier = digest(0x11);
    universe
        .admit_membership(HistoricalMembershipAdmissionRequestV1 {
            eligible_instrument_frontier: frontier,
            members: vec![HistoricalMembershipSubmissionV1 {
                member_key: PIT_PROBE_INSTRUMENT.to_string(),
                instrument: PIT_PROBE_INSTRUMENT.to_string(),
                effective_from_ns: 1,
                effective_until_ns: None,
                provider_available_ns: i128::from(EFFECTIVE_NS),
                retrieval_ns: i128::from(EFFECTIVE_NS),
                correction_publication_ns: i128::from(EFFECTIVE_NS),
                owner_observation_ns: i128::from(EFFECTIVE_NS),
                decision_cut: EFFECTIVE_NS,
                source_binding_lineage_root: binding_lineage_root,
                correction_frontier_digest: proposal.correction_frontier.digest,
            }],
        })
        .await
        .expect("a complete frontier is admitted whole");

    // 4. The Owner evaluates the requester's rule. The requester never states members.
    let selection = universe
        .evaluate(UntrustedUniverseSelectionRequestV1::new(
            digest(0x12),
            "RESEARCH_OWNER_V1",
            digest(0x13),
            vec![0, 1, 1],
            frontier,
            1,
            i128::from(EFFECTIVE_NS),
            EFFECTIVE_NS,
            binding_lineage_root,
            proposal.correction_frontier.digest,
            digest(0x14),
        ))
        .await
        .expect("the rule evaluates against admitted membership");
    assert_eq!(
        selection.member_count(),
        1,
        "the Owner selected exactly the admitted member"
    );

    // 5. The intake binds the real Data Client.
    let client = DatabentoHistoricalClient::new(
        Credential::new(api_key),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("publishers.json"),
        vibe_core::time::get_atomic_clock_realtime(),
        false,
    )
    .expect("the historical client builds");
    let observations: Arc<dyn PitObservationSourceV1> = Arc::new(
        DatabentoBboObservationSourceV1::new(client, [0xA5; 32], ceiling),
    );
    let intake = pit_market_snapshot_intake_from_environment_v1(observations)
        .await
        .expect("the configured Market Data store opens");

    // 6. R&D reads the Owner's cut and freezes a request against it.
    let cut = intake
        .current_decision_cut()
        .await
        .expect("admitting the binding established the canonical clock head");
    let mut request = frozen_request(
        &cut,
        &binding_locator,
        semantics_identity,
        selection.selection_identity(),
    );
    seal_request_claims_v1(&mut request);

    let terminal = intake
        .submit(request, universe_locator(&selection))
        .await
        .expect("the Owner reaches a finding");

    assert_eq!(
        terminal.disposition(),
        PitMarketSnapshotDispositionV1::Available,
        "an admitted binding, a matching semantics identity and live coverage mint AVAILABLE"
    );
    assert_ne!(
        terminal.snapshot_identity(),
        digest(0),
        "a committed snapshot carries a real identity"
    );
    eprintln!(
        "snapshot {:?} is {:?}",
        terminal.snapshot_identity(),
        terminal.disposition()
    );
}

/// The probe instrument as Operations would describe it: an open interval that began long before
/// the probe window, observed before the Owner's decision cut.
///
/// It states the admitted binding's own Market Semantics Compatibility identity and frontiers,
/// which is what lets one registry key later cover the instrument, the snapshot and the binding.
fn probe_instrument_submission(
    market_semantics_identity: BindingDigest,
    source_frontier: BindingDigest,
    correction_frontier: BindingDigest,
) -> InstrumentMasterFactSubmissionV1 {
    let observed = i128::from(EFFECTIVE_NS) - 1;
    InstrumentMasterFactSubmissionV1 {
        canonical_identity: PIT_PROBE_INSTRUMENT.to_string(),
        predecessor_fact_digest: None,
        mappings: vec![InstrumentVenueSourceMappingSubmissionV1 {
            venue_identity: "XNAS".into(),
            source_identity: "DATABENTO".into(),
            source_instrument: PIT_PROBE_INSTRUMENT.as_bytes().to_vec(),
        }],
        instrument_class: "EQUITY".into(),
        base_currency: Some("USD".into()),
        quote_currency: None,
        settlement_currency: Some("USD".into()),
        margin_currency: None,
        price_increment: InstrumentDecimalSubmissionV1 {
            mantissa: 1,
            scale: 2,
        },
        quantity_increment: InstrumentDecimalSubmissionV1 {
            mantissa: 1,
            scale: 0,
        },
        contract_multiplier: InstrumentDecimalSubmissionV1 {
            mantissa: 1,
            scale: 0,
        },
        calendar_identity: "XNYS-CALENDAR-V1".into(),
        session_identity: "XNYS-REGULAR-V1".into(),
        time_zone_identity: "America/New_York".into(),
        lifecycle_frontier: digest(0x31),
        corporate_action_frontier: digest(0x32),
        historical_membership_frontier: digest(0x11),
        market_semantics_identity,
        source_frontier,
        correction_frontier,
        effective_from: 1,
        effective_until: None,
        provider_available: observed,
        retrieval: observed,
        correction_publication: observed,
        owner_observation: observed,
    }
}

fn universe_locator(
    selection: &UniverseSelectionTerminalV1,
) -> UntrustedUniverseSelectionLocatorV1 {
    UntrustedUniverseSelectionLocatorV1::from_untrusted(
        selection.request_identity(),
        selection.request_meaning_digest(),
    )
}

fn frozen_request(
    cut: &MarketDataDecisionCutV1,
    binding_locator: &UntrustedSourceBindingLocator,
    market_semantics_identity: BindingDigest,
    universe_selection_digest: BindingDigest,
) -> UntrustedPitSnapshotRequest {
    let id = cut.clock_identity.clone();
    let epoch = cut.clock_epoch.clone();
    UntrustedPitSnapshotRequest {
        claimed_request_identity: digest(0),
        claimed_request_digest: digest(0),
        correlation_identity: digest(0x21),
        requester_identity: digest(0x22),
        scope_digest: digest(0x23),
        source_binding: binding_locator.clone(),
        instrument_master_digest: digest(0x24),
        universe_selection_digest,
        market_semantics_identity,
        time_evidence: UntrustedPitSnapshotTimeEvidence {
            event_effective: UntrustedEventEffectiveTime::from_untrusted(EFFECTIVE_NS, &id, &epoch),
            provider_available: UntrustedProviderAvailableTime::from_untrusted(
                EFFECTIVE_NS,
                &id,
                &epoch,
            ),
            retrieval: UntrustedRetrievalTime::from_untrusted(EFFECTIVE_NS, &id, &epoch),
            correction_publication: Some(UntrustedCorrectionPublicationTime::from_untrusted(
                EFFECTIVE_NS,
                &id,
                &epoch,
            )),
            decision_cut: UntrustedSnapshotDecisionCut::from_untrusted(
                cut.decision_cut,
                &id,
                &epoch,
            ),
            monotonic_sequence: cut.monotonic_sequence,
            restart_continuity_digest: cut.restart_continuity_digest,
            skew_bound: cut.skew_bound,
            uncertainty_bound: cut.uncertainty_bound,
            observed_at: cut.decision_cut,
            valid_through: cut.valid_through,
        },
    }
}

/// One Databento Source Binding as Operations would state it.
///
/// Every field is a claim: the endpoint identity is not a reachability assertion, and the
/// credential crosses as an opaque least-privilege handle rather than as key material.
fn databento_source_proposal() -> UntrustedSourceBindingProposal {
    let frontier = |digest_byte: u8, sequence: u64| UntrustedCompleteFrontier {
        stream_identity: "databento/EQUS.MINI".to_string(),
        cut_identity: "databento/EQUS.MINI/cut-1".to_string(),
        sequence,
        digest: digest(digest_byte),
    };
    let mut proposal = UntrustedSourceBindingProposal {
        claimed_binding_id: digest(0),
        schema_version: 1,
        adapter: UntrustedAdapterBinding {
            implementation_digest: digest(0x31),
            configuration_digest: digest(0x32),
            authenticated_endpoint_identity: "https://hist.databento.com".to_string(),
            dataset_mapping: "EQUS.MINI/bbo-1s".to_string(),
            account_mapping: "databento/historical".to_string(),
        },
        credential_handle: UntrustedOpaqueCredentialHandle::from_untrusted_identity(
            digest(0x33),
            UntrustedCredentialAudienceClaim::MarketData,
            [
                UntrustedCredentialCapabilityClaim::MarketDataRead,
                UntrustedCredentialCapabilityClaim::ReferenceDataRead,
                UntrustedCredentialCapabilityClaim::MetadataRead,
            ],
        ),
        trust_policy: UntrustedTrustPolicy {
            identity: "databento/official-historical".to_string(),
            version: 1,
        },
        semantics: UntrustedMarketSemantics {
            normalization: "databento/dbn".to_string(),
            adjustment: "raw".to_string(),
            price_meaning: "fixed-point-1e-9/usd".to_string(),
            calendar_rules: "xnys/regular".to_string(),
            session_rules: "xnys/regular".to_string(),
            timezone_rules: "america-new_york".to_string(),
            instrument_lifecycle_rules: "equs/mini".to_string(),
            corporate_action_rules: "equs/none".to_string(),
            membership_rules: "equs/static".to_string(),
            universe_rules: "requester-owned".to_string(),
            correction_policy: "provider-revision".to_string(),
        },
        license: UntrustedLicensePolicy {
            use_scope: "internal-research".to_string(),
            redistribution_scope: "none".to_string(),
            retention_policy: "retain-while-entitled".to_string(),
            redaction_policy: "no-payload-export".to_string(),
        },
        source_frontier: frontier(0x34, 1),
        correction_frontier: frontier(0x35, 1),
        // Every clock field below is overwritten by the Owner on admission; only the four
        // coordinates and the effective instant are the submitter's.
        time_evidence: UntrustedMarketDataAsOf {
            claimed_evidence_identity: digest(0),
            clock_identity: String::new(),
            clock_epoch: String::new(),
            monotonic_sequence: 0,
            restart_continuity_digest: digest(0),
            skew_bound: 0,
            uncertainty_bound: 0,
            event_effective: EFFECTIVE_NS,
            provider_available: EFFECTIVE_NS,
            retrieval: EFFECTIVE_NS,
            correction_publication: EFFECTIVE_NS,
            observed_at: 0,
            effective_at: EFFECTIVE_NS,
            valid_through: 0,
        },
    };
    seal_binding_claim_v1(&mut proposal);
    proposal
}
