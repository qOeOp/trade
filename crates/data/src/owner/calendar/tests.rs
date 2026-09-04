use super::{
    CalendarConsumerV1, CalendarErrorV1, UntrustedCalendarRequestV1,
    authority::{
        CalendarAuthenticatedInputsV1, CalendarFactProposalV1, build_readback, decode_readback,
        prepare_calendar_cut_v1, request_meaning_digest, verify_calendar_readback_v1,
    },
};
use crate::owner::{
    instrument_master::{
        BACKTEST_OWNER_V1, InstrumentClass, InstrumentDecimal, InstrumentMasterFactProposalV1,
        InstrumentMasterScopeV1, InstrumentVenueSourceMapping, UntrustedInstrumentMasterRequestV1,
        authority::{
            build_cut, build_fact, build_readback as build_instrument_readback, build_receipt,
        },
    },
    reference_fact_coordinates::{
        AdmittedReferenceFactSourceV1, ReferenceFactClockV1, ReferenceFactCoordinateClaimV1,
        ReferenceFactEffectiveTimeV1, ReferenceFactFrontierV1, ReferenceFactPitCutV1,
        VerifiedReferenceFactCoordinatesV1,
    },
    shared_time_evidence::build_head_fact,
    source_binding::{
        BindingDigest, MarketDataClockAdmission, MarketDataClockComparisonRule,
        MarketDataClockCutKind,
    },
};
use rstest::rstest;

fn d(value: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([value; 32])
}

fn clock() -> ReferenceFactClockV1 {
    ReferenceFactClockV1 {
        clock_identity: b"clock".to_vec().into_boxed_slice(),
        clock_epoch: b"epoch".to_vec().into_boxed_slice(),
        monotonic_sequence: 7,
        wall_observed: 100,
        decision_cut: 100,
        valid_through: 101,
        head_identity: d(1),
        head_digest: d(2),
        restart_continuity_digest: d(3),
        uncertainty_bound: 1,
        skew_bound: 2,
        comparison_rule: 1,
        epoch_proof_identity: None,
        epoch_proof_digest: None,
    }
}

fn frontier(name: &[u8], value: u8) -> ReferenceFactFrontierV1 {
    ReferenceFactFrontierV1 {
        stream_identity: name.into(),
        cut_identity: d(value),
        sequence: u64::from(value),
        digest: d(value + 1),
    }
}

fn coordinates(predecessor: Option<BindingDigest>) -> VerifiedReferenceFactCoordinatesV1 {
    VerifiedReferenceFactCoordinatesV1::verify(ReferenceFactCoordinateClaimV1 {
        pit: ReferenceFactPitCutV1 {
            snapshot_identity: d(10),
            fact_digest: d(11),
            decision_cut: 100,
            observed_at: 100,
            valid_through: 101,
            clock: clock(),
        },
        replay_start_event_ns: -86_400_000_000_000,
        replay_end_event_ns_exclusive: 172_800_000_000_000,
        source: AdmittedReferenceFactSourceV1 {
            binding_identity: d(12),
            binding_fact_digest: d(13),
            lineage_root: d(14),
            lineage_version: 1,
            admitted: true,
            frontier: frontier(b"source", 15),
        },
        correction: frontier(b"correction", 17),
        time: ReferenceFactEffectiveTimeV1 {
            effective_from_ns: -86_400_000_000_000,
            effective_until_ns: Some(172_800_000_000_000),
            provider_available_ns: 70,
            retrieval_ns: 80,
            correction_publication_ns: 75,
            owner_observation_ns: 100,
            decision_cut: 100,
        },
        fact_clock: clock(),
        predecessor_identity: predecessor,
        stable_correlation: d(20),
    })
    .unwrap()
}

