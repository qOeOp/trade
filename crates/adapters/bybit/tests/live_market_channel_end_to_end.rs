//! One live market fact channel, from the venue's public stream to an Owner-sealed fact.
//!
//! Every leg is the production composition root: Operations admits a Source Binding and the
//! instrument's master fact, the Owner issues the subscription from that fact and opens a channel,
//! the venue's real public trade stream supplies the observations, and the Owner stamps each one
//! and advances a durable head. Nothing here supplies a lineage, a semantics identity, a sequence,
//! a retrieval instant or a value.
//!
//! It needs the disposable PostgreSQL harness and a reachable venue but no credential, so it runs
//! through `crates/adapters/bybit/tests/run_live_market_channel_end_to_end.bash`.

use std::sync::Arc;

use vibe_bybit::{
    common::enums::{BybitEnvironment, BybitProductType},
    live_market_fact_source_v1::BybitPublicTradeSourceV1,
};
use vibe_data::owner::{
    instrument_master_admission_v1::{
        InstrumentDecimalSubmissionV1, InstrumentMasterFactSubmissionV1,
        InstrumentVenueSourceMappingSubmissionV1, instrument_master_admission_from_environment_v1,
    },
    live_market_fact_v1::{LiveMarketFactSourceV1, LiveMarketSubscriptionV1},
    live_market_stream_v1::{
        LiveMarketChannelErrorV1, LiveMarketChannelRequestV1,
        live_market_fact_intake_from_environment_v1,
    },
    source_binding::{
        BindingDigest, UntrustedAdapterBinding, UntrustedCompleteFrontier,
        UntrustedCredentialAudienceClaim, UntrustedCredentialCapabilityClaim,
        UntrustedLicensePolicy, UntrustedMarketDataAsOf, UntrustedMarketSemantics,
        UntrustedOpaqueCredentialHandle, UntrustedSourceBindingLocator,
        UntrustedSourceBindingLocatorFields, UntrustedSourceBindingProposal, UntrustedTrustPolicy,
        seal_binding_claim_v1,
    },
    source_binding_admission_v1::{
        ProviderReachabilityEvidenceV1, ProviderRightsEvidenceV1,
        SourceBindingAdmissionDispositionV1, SourceBindingAdmissionRequestV1,
        source_binding_admission_from_environment_v1,
    },
    strategy_input_binding::{MarketDataFieldSemantic, StrategyInputChannel},
};

const MEMBER: &str = "BTCUSDT.BYBIT";
const VENUE_SYMBOL: &str = "BTCUSDT";

fn digest(byte: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([byte; 32])
}

fn now_ns() -> u64 {
    u64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("the host clock is after the epoch")
            .as_nanos(),
    )
    .expect("the host clock fits in u64 nanoseconds")
}

