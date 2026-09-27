//! The fixture values the Market Data Owner's PostgreSQL tests and the sealed chain acceptance
//! basis are built from.
//!
//! One definition serves both: the acceptance basis ([`super::chain_market_base_v1`]) writes the
//! chain market base from these values, and the Owner's own tests write the same base, and every
//! other fixture, from them. A second copy would let the base the chain ensures and the base the
//! tests assert over drift apart without either noticing.

use crate::owner::{
    instrument_master::{
        BACKTEST_OWNER_V1, InstrumentClass, InstrumentDecimal, InstrumentMasterFactProposalV1,
        InstrumentMasterScopeV1, InstrumentVenueSourceMapping, UntrustedInstrumentMasterRequestV1,
    },
    pit_snapshot::{
        UntrustedCorrectionPublicationTime, UntrustedEventEffectiveTime,
        UntrustedPitSnapshotTimeEvidence, UntrustedProviderAvailableTime, UntrustedRetrievalTime,
        UntrustedSnapshotDecisionCut,
    },
    shared_time_evidence::UntrustedClockHeadLocator,
    source_binding::{
        BindingDigest, MarketDataClockAdmission, UntrustedAdapterBinding,
        UntrustedCompleteFrontier, UntrustedCredentialAudienceClaim,
        UntrustedCredentialCapabilityClaim, UntrustedLicensePolicy, UntrustedMarketDataAsOf,
        UntrustedMarketSemantics, UntrustedOpaqueCredentialHandle, UntrustedSourceBindingProposal,
        UntrustedTrustPolicy,
        authority::{
            derive_binding_id, derive_market_semantics_compatibility_identity_v1,
            derive_time_evidence_identity,
        },
    },
};

pub(super) fn d(byte: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([byte; 32])
}

/// The test clock names itself in the 32-byte width the Instrument Master codec binds, exactly as
/// the production Owner clock does; a shorter name could never admit an instrument fact.
pub(super) const TEST_CLOCK_IDENTITY_V1: &str = "market-clock.identity.v1-0000001";
pub(super) const TEST_CLOCK_EPOCH_V1: &str = "market-clock.epoch.v1-0000000001";

pub(super) fn shared_clock(
    clock_identity: &str,
    epoch: &str,
    sequence: u64,
    cut: u64,
    continuity: BindingDigest,
    uncertainty: u64,
    skew: u64,
) -> MarketDataClockAdmission {
    MarketDataClockAdmission::seal_for_test(
        clock_identity,
        epoch,
        sequence,
        cut,
        cut,
        cut + 60,
        continuity,
        uncertainty,
        skew,
    )
}

/// The semantics every fixture Source Binding here states.
pub(super) fn fixture_semantics_v1() -> UntrustedMarketSemantics {
    UntrustedMarketSemantics {
        normalization: "normalization-v1".into(),
        adjustment: "raw-v1".into(),
        price_meaning: "quote-currency-per-base-v1".into(),
        calendar_rules: "calendar-v1".into(),
        session_rules: "session-v1".into(),
        timezone_rules: "iana-2026a".into(),
        instrument_lifecycle_rules: "instrument-lifecycle-v1".into(),
        corporate_action_rules: "corporate-actions-v1".into(),
        membership_rules: "historical-membership-v1".into(),
        universe_rules: "requester-rule-evaluation-v1".into(),
        correction_policy: "successor-only-v1".into(),
    }
}

/// The Market Semantics compatibility scope of a fixture Source Binding, derived from its semantics
/// by the function production admits under. It is derived, never written: an Instrument Master fact
/// naming any other scope fails the registry key's `InstrumentFactMarketSemantics` condition for
/// every fact production admits under the binding.
pub(super) fn fixture_market_semantics_identity_v1() -> BindingDigest {
    derive_market_semantics_compatibility_identity_v1(&fixture_semantics_v1())
}

