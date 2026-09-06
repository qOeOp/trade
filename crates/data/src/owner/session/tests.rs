use super::*;
use crate::owner::{
    calendar::{CalendarCutV1, CalendarFactV1, CalendarReadbackV1, CalendarReceiptV1},
    reference_fact_catalog::{
        ReferenceFactCatalogEntryV1, ReferenceFactCatalogSourceV1, ReferenceFactCatalogValueV1,
        ReferenceFactLocalBoundaryV1, ReferenceFactLocalResolutionV1,
        UntrustedReferenceFactCatalogProposalV1, derive_reference_fact_business_scope_identity_v1,
        seal_reference_fact_catalog_entry_v1,
    },
    reference_fact_coordinates::{
        AdmittedReferenceFactSourceV1, ReferenceFactClockV1, ReferenceFactCoordinateClaimV1,
        ReferenceFactEffectiveTimeV1, ReferenceFactFrontierV1, ReferenceFactPitCutV1,
        VerifiedReferenceFactCoordinatesV1,
    },
    time_zone,
    time_zone::{
        TimeZoneConsumerV1, TimeZoneFactProposalV1, UntrustedTimeZoneRequestV1,
        VerifiedTimeZoneDependenciesV1,
    },
};
use rstest::rstest;

fn d(value: u8) -> SessionIdentityV1 {
    SessionIdentityV1::from_untrusted_bytes([value; 32])
}
fn clock() -> ReferenceFactClockV1 {
    ReferenceFactClockV1 {
        clock_identity: b"clock".to_vec().into(),
        clock_epoch: b"epoch".to_vec().into(),
        monotonic_sequence: 7,
        wall_observed: 100,
        decision_cut: 100,
        valid_through: 101,
        head_identity: d(1),
        head_digest: d(2),
        restart_continuity_digest: d(3),
        uncertainty_bound: 1,
        skew_bound: 1,
        comparison_rule: 1,
        epoch_proof_identity: None,
        epoch_proof_digest: None,
    }
}
fn frontier(name: &[u8], sequence: u64, value: u8) -> ReferenceFactFrontierV1 {
    ReferenceFactFrontierV1 {
        stream_identity: name.to_vec().into(),
        cut_identity: format!("cut-{value}").into_bytes().into_boxed_slice(),
        sequence,
        digest: d(value + 1),
    }
}
fn coordinates(
    start: i128,
    end: Option<i128>,
    sequence: u64,
    predecessor: Option<SessionIdentityV1>,
) -> VerifiedReferenceFactCoordinatesV1 {
    coordinates_with_sequences(start, end, sequence, sequence, predecessor)
}
fn coordinates_with_sequences(
    start: i128,
    end: Option<i128>,
    lineage_version: u64,
    correction_sequence: u64,
    predecessor: Option<SessionIdentityV1>,
) -> VerifiedReferenceFactCoordinatesV1 {
    VerifiedReferenceFactCoordinatesV1::verify(ReferenceFactCoordinateClaimV1 {
        pit: ReferenceFactPitCutV1 {
            snapshot_identity: d(4),
            fact_digest: d(5),
            decision_cut: 100,
            observed_at: 100,
            valid_through: 101,
            clock: clock(),
        },
        replay_start_event_ns: -20_000_000_000_000,
        replay_end_event_ns_exclusive: 20_000_000_000_000,
        source: AdmittedReferenceFactSourceV1 {
            binding_identity: d(6),
            binding_fact_digest: d(7),
            lineage_root: d(8),
            lineage_version,
            admitted: true,
            frontier: frontier(b"source", lineage_version, 9),
        },
        correction: frontier(b"correction", correction_sequence, 11),
        time: ReferenceFactEffectiveTimeV1 {
            effective_from_ns: start,
            effective_until_ns: end,
            provider_available_ns: 70,
            retrieval_ns: 80,
            correction_publication_ns: 75,
            owner_observation_ns: 90,
            decision_cut: 100,
        },
        fact_clock: clock(),
        predecessor_identity: predecessor,
        stable_correlation: d(13),
    })
    .unwrap()
}
fn tz_proposal(
    start: i128,
    end: Option<i128>,
    sequence: u64,
    catalog_predecessor: Option<SessionIdentityV1>,
    native_predecessor: Option<SessionIdentityV1>,
    offset: i32,
) -> TimeZoneFactProposalV1 {
    let dependencies = VerifiedTimeZoneDependenciesV1::verify(
        coordinates(start, end, sequence, native_predecessor),
        d(15),
        d(16),
    )
    .unwrap();
    crate::owner::time_zone::tests::time_zone_catalog_proposal(
        b"Test/Zone",
        d(14),
        offset,
        sequence,
        catalog_predecessor,
        native_predecessor,
        start,
        end,
        dependencies,
    )
}
fn time_zone(before: i32, after: i32) -> time_zone::TimeZoneReadbackV1 {
    let first = tz_proposal(-10_000_000_000_000, Some(0), 1, None, None, before);
    let first_catalog_identity = first.catalog_entry.identity();
    let first_id = time_zone::authority::issue_fact_v1(&first)
        .unwrap()
        .identity();
    let request = UntrustedTimeZoneRequestV1 {
        request_identity: d(17),
        consumer: TimeZoneConsumerV1::Pit,
        time_zone_identity: b"Test/Zone".to_vec().into(),
        ruleset_identity: d(14),
        window_start_ns: -7_200_000_000_000,
        window_end_ns_exclusive: 7_200_000_000_000,
        owner_observation_ns: 90,
        decision_cut: 100,
        source_binding_locator_bytes: b"source".to_vec().into(),
        r0_locator_bytes: b"r0".to_vec().into(),
        stable_correlation: d(13),
    };
    time_zone::authority::seal_readback_v1(
        time_zone::authority::prepare_resolution_v1(
            request,
            vec![
                first,
                tz_proposal(
                    0,
                    Some(10_000_000_000_000),
                    2,
                    Some(first_catalog_identity),
                    Some(first_id),
                    after,
                ),
            ],
            d(18),
            d(19),
        )
        .unwrap(),
        d(20),
        1,
    )
    .unwrap()
}