#[tokio::test]
#[ignore = "requires the disposable PostgreSQL harness and a reachable venue"]
async fn a_live_channel_seals_venue_trades_and_advances_its_durable_head() {
    let admitted_at = now_ns();

    // 1. Operations admits the Source Binding the channel will run on.
    let admission = source_binding_admission_from_environment_v1()
        .await
        .expect("the configured Market Data store opens");
    let proposal = bybit_source_proposal(admitted_at);
    let terminal = admission
        .admit(SourceBindingAdmissionRequestV1 {
            proposal,
            rights: ProviderRightsEvidenceV1::Granted,
            reachability: ProviderReachabilityEvidenceV1::Reachable,
        })
        .await
        .expect("an admitted binding commits");
    assert_eq!(
        terminal.disposition(),
        SourceBindingAdmissionDispositionV1::Admitted
    );
    let binding_locator = terminal.locator().clone();
    let semantics_identity = terminal.market_semantics_identity();

    // 2. Operations admits the instrument's master fact under the binding's own semantics. Without
    //    it the Owner has nothing to vouch for and issues no subscription at all, so a proposed
    //    instrument is refused rather than carried on the caller's word.
    instrument_master_admission_from_environment_v1()
        .await
        .expect("the configured Market Data store opens")
        .admit_fact(instrument_submission(&binding_locator, admitted_at))
        .await
        .expect("the member's instrument fact is admitted");

    // 3. The venue's real public stream, with no credential anywhere. Operations connects the one
    //    Data Client for the scope it is about to request; the Owner refuses the first batch if
    //    its own issued scope disagrees, so the client cannot widen what the channel carries.
    let requested = LiveMarketSubscriptionV1::issue_v1(
        vec![MEMBER.to_string()],
        StrategyInputChannel::Market,
        MarketDataFieldSemantic::TradeLastPrice,
    )
    .expect("one named instrument is a usable scope");
    let venue = Arc::new(
        BybitPublicTradeSourceV1::connect(
            BybitProductType::Spot,
            BybitEnvironment::Mainnet,
            &requested,
            20,
        )
        .await
        .expect("the public stream connects and subscribes"),
    );
    let source: Arc<dyn LiveMarketFactSourceV1> = venue.clone();

    // 4. The Owner opens the channel. A fresh channel has issued nothing.
    let intake = live_market_fact_intake_from_environment_v1(source)
        .await
        .expect("the configured Market Data store opens");
    let channel = intake
        .open_channel(channel_request(binding_locator))
        .await
        .expect("an admitted binding opens a channel");
    let opened = channel.head().await.expect("a fresh channel has a head");
    assert_eq!(opened.owner_sequence(), 0);
    assert_eq!(opened.last_fact_identity(), None);

    // 5. The first facts the venue publishes. This is the whole point: a real trade arrives and
    //    leaves as an Owner-stamped fact.
    let facts = tokio::time::timeout(std::time::Duration::from_secs(60), channel.next_facts())
        .await
        .expect("the venue publishes a trade within the window")
        .expect("the batch seals");
    assert!(
        !facts.is_empty(),
        "a sealed batch carries at least one fact"
    );

    for (offset, fact) in facts.iter().enumerate() {
        assert_eq!(fact.instrument(), MEMBER);
        assert_eq!(fact.channel(), StrategyInputChannel::Market);
        assert_eq!(
            fact.field_semantic(),
            MarketDataFieldSemantic::TradeLastPrice
        );
        assert_eq!(
            fact.market_semantics_identity(),
            semantics_identity,
            "every live fact carries the binding's own compatibility identity"
        );
        assert_eq!(
            fact.owner_sequence(),
            (offset as u64) + 1,
            "the Owner's sequence starts at one and advances by one"
        );
        assert!(fact.value_mantissa() > 0, "a traded price is positive");
        assert!(fact.provider_available() >= fact.event_effective());
        assert!(fact.retrieval() >= fact.provider_available());
    }
    let last = facts.last().expect("a non-empty batch has a last fact");

    // 6. The head advanced with the batch, which is what makes a restart resume rather than
    //    replay.
    let advanced = channel.head().await.expect("the head is readable");
    assert_eq!(advanced.owner_sequence(), last.owner_sequence());
    assert_eq!(advanced.last_fact_identity(), Some(last.identity()));
    assert_eq!(advanced.channel_identity(), channel.channel_identity());

    // 7. One channel is one consumer: a second open while this one is live is refused, because
    //    two pollers would number one head in whatever order their venue waits finished.
    assert_eq!(
        intake
            .open_channel(channel_request(terminal.locator().clone()))
            .await
            .map(|_| ())
            .unwrap_err(),
        LiveMarketChannelErrorV1::ChannelBusy
    );

    // 8. Reopening the same channel after the first is closed resumes from that head rather than
    //    starting over.
    let channel_identity = channel.channel_identity();
    drop(channel);
    let resumed = intake
        .open_channel(channel_request(terminal.locator().clone()))
        .await
        .expect("reopening an admitted channel resumes it");
    let resumed_head = resumed.head().await.expect("the resumed head is readable");
    assert_eq!(resumed_head.owner_sequence(), advanced.owner_sequence());
    assert_eq!(
        resumed_head.last_fact_identity(),
        advanced.last_fact_identity()
    );
    assert_eq!(resumed.channel_identity(), channel_identity);

    // 9. A binding this Owner never admitted opens nothing, whatever the venue would answer.
    assert_eq!(
        intake
            .open_channel(channel_request(never_admitted_locator(admitted_at)))
            .await
            .map(|_| ())
            .unwrap_err(),
        LiveMarketChannelErrorV1::BindingUnavailable
    );

    // 10. An instrument the Owner holds no master fact for is refused, so a caller cannot widen a
    //     channel by naming one.
    assert_eq!(
        intake
            .open_channel(LiveMarketChannelRequestV1 {
                source_binding: terminal.locator().clone(),
                proposed_instruments: vec![MEMBER.to_string(), "ETHUSDT.BYBIT".to_string()],
                channel: StrategyInputChannel::Market,
                field_semantic: MarketDataFieldSemantic::TradeLastPrice,
            })
            .await
            .map(|_| ())
            .unwrap_err(),
        LiveMarketChannelErrorV1::InstrumentUnavailable
    );
    eprintln!(
        "channel {:?} sealed {} facts, head at sequence {}",
        resumed.channel_identity(),
        facts.len(),
        advanced.owner_sequence()
    );
    venue.close().await.expect("the venue connection closes");
}