fn instrument_readback(
    calendar: &str,
) -> crate::owner::instrument_master::InstrumentMasterReadbackV1 {
    let admission = MarketDataClockAdmission {
        cut_kind: MarketDataClockCutKind::MarketDataAsOf,
        clock_identity: "12345678901234567890123456789012".into(),
        clock_epoch: "abcdefghijklmnopqrstuvwxyzABCDEF".into(),
        monotonic_sequence: 1,
        wall_observed: 60,
        decision_cut: 60,
        valid_through: 100,
        restart_continuity_digest: d(30),
        uncertainty_bound: 1,
        skew_bound: 2,
        comparison_rule: MarketDataClockComparisonRule::ExclusiveValidThrough,
    };
    let head = build_head_fact(&admission, None).unwrap();
    let fact = build_fact(
        InstrumentMasterFactProposalV1 {
            canonical_identity: "AAPL".into(),
            predecessor_fact_digest: None,
            mappings: vec![InstrumentVenueSourceMapping {
                venue_identity: "XNAS".into(),
                source_identity: "SIP".into(),
                source_instrument: b"AAPL".to_vec(),
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
            calendar_identity: calendar.into(),
            session_identity: "XNYS-REGULAR-V1".into(),
            time_zone_identity: "America/New_York".into(),
            lifecycle_frontier: d(31),
            corporate_action_frontier: d(32),
            historical_membership_frontier: d(33),
            market_semantics_identity: d(34),
            source_frontier: d(35),
            correction_frontier: d(36),
            effective_from: -100,
            effective_until: Some(200),
            provider_available: 50,
            retrieval: 51,
            correction_publication: 52,
            owner_observation: 55,
        },
        &head.handoff,
        None,
    )
    .unwrap();
    let request = UntrustedInstrumentMasterRequestV1 {
        request_identity: d(40),
        request_meaning_digest: d(41),
        consumer_role: BACKTEST_OWNER_V1.into(),
        scope: InstrumentMasterScopeV1::ExactInstrument("AAPL".into()),
        effective_instant: 0,
        owner_observation: 59,
        decision_cut: 60,
        clock_head: head.handoff.locator().clone(),
        lifecycle_frontier: d(31),
        corporate_action_frontier: d(32),
        historical_membership_frontier: d(33),
        market_semantics_identity: d(34),
        source_frontier: d(35),
        correction_frontier: d(36),
        stable_correlation: d(42),
    };
    let cut = build_cut(
        &request,
        vec!["AAPL".into()],
        std::slice::from_ref(&fact),
        fact.clock.clone(),
    )
    .unwrap();
    let receipt = build_receipt(&request, &[fact], &cut, d(43), 1).unwrap();
    build_instrument_readback(&receipt).unwrap()
}

fn request() -> UntrustedCalendarRequestV1 {
    UntrustedCalendarRequestV1::new(
        d(50),
        CalendarConsumerV1::Pit,
        b"XNYS-CALENDAR-V1".to_vec(),
        0,
        2,
        100,
        100,
        b"source-locator".to_vec(),
        b"r0-locator".to_vec(),
        d(20),
    )
}

fn proposals() -> Vec<CalendarFactProposalV1> {
    vec![
        CalendarFactProposalV1 {
            day: 0,
            is_open: false,
            lineage_root: d(60),
            correction_sequence: 1,
            coordinates: coordinates(None),
            r0_coordinate_identity: d(61),
            r0_coordinate_digest: d(62),
        },
        CalendarFactProposalV1 {
            day: 1,
            is_open: true,
            lineage_root: d(63),
            correction_sequence: 1,
            coordinates: coordinates(None),
            r0_coordinate_identity: d(64),
            r0_coordinate_digest: d(65),
        },
    ]
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn replay_prepared_calendar_fixture_v1(
    request_identity: BindingDigest,
    instrument: &crate::owner::instrument_master::InstrumentMasterReadbackV1,
    coordinates: VerifiedReferenceFactCoordinatesV1,
    source_locator_bytes: &[u8],
    r0_locator_bytes: &[u8],
    r0_cut_identity: BindingDigest,
    r0_cut_digest: BindingDigest,
    r0_coordinate_identity: BindingDigest,
    r0_coordinate_digest: BindingDigest,
) -> (
    UntrustedCalendarRequestV1,
    crate::owner::calendar::authority::PreparedCalendarCutV1,
) {
    let claim = coordinates.claim();
    let request = UntrustedCalendarRequestV1::new(
        request_identity,
        CalendarConsumerV1::ReplayV2,
        b"XNYS-CALENDAR-V1".to_vec(),
        0,
        1,
        claim.time.owner_observation_ns,
        claim.time.decision_cut,
        source_locator_bytes.to_vec(),
        r0_locator_bytes.to_vec(),
        claim.stable_correlation,
    );
    let prepared = prepare_calendar_cut_v1(
        &request,
        vec![CalendarFactProposalV1 {
            day: 0,
            is_open: true,
            lineage_root: claim.source.lineage_root,
            correction_sequence: claim.source.lineage_version,
            coordinates,
            r0_coordinate_identity,
            r0_coordinate_digest,
        }],
        CalendarAuthenticatedInputsV1 {
            instrument_master: instrument,
            source_binding_locator_bytes: source_locator_bytes,
            r0_locator_bytes,
            r0_cut_identity,
            r0_cut_digest,
        },
    )
    .unwrap();
    (request, prepared)
}

#[rstest]
fn complete_open_closed_cut_is_canonical_and_roundtrips() {
    let _ = replay_prepared_calendar_fixture_v1(
        d(90),
        &instrument_readback("XNYS-CALENDAR-V1"),
        coordinates(None),
        b"source-locator",
        b"r0-locator",
        d(70),
        d(71),
        d(61),
        d(62),
    );
    let request = request();
    let instrument = instrument_readback("XNYS-CALENDAR-V1");
    let prepared = prepare_calendar_cut_v1(
        &request,
        proposals(),
        CalendarAuthenticatedInputsV1 {
            instrument_master: &instrument,
            source_binding_locator_bytes: b"source-locator",
            r0_locator_bytes: b"r0-locator",
            r0_cut_identity: d(70),
            r0_cut_digest: d(71),
        },
    )
    .unwrap();
    assert_eq!(prepared.facts.len(), 2);
    assert!(!prepared.facts[0].is_open());
    assert!(prepared.facts[1].is_open());
    let readback = build_readback(prepared, d(72), 1).unwrap();
    assert_eq!(readback.receipt_identity(), readback.outbox_identity());
    assert_eq!(
        decode_readback(readback.canonical_bytes()).unwrap(),
        readback
    );
    verify_calendar_readback_v1(&readback).unwrap();
}

#[rstest]
fn request_digest_covers_every_meaning_field_and_range_is_bounded() {
    let baseline = request();
    let expected = request_meaning_digest(&baseline).unwrap();
    let mutations = [
        UntrustedCalendarRequestV1::new(
            d(50),
            CalendarConsumerV1::ReplayV2,
            b"XNYS-CALENDAR-V1".to_vec(),
            0,
            2,
            100,
            100,
            b"source-locator".to_vec(),
            b"r0-locator".to_vec(),
            d(20),
        ),
        UntrustedCalendarRequestV1::new(
            d(50),
            CalendarConsumerV1::Pit,
            b"OTHER".to_vec(),
            0,
            2,
            100,
            100,
            b"source-locator".to_vec(),
            b"r0-locator".to_vec(),
            d(20),
        ),
        UntrustedCalendarRequestV1::new(
            d(50),
            CalendarConsumerV1::Pit,
            b"XNYS-CALENDAR-V1".to_vec(),
            -1,
            2,
            100,
            100,
            b"source-locator".to_vec(),
            b"r0-locator".to_vec(),
            d(20),
        ),
        UntrustedCalendarRequestV1::new(
            d(50),
            CalendarConsumerV1::Pit,
            b"XNYS-CALENDAR-V1".to_vec(),
            0,
            2,
            101,
            100,
            b"source-locator".to_vec(),
            b"r0-locator".to_vec(),
            d(20),
        ),
        UntrustedCalendarRequestV1::new(
            d(50),
            CalendarConsumerV1::Pit,
            b"XNYS-CALENDAR-V1".to_vec(),
            0,
            2,
            100,
            101,
            b"source-locator".to_vec(),
            b"r0-locator".to_vec(),
            d(20),
        ),
        UntrustedCalendarRequestV1::new(
            d(50),
            CalendarConsumerV1::Pit,
            b"XNYS-CALENDAR-V1".to_vec(),
            0,
            2,
            100,
            100,
            b"other-source".to_vec(),
            b"r0-locator".to_vec(),
            d(20),
        ),
        UntrustedCalendarRequestV1::new(
            d(50),
            CalendarConsumerV1::Pit,
            b"XNYS-CALENDAR-V1".to_vec(),
            0,
            2,
            100,
            100,
            b"source-locator".to_vec(),
            b"other-r0".to_vec(),
            d(20),
        ),
        UntrustedCalendarRequestV1::new(
            d(50),
            CalendarConsumerV1::Pit,
            b"XNYS-CALENDAR-V1".to_vec(),
            0,
            2,
            100,
            100,
            b"source-locator".to_vec(),
            b"r0-locator".to_vec(),
            d(21),
        ),
    ];
    for mutation in mutations {
        assert_ne!(mutation.request_meaning_digest(), expected);
    }
    let empty = UntrustedCalendarRequestV1::new(
        d(50),
        CalendarConsumerV1::Pit,
        b"XNYS".to_vec(),
        2,
        2,
        100,
        100,
        b"s".to_vec(),
        b"r".to_vec(),
        d(20),
    );
    assert!(request_meaning_digest(&empty).is_ok());
    let instrument = instrument_readback("XNYS");
    assert!(matches!(
        prepare_calendar_cut_v1(
            &empty,
            vec![],
            CalendarAuthenticatedInputsV1 {
                instrument_master: &instrument,
                source_binding_locator_bytes: b"s",
                r0_locator_bytes: b"r",
                r0_cut_identity: d(1),
                r0_cut_digest: d(2)
            }
        ),
        Err(CalendarErrorV1::InvalidRequest)
    ));
}

#[rstest]
fn missing_duplicate_or_dependency_spliced_days_fail_closed() {
    let request = request();
    let instrument = instrument_readback("XNYS-CALENDAR-V1");
    let auth = || CalendarAuthenticatedInputsV1 {
        instrument_master: &instrument,
        source_binding_locator_bytes: b"source-locator",
        r0_locator_bytes: b"r0-locator",
        r0_cut_identity: d(70),
        r0_cut_digest: d(71),
    };
    assert!(matches!(
        prepare_calendar_cut_v1(&request, vec![proposals().remove(0)], auth()),
        Err(CalendarErrorV1::CoverageGap)
    ));
    let mut duplicate = proposals();
    duplicate[1].day = 0;
    assert!(matches!(
        prepare_calendar_cut_v1(&request, duplicate, auth()),
        Err(CalendarErrorV1::CoverageGap)
    ));
    let wrong_instrument = instrument_readback("OTHER");
    assert!(matches!(
        prepare_calendar_cut_v1(
            &request,
            proposals(),
            CalendarAuthenticatedInputsV1 {
                instrument_master: &wrong_instrument,
                source_binding_locator_bytes: b"source-locator",
                r0_locator_bytes: b"r0-locator",
                r0_cut_identity: d(70),
                r0_cut_digest: d(71)
            }
        ),
        Err(CalendarErrorV1::DependencyMismatch)
    ));
    assert!(matches!(
        prepare_calendar_cut_v1(
            &request,
            proposals(),
            CalendarAuthenticatedInputsV1 {
                instrument_master: &instrument,
                source_binding_locator_bytes: b"wrong",
                r0_locator_bytes: b"r0-locator",
                r0_cut_identity: d(70),
                r0_cut_digest: d(71)
            }
        ),
        Err(CalendarErrorV1::DependencyMismatch)
    ));
}

#[rstest]
fn correction_shape_and_nested_tamper_are_rejected() {
    let request = request();
    let instrument = instrument_readback("XNYS-CALENDAR-V1");
    let mut bad = proposals();
    bad[0].correction_sequence = 2;
    assert!(matches!(
        prepare_calendar_cut_v1(
            &request,
            bad,
            CalendarAuthenticatedInputsV1 {
                instrument_master: &instrument,
                source_binding_locator_bytes: b"source-locator",
                r0_locator_bytes: b"r0-locator",
                r0_cut_identity: d(70),
                r0_cut_digest: d(71)
            }
        ),
        Err(CalendarErrorV1::DependencyMismatch)
    ));
    let prepared = prepare_calendar_cut_v1(
        &request,
        proposals(),
        CalendarAuthenticatedInputsV1 {
            instrument_master: &instrument,
            source_binding_locator_bytes: b"source-locator",
            r0_locator_bytes: b"r0-locator",
            r0_cut_identity: d(70),
            r0_cut_digest: d(71),
        },
    )
    .unwrap();
    let mut readback = build_readback(prepared, d(72), 1).unwrap();
    readback.facts[0].is_open = !readback.facts[0].is_open;
    assert_eq!(
        verify_calendar_readback_v1(&readback),
        Err(CalendarErrorV1::DigestMismatch)
    );
}
