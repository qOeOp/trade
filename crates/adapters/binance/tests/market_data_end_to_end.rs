//! One frozen PIT Market Snapshot Request answered from live venue data, without a credential.
//!
//! This is the same production composition root the Databento leg drives, on a venue whose market
//! data needs no key: Operations admits a Source Binding, admits the instrument's master fact,
//! admits the historical membership behind one eligible frontier and has the Owner evaluate a
//! selection rule; R&D then reads the Owner's decision cut, freezes a request against it, and
//! receives a terminal. It then states the binding's Market Semantics, which is what a Strategy
//! Input declaration re-resolves. Nothing here supplies an observation, an evidence field, a
//! digest, a clock or a disposition.
//!
//! Its value is that it costs nothing and needs no secret, so the whole production path can be
//! exercised against a real store and a real venue whenever the disposable PostgreSQL harness is
//! available. It is `#[ignore]` because it needs that harness and a reachable venue, and runs
//! through `crates/adapters/binance/tests/run_market_data_end_to_end.bash`.

use std::{collections::BTreeMap, sync::Arc};

use vibe_binance::{
    common::enums::BinanceEnvironment,
    pit_observation_source_v1::BinanceSpotBarObservationSourceV1,
    spot::http::client::BinanceSpotHttpClient,
};
use vibe_core::time::get_atomic_clock_realtime;
use vibe_data::owner::{
    instrument_master_admission_v1::{
        InstrumentDecimalSubmissionV1, InstrumentMasterFactSubmissionV1,
        InstrumentVenueSourceMappingSubmissionV1, instrument_master_admission_from_environment_v1,
    },
    market_semantics_admission_v1::{
        MarketSemanticsFactSubmissionV1, MarketSemanticsValueSubmissionV1,
        market_semantics_admission_from_environment_v1,
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

/// The member the run admits, and the venue symbol behind it.
const MEMBER: &str = "BTCUSDT.BINANCE";
const VENUE_SYMBOL: &str = "BTCUSDT";
/// One minute of bars; the Owner's timeframe word for it is `1M`.
const INTERVAL: &str = "1m";

fn digest(byte: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([byte; 32])
}

/// The event instant the request freezes: the close of a bar that is certainly already closed.
fn frozen_event_effective_ns() -> u64 {
    let now_ns = u64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("the host clock is after the epoch")
            .as_nanos(),
    )
    .expect("the host clock fits in u64 nanoseconds");
    // Two minutes back, floored to the minute, so the venue has certainly closed and published it.
    let two_minutes_ago = now_ns - 120_000_000_000;
    two_minutes_ago - (two_minutes_ago % 60_000_000_000)
}

#[tokio::test]
#[ignore = "requires the disposable PostgreSQL harness and a reachable venue"]
async fn market_data_answers_one_frozen_request_without_a_credential() {
    let effective_ns = frozen_event_effective_ns();

    // 1. Operations admits the Source Binding. The Owner decides the disposition.
    let admission = source_binding_admission_from_environment_v1()
        .await
        .expect("the configured Market Data store opens");
    let proposal = binance_source_proposal(effective_ns);
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
    let binding_lineage_root = terminal.lineage_root();
    let binding_locator = terminal.locator().clone();
    let semantics_identity = terminal.market_semantics_identity();

    // 2. Operations admits the instrument's master fact under the Owner's own clock head. The PIT
    //    intake stamps its digest from this, so without it no snapshot can be minted at all.
    let instruments = instrument_master_admission_from_environment_v1()
        .await
        .expect("the configured Market Data store opens");
    let instrument = instruments
        .admit_fact(instrument_submission(
            semantics_identity,
            proposal.source_frontier.digest,
            proposal.correction_frontier.digest,
            effective_ns,
        ))
        .await
        .expect("the member's instrument fact is admitted");
    assert_eq!(instrument.canonical_identity(), MEMBER);

    // 3. Operations admits the membership behind one eligible frontier.
    let universe = universe_selection_admission_from_environment_v1()
        .await
        .expect("the configured Market Data store opens");
    let frontier = digest(0x11);
    universe
        .admit_membership(HistoricalMembershipAdmissionRequestV1 {
            eligible_instrument_frontier: frontier,
            members: vec![HistoricalMembershipSubmissionV1 {
                member_key: MEMBER.to_string(),
                instrument: MEMBER.to_string(),
                effective_from_ns: 1,
                effective_until_ns: None,
                provider_available_ns: i128::from(effective_ns),
                retrieval_ns: i128::from(effective_ns),
                correction_publication_ns: i128::from(effective_ns),
                owner_observation_ns: i128::from(effective_ns),
                decision_cut: effective_ns,
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
            i128::from(effective_ns),
            effective_ns,
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

    // 5. The intake binds the real Data Client. No credential is supplied anywhere.
    let client = BinanceSpotHttpClient::new_with_json_responses(
        BinanceEnvironment::Live,
        get_atomic_clock_realtime(),
        None,
        None,
        None,
        None,
        Some(30),
        None,
        true,
    )
    .expect("the keyless spot client builds");
    let mut symbols = BTreeMap::new();
    symbols.insert(MEMBER.to_string(), VENUE_SYMBOL.to_string());
    let observations: Arc<dyn PitObservationSourceV1> = Arc::new(
        BinanceSpotBarObservationSourceV1::new(client, symbols, INTERVAL)
            .expect("the Data Client accepts the member mapping"),
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
        effective_ns,
    );
    seal_request_claims_v1(&mut request);
    let claimed_instrument_master_digest = request.instrument_master_digest;

    let snapshot = intake
        .submit(request, universe_locator(&selection))
        .await
        .expect("the Owner reaches a finding");
    assert_eq!(
        snapshot.disposition(),
        PitMarketSnapshotDispositionV1::Available,
        "an admitted binding, a matching semantics identity and live coverage mint AVAILABLE"
    );
    assert_ne!(
        snapshot.snapshot_identity(),
        digest(0),
        "a committed snapshot carries a real identity"
    );
    assert_ne!(
        claimed_instrument_master_digest,
        instrument.fact_digest(),
        "the caller's placeholder is not the Owner's resolution, so the stamp is observable"
    );

    // 7. Operations states what the binding's observations mean. This is the last fact a Strategy
    //    Input declaration re-resolves, and the Owner derives its scope, regime and every
    //    coordinate from the snapshot it just committed.
    let semantics = market_semantics_admission_from_environment_v1()
        .await
        .expect("the configured Market Data store opens");
    let stated = semantics
        .admit_fact(MarketSemanticsFactSubmissionV1 {
            source_binding: binding_locator,
            pit_snapshot: snapshot
                .locator()
                .expect("an AVAILABLE terminal names its snapshot")
                .clone(),
            value: MarketSemanticsValueSubmissionV1 {
                normalization_identity: digest(0x41),
                price_adjustment: "RAW".into(),
                timestamp_basis: "INTERVAL_CLOSE".into(),
                price_unit_identity: digest(0x42),
                size_unit_identity: digest(0x43),
            },
        })
        .await
        .expect("the binding's semantics are admitted against its own snapshot");
    assert_eq!(
        stated.compatibility_scope_identity(),
        semantics_identity,
        "the scope is the binding's own compatibility identity"
    );

    eprintln!(
        "snapshot {:?} is {:?}; semantics fact {:?}",
        snapshot.snapshot_identity(),
        snapshot.disposition(),
        stated.fact_identity()
    );
}

fn universe_locator(
    selection: &UniverseSelectionTerminalV1,
) -> UntrustedUniverseSelectionLocatorV1 {
    UntrustedUniverseSelectionLocatorV1::from_untrusted(
        selection.request_identity(),
        selection.request_meaning_digest(),
    )
}

/// The member as Operations would describe it, under the binding's own semantics and frontiers.
fn instrument_submission(
    market_semantics_identity: BindingDigest,
    source_frontier: BindingDigest,
    correction_frontier: BindingDigest,
    effective_ns: u64,
) -> InstrumentMasterFactSubmissionV1 {
    let observed = i128::from(effective_ns) - 1;
    InstrumentMasterFactSubmissionV1 {
        canonical_identity: MEMBER.to_string(),
        predecessor_fact_digest: None,
        mappings: vec![InstrumentVenueSourceMappingSubmissionV1 {
            venue_identity: "BINANCE".into(),
            source_identity: "BINANCE_SPOT".into(),
            source_instrument: VENUE_SYMBOL.as_bytes().to_vec(),
        }],
        instrument_class: "CRYPTO_SPOT".into(),
        base_currency: Some("BTC".into()),
        quote_currency: Some("USDT".into()),
        settlement_currency: Some("USDT".into()),
        margin_currency: None,
        price_increment: InstrumentDecimalSubmissionV1 {
            mantissa: 1,
            scale: 2,
        },
        quantity_increment: InstrumentDecimalSubmissionV1 {
            mantissa: 1,
            scale: 5,
        },
        contract_multiplier: InstrumentDecimalSubmissionV1 {
            mantissa: 1,
            scale: 0,
        },
        calendar_identity: "CRYPTO-CONTINUOUS-V1".into(),
        session_identity: "CRYPTO-CONTINUOUS-V1".into(),
        time_zone_identity: "Etc/UTC".into(),
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

fn frozen_request(
    cut: &MarketDataDecisionCutV1,
    binding_locator: &UntrustedSourceBindingLocator,
    market_semantics_identity: BindingDigest,
    universe_selection_digest: BindingDigest,
    effective_ns: u64,
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
            event_effective: UntrustedEventEffectiveTime::from_untrusted(effective_ns, &id, &epoch),
            provider_available: UntrustedProviderAvailableTime::from_untrusted(
                effective_ns,
                &id,
                &epoch,
            ),
            retrieval: UntrustedRetrievalTime::from_untrusted(effective_ns, &id, &epoch),
            correction_publication: Some(UntrustedCorrectionPublicationTime::from_untrusted(
                effective_ns,
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

/// The keyless venue binding as Operations would propose it.
fn binance_source_proposal(effective_ns: u64) -> UntrustedSourceBindingProposal {
    let frontier = |digest_byte: u8, sequence: u64| UntrustedCompleteFrontier {
        stream_identity: "binance/spot-klines".to_string(),
        cut_identity: "binance/spot-klines/cut-1".to_string(),
        sequence,
        digest: digest(digest_byte),
    };
    let mut proposal = UntrustedSourceBindingProposal {
        claimed_binding_id: digest(0),
        schema_version: 1,
        adapter: UntrustedAdapterBinding {
            implementation_digest: digest(0x51),
            configuration_digest: digest(0x52),
            authenticated_endpoint_identity: "https://data-api.binance.vision".to_string(),
            dataset_mapping: "spot/klines/1m".to_string(),
            account_mapping: "binance/public".to_string(),
        },
        // The venue serves this data without authentication, so the handle names a capability the
        // Owner can check rather than a secret anybody holds.
        credential_handle: UntrustedOpaqueCredentialHandle::from_untrusted_identity(
            digest(0x53),
            UntrustedCredentialAudienceClaim::MarketData,
            [
                UntrustedCredentialCapabilityClaim::MarketDataRead,
                UntrustedCredentialCapabilityClaim::ReferenceDataRead,
                UntrustedCredentialCapabilityClaim::MetadataRead,
            ],
        ),
        trust_policy: UntrustedTrustPolicy {
            identity: "binance/official-public-data".to_string(),
            version: 1,
        },
        semantics: UntrustedMarketSemantics {
            normalization: "binance/spot-kline".to_string(),
            adjustment: "raw".to_string(),
            price_meaning: "decimal-string/usdt".to_string(),
            calendar_rules: "crypto/continuous".to_string(),
            session_rules: "crypto/continuous".to_string(),
            timezone_rules: "etc-utc".to_string(),
            instrument_lifecycle_rules: "binance/spot".to_string(),
            corporate_action_rules: "crypto/none".to_string(),
            membership_rules: "binance/static".to_string(),
            universe_rules: "requester-owned".to_string(),
            correction_policy: "provider-revision".to_string(),
        },
        license: UntrustedLicensePolicy {
            use_scope: "internal-research".to_string(),
            redistribution_scope: "none".to_string(),
            retention_policy: "retain-while-entitled".to_string(),
            redaction_policy: "no-payload-export".to_string(),
        },
        source_frontier: frontier(0x54, 1),
        correction_frontier: frontier(0x55, 1),
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
            event_effective: effective_ns,
            provider_available: effective_ns,
            retrieval: effective_ns,
            correction_publication: effective_ns,
            observed_at: 0,
            effective_at: effective_ns,
            valid_through: 0,
        },
    };
    seal_binding_claim_v1(&mut proposal);
    proposal
}