fn calendar(open: bool) -> CalendarReadbackV1 {
    let fact = CalendarFactV1 {
        calendar_identity: b"CAL".to_vec().into(),
        day: 0,
        is_open: open,
        catalog_entry_identity: d(39),
        lineage_root: d(21),
        correction_sequence: 1,
        predecessor_identity: None,
        effective_from_ns: 0,
        effective_until_ns: Some(codec::DAY_NS),
        provider_available_ns: 70,
        retrieval_ns: 80,
        correction_publication_ns: 75,
        owner_observation_ns: 90,
        decision_cut: 100,
        r0_coordinate_identity: d(22),
        r0_coordinate_digest: d(23),
        source_binding_identity: d(6),
        source_binding_fact_digest: d(7),
        source_binding_lineage_root: d(8),
        source_binding_lineage_version: 1,
        source_frontier_digest: d(10),
        correction_frontier_digest: d(12),
        canonical_bytes: b"fact".to_vec().into(),
        identity: d(24),
    };
    CalendarReadbackV1 {
        facts: vec![fact].into(),
        cut: CalendarCutV1 {
            request_identity: d(25),
            request_meaning_digest: d(26),
            consumer: crate::owner::calendar::CalendarConsumerV1::Pit,
            calendar_identity: b"CAL".to_vec().into(),
            first_day: 0,
            last_day_exclusive: 1,
            owner_observation_ns: 90,
            decision_cut: 100,
            r0_cut_identity: d(27),
            r0_cut_digest: d(28),
            days: vec![(0, d(24), d(24))].into(),
            gaps: Box::new([]),
            canonical_bytes: b"cut".to_vec().into(),
            identity: d(29),
        },
        receipt: CalendarReceiptV1 {
            request_identity: d(25),
            request_meaning_digest: d(26),
            cut_identity: d(29),
            cut_digest: d(29),
            store_generation_identity: d(30),
            append_sequence: 1,
            stable_correlation: d(13),
            outbox_identity: d(31),
            canonical_bytes: b"receipt".to_vec().into(),
            identity: d(31),
        },
        outbox_identity: d(31),
        canonical_bytes: b"readback".to_vec().into(),
        identity: d(32),
    }
}
fn session_fact(ordinal: u32, open: u64, close: u64) -> SessionFactV1 {
    SessionFactV1 {
        session_identity: b"SESSION".to_vec().into(),
        trading_day: 0,
        interval_ordinal: ordinal,
        local_open: LocalBoundaryV1 {
            day: 0,
            nanos_of_day: open,
            resolution: LocalResolutionV1::Exact,
        },
        local_close: LocalBoundaryV1 {
            day: 0,
            nanos_of_day: close,
            resolution: LocalResolutionV1::Exact,
        },
        catalog_entry_identity: d(39),
        utc_open_ns: i128::from(open),
        utc_close_ns: i128::from(close),
        instrument_master_readback_identity: d(33),
        instrument_master_fact_digest: d(34),
        instrument_master_cut_digest: d(35),
        lineage_root: d(8),
        source_binding_identity: d(6),
        source_binding_fact_digest: d(7),
        source_binding_lineage_root: d(8),
        source_binding_lineage_version: 1,
        source_frontier_digest: d(9),
        correction_frontier_digest: d(11),
        predecessor_identity: None,
        correction_sequence: 1,
        provider_available_ns: 70,
        retrieval_ns: 80,
        correction_publication_ns: 75,
        owner_observation_ns: 90,
        decision_cut: 100,
        r0_coordinate_identity: d(37),
        r0_coordinate_digest: d(38),
        identity: d(40 + u8::try_from(ordinal).unwrap()),
        canonical_bytes: b"fact".to_vec().into(),
    }
}
fn request() -> UntrustedSessionRequestV1 {
    UntrustedSessionRequestV1 {
        request_identity: d(50),
        session_identity: b"SESSION".to_vec().into(),
        first_day: 0,
        last_day_exclusive: 1,
        calendar_cut_locator_bytes: b"calendar".to_vec().into(),
        time_zone_cut_locator_bytes: b"time-zone".to_vec().into(),
        source_binding_locator_bytes: b"source".to_vec().into(),
        r0_locator_bytes: b"r0".to_vec().into(),
        owner_observation_ns: 90,
        decision_cut: 100,
        stable_correlation: d(13),
    }
}