/// What Operations asks for. Only the binding and the candidate differ between the calls.
fn channel_request(source_binding: UntrustedSourceBindingLocator) -> LiveMarketChannelRequestV1 {
    LiveMarketChannelRequestV1 {
        source_binding,
        proposed_instruments: vec![MEMBER.to_string()],
        channel: StrategyInputChannel::Market,
        field_semantic: MarketDataFieldSemantic::TradeLastPrice,
    }
}

/// The member as Operations would describe it, under the binding's own semantics and frontiers.
///
/// Every observation instant is before the channel opens, because a fact the Owner could not yet
/// have observed is not one it may issue a subscription from.
fn instrument_submission(
    source_binding: &UntrustedSourceBindingLocator,
    admitted_at: u64,
) -> InstrumentMasterFactSubmissionV1 {
    let observed = i128::from(admitted_at) - 1;
    InstrumentMasterFactSubmissionV1 {
        canonical_identity: MEMBER.to_string(),
        predecessor_fact_digest: None,
        mappings: vec![InstrumentVenueSourceMappingSubmissionV1 {
            venue_identity: "BYBIT".into(),
            source_identity: "BYBIT_SPOT".into(),
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
            scale: 6,
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
        source_binding: source_binding.clone(),
        effective_from: 1,
        effective_until: None,
        provider_available: observed,
        retrieval: observed,
        correction_publication: observed,
        owner_observation: observed,
    }
}

/// A syntactically valid locator for a binding this Owner never admitted.
///
/// The Owner refuses it at its first step, when it fails to load the binding, so nothing else
/// about the locator has to be plausible for the refusal to mean what it says.
fn never_admitted_locator(observed_ns: u64) -> UntrustedSourceBindingLocator {
    let frontier = |digest_byte: u8| UntrustedCompleteFrontier {
        stream_identity: "bybit/never-admitted".to_string(),
        cut_identity: "bybit/never-admitted/cut-1".to_string(),
        sequence: 1,
        digest: digest(digest_byte),
    };
    UntrustedSourceBindingLocator::from_untrusted(UntrustedSourceBindingLocatorFields {
        owner: "MARKET_DATA_OWNER_V1".to_string(),
        lineage_root: digest(0xE0),
        lineage_version: 1,
        predecessor_binding_id: None,
        predecessor_fact_digest: None,
        binding_id: digest(0xEE),
        fact_digest: digest(0xEF),
        credential_handle_identity: digest(0xE1),
        credential_audience: UntrustedCredentialAudienceClaim::MarketData,
        credential_capabilities: [UntrustedCredentialCapabilityClaim::MarketDataRead]
            .into_iter()
            .collect(),
        source_frontier: frontier(0xE2),
        correction_frontier: frontier(0xE3),
        time_evidence: UntrustedMarketDataAsOf {
            claimed_evidence_identity: digest(0xE4),
            clock_identity: "market-data.owner-clock.v1-00001".to_string(),
            clock_epoch: "market-data.owner-epoch.v1-00001".to_string(),
            monotonic_sequence: 1,
            restart_continuity_digest: digest(0xE5),
            skew_bound: 1,
            uncertainty_bound: 1,
            event_effective: observed_ns,
            provider_available: observed_ns,
            retrieval: observed_ns,
            correction_publication: observed_ns,
            observed_at: observed_ns,
            effective_at: observed_ns,
            valid_through: observed_ns + 1,
        },
    })
}

/// The venue binding as Operations would propose it. The public stream needs no secret, so the
/// handle names a capability the Owner can check rather than a credential anybody holds.
fn bybit_source_proposal(observed_ns: u64) -> UntrustedSourceBindingProposal {
    let frontier = |digest_byte: u8, sequence: u64| UntrustedCompleteFrontier {
        stream_identity: "bybit/spot-public-trade".to_string(),
        cut_identity: "bybit/spot-public-trade/cut-1".to_string(),
        sequence,
        digest: digest(digest_byte),
    };
    let mut proposal = UntrustedSourceBindingProposal {
        claimed_binding_id: digest(0),
        schema_version: 1,
        adapter: UntrustedAdapterBinding {
            implementation_digest: digest(0x61),
            configuration_digest: digest(0x62),
            authenticated_endpoint_identity: "wss://stream.bybit.com/v5/public/spot".to_string(),
            dataset_mapping: "spot/publicTrade".to_string(),
            account_mapping: "bybit/public".to_string(),
        },
        credential_handle: UntrustedOpaqueCredentialHandle::from_untrusted_identity(
            digest(0x63),
            UntrustedCredentialAudienceClaim::MarketData,
            [
                UntrustedCredentialCapabilityClaim::MarketDataRead,
                UntrustedCredentialCapabilityClaim::ReferenceDataRead,
                UntrustedCredentialCapabilityClaim::MetadataRead,
            ],
        ),
        trust_policy: UntrustedTrustPolicy {
            identity: "bybit/official-public-stream".to_string(),
            version: 1,
        },
        semantics: UntrustedMarketSemantics {
            normalization: "bybit/public-trade".to_string(),
            adjustment: "raw".to_string(),
            price_meaning: "decimal-string/usdt".to_string(),
            calendar_rules: "crypto/continuous".to_string(),
            session_rules: "crypto/continuous".to_string(),
            timezone_rules: "etc-utc".to_string(),
            instrument_lifecycle_rules: "bybit/spot".to_string(),
            corporate_action_rules: "crypto/none".to_string(),
            membership_rules: "bybit/static".to_string(),
            universe_rules: "requester-owned".to_string(),
            correction_policy: "provider-revision".to_string(),
        },
        license: UntrustedLicensePolicy {
            use_scope: "internal-research".to_string(),
            redistribution_scope: "none".to_string(),
            retention_policy: "retain-while-entitled".to_string(),
            redaction_policy: "no-payload-export".to_string(),
        },
        source_frontier: frontier(0x64, 1),
        correction_frontier: frontier(0x65, 1),
        // Every clock field below is overwritten by the Owner on admission.
        time_evidence: UntrustedMarketDataAsOf {
            claimed_evidence_identity: digest(0),
            clock_identity: String::new(),
            clock_epoch: String::new(),
            monotonic_sequence: 0,
            restart_continuity_digest: digest(0),
            skew_bound: 0,
            uncertainty_bound: 0,
            event_effective: observed_ns,
            provider_available: observed_ns,
            retrieval: observed_ns,
            correction_publication: observed_ns,
            observed_at: 0,
            effective_at: observed_ns,
            valid_through: 0,
        },
    };
    seal_binding_claim_v1(&mut proposal);
    proposal
}