pub(super) fn source_proposal(sequence: u64, cut: u64) -> UntrustedSourceBindingProposal {
    let successor = sequence > 10;
    let mut proposal = UntrustedSourceBindingProposal {
        availability_rule: None,
        claimed_binding_id: d(0),
        schema_version: 1,
        adapter: UntrustedAdapterBinding {
            implementation_digest: d(1),
            configuration_digest: d(2),
            authenticated_endpoint_identity: "https://market.example/v1".into(),
            dataset_mapping: "dataset/trades".into(),
            account_mapping: "tenant/entitlement".into(),
        },
        credential_handle: UntrustedOpaqueCredentialHandle::from_untrusted_identity(
            d(6),
            UntrustedCredentialAudienceClaim::MarketData,
            [
                UntrustedCredentialCapabilityClaim::MarketDataRead,
                UntrustedCredentialCapabilityClaim::ReferenceDataRead,
                UntrustedCredentialCapabilityClaim::MetadataRead,
            ],
        ),
        trust_policy: UntrustedTrustPolicy {
            identity: "trust-policy".into(),
            version: 1,
        },
        semantics: fixture_semantics_v1(),
        license: UntrustedLicensePolicy {
            use_scope: "acquire-cache-archive-backtest-model-display".into(),
            redistribution_scope: "derived-only".into(),
            retention_policy: "retain-30d-delete-v1".into(),
            redaction_policy: "no-licensed-payload-v1".into(),
        },
        source_frontier: UntrustedCompleteFrontier {
            stream_identity: "source-stream".into(),
            cut_identity: if successor {
                "source-cut-12"
            } else {
                "source-cut-10"
            }
            .into(),
            sequence,
            digest: if successor { d(8) } else { d(3) },
        },
        correction_frontier: UntrustedCompleteFrontier {
            stream_identity: "correction-stream".into(),
            cut_identity: format!(
                "correction-cut-{}",
                if successor { sequence } else { sequence + 1 }
            ),
            sequence: if successor { sequence } else { sequence + 1 },
            digest: if successor { d(9) } else { d(4) },
        },
        time_evidence: UntrustedMarketDataAsOf {
            claimed_evidence_identity: d(0),
            clock_identity: TEST_CLOCK_IDENTITY_V1.into(),
            clock_epoch: TEST_CLOCK_EPOCH_V1.into(),
            monotonic_sequence: if successor { 2 } else { 1 },
            restart_continuity_digest: d(7),
            skew_bound: 2,
            uncertainty_bound: 1,
            event_effective: 10,
            provider_available: if successor { 45 } else { 20 },
            retrieval: if successor { 49 } else { 30 },
            correction_publication: if successor { 49 } else { 25 },
            observed_at: cut,
            effective_at: cut,
            valid_through: cut + 60,
        },
    };
    proposal.time_evidence.claimed_evidence_identity =
        derive_time_evidence_identity(&proposal.time_evidence);
    proposal.claimed_binding_id = derive_binding_id(&proposal);
    proposal
}

pub(super) fn instrument_fact(
    identity: &str,
    predecessor: Option<BindingDigest>,
    correction: u8,
) -> InstrumentMasterFactProposalV1 {
    InstrumentMasterFactProposalV1 {
        canonical_identity: identity.into(),
        predecessor_fact_digest: predecessor,
        mappings: vec![InstrumentVenueSourceMapping {
            venue_identity: "XNAS".into(),
            source_identity: "SIP".into(),
            source_instrument: identity.as_bytes().to_vec(),
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
        calendar_identity: "XNYS-CALENDAR-V1".into(),
        session_identity: "XNYS-REGULAR-V1".into(),
        time_zone_identity: "Etc/UTC".into(),
        lifecycle_frontier: d(81),
        corporate_action_frontier: d(82),
        historical_membership_frontier: d(83),
        market_semantics_identity: fixture_market_semantics_identity_v1(),
        source_frontier: d(85),
        correction_frontier: d(correction),
        effective_from: 10,
        effective_until: Some(200),
        provider_available: 90,
        retrieval: 91,
        correction_publication: 92,
        owner_observation: 99,
    }
}

pub(super) fn instrument_request(
    identity: u8,
    scope: InstrumentMasterScopeV1,
    locator: UntrustedClockHeadLocator,
) -> UntrustedInstrumentMasterRequestV1 {
    UntrustedInstrumentMasterRequestV1 {
        request_identity: d(identity),
        request_meaning_digest: d(identity.wrapping_add(1)),
        consumer_role: BACKTEST_OWNER_V1.into(),
        scope,
        effective_instant: 50,
        owner_observation: 99,
        decision_cut: 100,
        clock_head: locator,
        lifecycle_frontier: d(81),
        corporate_action_frontier: d(82),
        historical_membership_frontier: d(83),
        market_semantics_identity: fixture_market_semantics_identity_v1(),
        source_frontier: d(85),
        correction_frontier: d(86),
        stable_correlation: d(identity.wrapping_add(2)),
    }
}

/// The time evidence the chain market base mints its snapshots under, on the fixture's `clock`:
/// after the base's Instrument Master fact is observable, so a snapshot minted with it binds that fact.
pub(super) fn market_base_pit_time_v1(
    clock: &MarketDataClockAdmission,
) -> UntrustedPitSnapshotTimeEvidence {
    UntrustedPitSnapshotTimeEvidence {
        event_effective: UntrustedEventEffectiveTime::from_untrusted(
            50,
            &clock.clock_identity,
            &clock.clock_epoch,
        ),
        provider_available: UntrustedProviderAvailableTime::from_untrusted(
            90,
            &clock.clock_identity,
            &clock.clock_epoch,
        ),
        retrieval: UntrustedRetrievalTime::from_untrusted(
            92,
            &clock.clock_identity,
            &clock.clock_epoch,
        ),
        correction_publication: Some(UntrustedCorrectionPublicationTime::from_untrusted(
            91,
            &clock.clock_identity,
            &clock.clock_epoch,
        )),
        decision_cut: UntrustedSnapshotDecisionCut::from_untrusted(
            100,
            &clock.clock_identity,
            &clock.clock_epoch,
        ),
        monotonic_sequence: clock.monotonic_sequence,
        restart_continuity_digest: clock.restart_continuity_digest,
        skew_bound: clock.skew_bound,
        uncertainty_bound: clock.uncertainty_bound,
        observed_at: 100,
        valid_through: 160,
    }
}