fn session_catalog_entry(
    session_identity: &[u8],
    trading_day: i32,
    interval_ordinal: u32,
    local_open_ns: u64,
    local_close_ns: u64,
    coordinates: &VerifiedReferenceFactCoordinatesV1,
) -> ReferenceFactCatalogEntryV1 {
    let claim = coordinates.claim();
    let value = ReferenceFactCatalogValueV1::Session {
        session_identity: session_identity.to_vec().into(),
        trading_day,
        interval_ordinal,
        local_open: ReferenceFactLocalBoundaryV1 {
            day: trading_day,
            nanos_of_day: local_open_ns,
            resolution: ReferenceFactLocalResolutionV1::Exact,
        },
        local_close: ReferenceFactLocalBoundaryV1 {
            day: trading_day,
            nanos_of_day: local_close_ns,
            resolution: ReferenceFactLocalResolutionV1::Exact,
        },
    };
    seal_reference_fact_catalog_entry_v1(&UntrustedReferenceFactCatalogProposalV1 {
        command_identity: d(70),
        scope_identity: derive_reference_fact_business_scope_identity_v1(&value).unwrap(),
        revision: 1,
        lineage_root: claim.source.lineage_root,
        predecessor_identity: None,
        correction_sequence: 1,
        effective_from_ns: claim.time.effective_from_ns,
        effective_until_ns: claim.time.effective_until_ns,
        source: ReferenceFactCatalogSourceV1 {
            source_binding_identity: claim.source.binding_identity,
            source_binding_fact_digest: claim.source.binding_fact_digest,
            source_binding_lineage_root: claim.source.lineage_root,
            source_binding_lineage_version: claim.source.lineage_version,
            source_frontier_digest: claim.source.frontier.digest,
            correction_frontier_digest: claim.correction.digest,
            admission_identity: d(71),
        },
        value,
        stable_correlation: claim.stable_correlation,
    })
    .unwrap()
}
fn instrument() -> InstrumentMasterReferenceV1 {
    InstrumentMasterReferenceV1 {
        locator_bytes: b"instrument".to_vec().into(),
        readback_identity: d(33),
        fact_digest: d(34),
        cut_digest: d(35),
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn replay_session_fixture_v1(
    request_identity: SessionIdentityV1,
    coordinates: VerifiedReferenceFactCoordinatesV1,
    calendar_locator_bytes: &[u8],
    time_zone_locator_bytes: &[u8],
    source_locator_bytes: &[u8],
    r0_locator_bytes: &[u8],
    r0_coordinate_identity: SessionIdentityV1,
    r0_coordinate_digest: SessionIdentityV1,
) -> (
    UntrustedSessionRequestV1,
    Vec<SessionFactProposalV1>,
    Vec<ReferenceFactCatalogEntryV1>,
) {
    let claim = coordinates.claim();
    let (local_open_ns, local_close_ns) = u64::try_from(claim.replay_start_event_ns)
        .ok()
        .zip(u64::try_from(claim.replay_end_event_ns_exclusive).ok())
        .filter(|(open, close)| open < close && *close < 86_400_000_000_000)
        .unwrap_or((0, 100));
    let request = UntrustedSessionRequestV1 {
        request_identity,
        session_identity: b"XNYS-REGULAR-V1".to_vec().into(),
        first_day: 0,
        last_day_exclusive: 1,
        calendar_cut_locator_bytes: calendar_locator_bytes.to_vec().into(),
        time_zone_cut_locator_bytes: time_zone_locator_bytes.to_vec().into(),
        source_binding_locator_bytes: source_locator_bytes.to_vec().into(),
        r0_locator_bytes: r0_locator_bytes.to_vec().into(),
        owner_observation_ns: claim.time.owner_observation_ns,
        decision_cut: claim.time.decision_cut,
        stable_correlation: claim.stable_correlation,
    };
    let entry = session_catalog_entry(
        b"XNYS-REGULAR-V1",
        0,
        0,
        local_open_ns,
        local_close_ns,
        &coordinates,
    );
    let proposal = SessionFactProposalV1 {
        catalog_locator: entry.locator(),
        native_predecessor_identity: None,
        correction_identity: claim.correction.digest,
        coordinates,
        r0_coordinate_identity,
        r0_coordinate_digest,
    };
    (request, vec![proposal], vec![entry])
}

#[rstest]
fn request_meaning_binds_exact_native_locators_and_instrument_reference() {
    let _ = replay_session_fixture_v1(
        d(90),
        coordinates(-10, Some(200), 1, None),
        b"calendar",
        b"time-zone",
        b"source",
        b"r0",
        d(37),
        d(38),
    );
    let baseline = authority::request_meaning_digest_v1(&request(), &instrument()).unwrap();
    let mut changed = request();
    changed.time_zone_cut_locator_bytes = b"other-time-zone".to_vec().into();
    assert_ne!(
        baseline,
        authority::request_meaning_digest_v1(&changed, &instrument()).unwrap()
    );
    let mut invalid = instrument();
    invalid.cut_digest = d(0);
    assert_eq!(
        authority::request_meaning_digest_v1(&request(), &invalid),
        Err(SessionErrorV1::InvalidDependency)
    );
}

#[rstest]
fn fact_recomputes_utc_and_round_trips_exact_native_evidence() {
    let calendar = calendar(true);
    let time_zone = time_zone(0, 0);
    let deps = SessionDependenciesV1 {
        calendar: &calendar,
        time_zone: &time_zone,
        instrument_master: instrument(),
        calendar_cut_locator_bytes: b"calendar",
        time_zone_cut_locator_bytes: b"time-zone",
        source_binding_locator_bytes: b"source",
        r0_locator_bytes: b"r0",
    };
    let coordinates = coordinates(-10_000_000_000_000, Some(10_000_000_000_000), 1, None);
    let entry = session_catalog_entry(
        b"SESSION",
        0,
        0,
        3_600_000_000_000,
        7_200_000_000_000,
        &coordinates,
    );
    let proposal = SessionFactProposalV1 {
        catalog_locator: entry.locator(),
        native_predecessor_identity: None,
        correction_identity: d(36),
        coordinates,
        r0_coordinate_identity: d(37),
        r0_coordinate_digest: d(38),
    };
    let fact = authority::issue_fact(&request(), &deps, &proposal, &entry).unwrap();
    assert_eq!(fact.utc_open_ns, 3_600_000_000_000);
    assert_eq!(fact.utc_close_ns, 7_200_000_000_000);
    let expected_evidence = fact.evidence();
    let decoded = authority::decode_fact(fact.canonical_bytes()).unwrap();
    assert_eq!(decoded.evidence(), expected_evidence);
    assert_eq!(fact, decoded);
    let mut cross_splice = proposal;
    cross_splice.native_predecessor_identity = Some(d(39));
    assert_eq!(
        authority::issue_fact(&request(), &deps, &cross_splice, &entry),
        Err(SessionErrorV1::InvalidDependency)
    );
}

#[rstest]
fn fact_preserves_independent_source_and_correction_frontiers() {
    let calendar = calendar(true);
    let time_zone = time_zone(0, 0);
    let deps = SessionDependenciesV1 {
        calendar: &calendar,
        time_zone: &time_zone,
        instrument_master: instrument(),
        calendar_cut_locator_bytes: b"calendar",
        time_zone_cut_locator_bytes: b"time-zone",
        source_binding_locator_bytes: b"source",
        r0_locator_bytes: b"r0",
    };
    let mut proposal = replay_session_fixture_v1(
        d(90),
        coordinates_with_sequences(-10_000_000_000_000, Some(10_000_000_000_000), 1, 11, None),
        b"calendar",
        b"time-zone",
        b"source",
        b"r0",
        d(37),
        d(38),
    )
    .1
    .remove(0);
    proposal.correction_identity = d(36);

    let entry = session_catalog_entry(b"SESSION", 0, 0, 0, 100, &proposal.coordinates);
    proposal.catalog_locator = entry.locator();
    assert!(authority::issue_fact(&request(), &deps, &proposal, &entry).is_ok());
}

#[rstest]
fn fold_requires_authenticated_choice_and_gap_never_shifts() {
    let unique = time_zone(0, 0);
    let unique_boundary = LocalBoundaryV1 {
        day: 0,
        nanos_of_day: 1_800_000_000_000,
        resolution: LocalResolutionV1::Exact,
    };
    assert_eq!(
        authority::resolve_boundary(unique_boundary, &unique)
            .unwrap()
            .0,
        1_800_000_000_000
    );
    assert_eq!(
        authority::resolve_boundary(
            LocalBoundaryV1 {
                resolution: LocalResolutionV1::EarlierInstant,
                ..unique_boundary
            },
            &unique
        ),
        Err(SessionErrorV1::AmbiguousBoundary)
    );
    let fold = time_zone(3_600, 0);
    let boundary = |resolution| LocalBoundaryV1 {
        day: 0,
        nanos_of_day: 1_800_000_000_000,
        resolution,
    };
    assert_eq!(
        authority::resolve_boundary(boundary(LocalResolutionV1::Exact), &fold),
        Err(SessionErrorV1::AmbiguousBoundary)
    );
    let earlier = authority::resolve_boundary(boundary(LocalResolutionV1::EarlierInstant), &fold)
        .unwrap()
        .0;
    let later = authority::resolve_boundary(boundary(LocalResolutionV1::LaterInstant), &fold)
        .unwrap()
        .0;
    assert!(earlier < later);
    assert_eq!(
        authority::resolve_boundary(
            boundary(LocalResolutionV1::EarlierInstant),
            &time_zone(0, 3_600)
        ),
        Err(SessionErrorV1::GapBoundary)
    );
}

#[rstest]
fn census_requires_closed_zero_members_and_open_contiguous_ordinals() {
    assert!(
        authority::validate_census(&request(), &calendar(false), &[]).unwrap()[0]
            .intervals
            .is_empty()
    );
    assert_eq!(
        authority::validate_census(&request(), &calendar(false), &[session_fact(0, 0, 1)]),
        Err(SessionErrorV1::IncompleteCensus)
    );
    assert_eq!(
        authority::validate_census(&request(), &calendar(true), &[session_fact(1, 0, 1)]),
        Err(SessionErrorV1::NonCanonicalOrder)
    );
    assert_eq!(
        authority::validate_census(
            &request(),
            &calendar(true),
            &[session_fact(0, 0, 1), session_fact(1, 2, 3)]
        ),
        Err(SessionErrorV1::NonCanonicalOrder)
    );
}

fn empty_prepared() -> PreparedSessionResolutionV1 {
    let request = request();
    let mut bytes = Vec::new();
    codec::header(&mut bytes);
    codec::id(&mut bytes, request.request_identity).unwrap();
    codec::id(&mut bytes, d(51)).unwrap();
    bytes.push(1);
    codec::bytes(
        &mut bytes,
        &request.session_identity,
        codec::MAX_IDENTITY_BYTES,
    )
    .unwrap();
    bytes.extend_from_slice(&0_i32.to_be_bytes());
    bytes.extend_from_slice(&1_i32.to_be_bytes());
    for value in 52..59 {
        codec::id(&mut bytes, d(value)).unwrap();
    }
    bytes.extend_from_slice(&90_i128.to_be_bytes());
    bytes.extend_from_slice(&100_u64.to_be_bytes());
    codec::id(&mut bytes, d(59)).unwrap();
    codec::id(&mut bytes, d(60)).unwrap();
    bytes.extend_from_slice(&1_u32.to_be_bytes());
    bytes.extend_from_slice(&0_i32.to_be_bytes());
    bytes.push(0);
    bytes.extend_from_slice(&0_u32.to_be_bytes());
    bytes.extend_from_slice(&0_u32.to_be_bytes());
    let identity = codec::digest(codec::CUT_DOMAIN, &bytes);
    PreparedSessionResolutionV1 {
        request,
        facts: Box::new([]),
        cut: SessionCutV1 {
            request_identity: d(50),
            request_meaning_digest: d(51),
            days: vec![SessionDayCensusV1 {
                day: 0,
                is_open: false,
                intervals: Box::new([]),
            }]
            .into(),
            fact_identities: Box::new([]),
            instrument_master_readback_identity: d(56),
            instrument_master_fact_digest: d(57),
            instrument_master_cut_digest: d(58),
            identity,
            canonical_bytes: bytes.into(),
        },
    }
}

#[rstest]
fn all_closed_cut_round_trips_with_generation_bound_receipt_outbox() {
    let left = authority::seal_readback_v1(empty_prepared(), d(61), 1).unwrap();
    assert!(left.facts().is_empty());
    assert_eq!(left.receipt.identity, left.outbox_identity);
    assert_eq!(
        left,
        authority::decode_readback_v1(left.canonical_bytes()).unwrap()
    );
    let right = authority::seal_readback_v1(empty_prepared(), d(62), 1).unwrap();
    assert_ne!(left.receipt.identity, right.receipt.identity);
}

#[rstest]
fn corrupt_missing_and_extra_bytes_fail_closed() {
    let readback = authority::seal_readback_v1(empty_prepared(), d(61), 1).unwrap();
    let mut corrupt = readback.canonical_bytes().to_vec();
    *corrupt.last_mut().unwrap() ^= 1;
    assert_eq!(
        authority::decode_readback_v1(&corrupt),
        Err(SessionErrorV1::StoreUntrusted)
    );
    let mut extra = readback.canonical_bytes().to_vec();
    extra.push(0);
    assert_eq!(
        authority::decode_readback_v1(&extra),
        Err(SessionErrorV1::StoreUntrusted)
    );
    assert_eq!(
        authority::decode_readback_v1(
            &readback.canonical_bytes()[..readback.canonical_bytes().len() - 1]
        ),
        Err(SessionErrorV1::StoreUntrusted)
    );
}
