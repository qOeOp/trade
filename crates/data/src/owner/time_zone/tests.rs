use super::*;
use crate::owner::reference_fact_catalog::{
    ReferenceFactCatalogSourceV1, ReferenceFactCatalogValueV1,
    UntrustedReferenceFactCatalogProposalV1, seal_reference_fact_catalog_entry_v1,
};
use crate::owner::reference_fact_coordinates::{
    AdmittedReferenceFactSourceV1, ReferenceFactClockV1, ReferenceFactCoordinateClaimV1,
    ReferenceFactEffectiveTimeV1, ReferenceFactFrontierV1, ReferenceFactPitCutV1,
    VerifiedReferenceFactCoordinatesV1,
};
use rstest::rstest;

fn d(value: u8) -> TimeZoneIdentity {
    TimeZoneIdentity::from_untrusted_bytes([value; 32])
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
fn dependencies(
    start: i128,
    end: Option<i128>,
    sequence: u64,
    predecessor: Option<TimeZoneIdentity>,
) -> VerifiedTimeZoneDependenciesV1 {
    dependencies_with_sequences(start, end, sequence, sequence, predecessor)
}
fn dependencies_with_sequences(
    start: i128,
    end: Option<i128>,
    lineage_version: u64,
    correction_sequence: u64,
    predecessor: Option<TimeZoneIdentity>,
) -> VerifiedTimeZoneDependenciesV1 {
    let claim = ReferenceFactCoordinateClaimV1 {
        pit: ReferenceFactPitCutV1 {
            snapshot_identity: d(4),
            fact_digest: d(5),
            decision_cut: 100,
            observed_at: 100,
            valid_through: 101,
            clock: clock(),
        },
        replay_start_event_ns: 10,
        replay_end_event_ns_exclusive: 20,
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
    };
    VerifiedTimeZoneDependenciesV1::verify(
        VerifiedReferenceFactCoordinatesV1::verify(claim).unwrap(),
        d(22),
        d(23),
    )
    .unwrap()
}

#[rstest]
fn fact_preserves_independent_source_and_correction_frontiers() {
    let deps = dependencies_with_sequences(5, Some(25), 1, 11, None);
    let proposal =
        time_zone_catalog_proposal(b"Asia/Tokyo", d(14), 32_400, 1, None, 5, Some(25), deps);

    assert!(authority::issue_fact_v1(proposal).is_ok());
}
fn proposal(
    start: i128,
    end: Option<i128>,
    sequence: u64,
    predecessor: Option<TimeZoneIdentity>,
    offset: i32,
) -> TimeZoneFactProposalV1 {
    let dependencies = dependencies(start, end, sequence, predecessor);
    time_zone_catalog_proposal(
        b"Asia/Tokyo",
        d(14),
        offset,
        sequence,
        predecessor,
        start,
        end,
        dependencies,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn time_zone_catalog_proposal(
    time_zone_identity: &[u8],
    ruleset_identity: TimeZoneIdentity,
    utc_offset_seconds: i32,
    correction_sequence: u64,
    predecessor_identity: Option<TimeZoneIdentity>,
    effective_from_ns: i128,
    effective_until_ns: Option<i128>,
    dependencies: VerifiedTimeZoneDependenciesV1,
) -> TimeZoneFactProposalV1 {
    let claim = dependencies.coordinates().claim();
    let catalog_entry =
        seal_reference_fact_catalog_entry_v1(&UntrustedReferenceFactCatalogProposalV1 {
            command_identity: d(30_u8.wrapping_add(correction_sequence as u8)),
            scope_identity: ruleset_identity,
            revision: correction_sequence,
            lineage_root: claim.source.lineage_root,
            predecessor_identity,
            correction_sequence,
            effective_from_ns,
            effective_until_ns,
            source: ReferenceFactCatalogSourceV1 {
                source_binding_identity: claim.source.binding_identity,
                source_binding_fact_digest: claim.source.binding_fact_digest,
                source_binding_lineage_root: claim.source.lineage_root,
                source_binding_lineage_version: claim.source.lineage_version,
                source_frontier_digest: claim.source.frontier.digest,
                correction_frontier_digest: claim.correction.digest,
                admission_identity: d(29),
            },
            value: ReferenceFactCatalogValueV1::TimeZone {
                time_zone_identity: time_zone_identity.to_vec().into(),
                ruleset_identity,
                utc_offset_seconds,
            },
            stable_correlation: claim.stable_correlation,
        })
        .unwrap();
    TimeZoneFactProposalV1 {
        catalog_entry,
        dependencies,
    }
}
fn request() -> UntrustedTimeZoneRequestV1 {
    UntrustedTimeZoneRequestV1 {
        request_identity: d(15),
        consumer: TimeZoneConsumerV1::ReplayV2,
        time_zone_identity: b"Asia/Tokyo".to_vec().into(),
        ruleset_identity: d(14),
        window_start_ns: 10,
        window_end_ns_exclusive: 20,
        owner_observation_ns: 90,
        decision_cut: 100,
        source_binding_locator_bytes: b"source-locator".to_vec().into(),
        r0_locator_bytes: b"r0-locator".to_vec().into(),
        stable_correlation: d(13),
    }
}
fn proposals() -> Vec<TimeZoneFactProposalV1> {
    let first = proposal(5, Some(15), 1, None, 32_400);
    let first_id = authority::issue_fact_v1(first.clone()).unwrap().identity();
    vec![first, proposal(15, Some(25), 2, Some(first_id), 36_000)]
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn replay_time_zone_fixture_v1(
    request_identity: TimeZoneIdentity,
    coordinates: VerifiedReferenceFactCoordinatesV1,
    source_locator_bytes: &[u8],
    r0_locator_bytes: &[u8],
    r0_coordinate_identity: TimeZoneIdentity,
    r0_coordinate_digest: TimeZoneIdentity,
) -> (UntrustedTimeZoneRequestV1, Vec<TimeZoneFactProposalV1>) {
    let claim = coordinates.claim();
    let ruleset_identity = d(214);
    let request = UntrustedTimeZoneRequestV1 {
        request_identity,
        consumer: TimeZoneConsumerV1::ReplayV2,
        time_zone_identity: b"Etc/UTC".to_vec().into(),
        ruleset_identity,
        window_start_ns: claim.replay_start_event_ns,
        window_end_ns_exclusive: claim.replay_end_event_ns_exclusive,
        owner_observation_ns: claim.time.owner_observation_ns,
        decision_cut: claim.time.decision_cut,
        source_binding_locator_bytes: source_locator_bytes.to_vec().into(),
        r0_locator_bytes: r0_locator_bytes.to_vec().into(),
        stable_correlation: claim.stable_correlation,
    };
    let dependencies = VerifiedTimeZoneDependenciesV1::verify(
        coordinates.clone(),
        r0_coordinate_identity,
        r0_coordinate_digest,
    )
    .unwrap();
    let proposal = time_zone_catalog_proposal(
        b"Etc/UTC",
        ruleset_identity,
        0,
        claim.source.lineage_version,
        None,
        claim.replay_start_event_ns,
        Some(claim.replay_end_event_ns_exclusive.saturating_add(1)),
        dependencies,
    );
    (request, vec![proposal])
}

#[rstest]
fn complete_transition_cut_round_trips_and_receipt_equals_outbox() {
    let _ = replay_time_zone_fixture_v1(
        d(90),
        dependencies(10, Some(20), 1, None).coordinates().clone(),
        b"source-locator",
        b"r0-locator",
        d(22),
        d(23),
    );
    let prepared = authority::prepare_resolution_v1(request(), proposals(), d(16), d(17)).unwrap();
    let readback = authority::seal_readback_v1(prepared, d(18), 1).unwrap();
    assert_eq!(readback.receipt().identity(), readback.outbox_identity());
    assert_eq!(
        readback,
        authority::decode_readback_v1(readback.canonical_bytes()).unwrap()
    );
    assert_eq!(readback.facts()[0].utc_offset_seconds(), 32_400);
    assert_eq!(readback.facts()[1].utc_offset_seconds(), 36_000);
}

#[rstest]
fn receipt_is_generation_bound() {
    let left = authority::seal_readback_v1(
        authority::prepare_resolution_v1(request(), proposals(), d(16), d(17)).unwrap(),
        d(18),
        1,
    )
    .unwrap();
    let right = authority::seal_readback_v1(
        authority::prepare_resolution_v1(request(), proposals(), d(16), d(17)).unwrap(),
        d(19),
        1,
    )
    .unwrap();
    assert_ne!(left.receipt().identity(), right.receipt().identity());
    assert_eq!(right.receipt().identity(), right.outbox_identity());
}

#[rstest]
fn rejects_gap_overlap_bad_predecessor_and_incomplete_window() {
    let first = proposal(5, Some(14), 1, None, 0);
    let first_id = authority::issue_fact_v1(first.clone()).unwrap().identity();
    assert_eq!(
        authority::prepare_resolution_v1(
            request(),
            vec![first, proposal(15, Some(25), 2, Some(first_id), 1)],
            d(16),
            d(17)
        ),
        Err(TimeZoneErrorV1::NonCanonicalOrder)
    );
    let first = proposal(5, Some(16), 1, None, 0);
    let first_id = authority::issue_fact_v1(first.clone()).unwrap().identity();
    assert_eq!(
        authority::prepare_resolution_v1(
            request(),
            vec![first, proposal(15, Some(25), 2, Some(first_id), 1)],
            d(16),
            d(17)
        ),
        Err(TimeZoneErrorV1::NonCanonicalOrder)
    );
    let broken = vec![
        proposal(5, Some(15), 1, None, 0),
        proposal(15, Some(25), 2, Some(d(20)), 1),
    ];
    assert_eq!(
        authority::prepare_resolution_v1(request(), broken, d(16), d(17)),
        Err(TimeZoneErrorV1::NonCanonicalOrder)
    );
    assert_eq!(
        authority::prepare_resolution_v1(
            request(),
            vec![proposal(11, Some(25), 1, None, 0)],
            d(16),
            d(17)
        ),
        Err(TimeZoneErrorV1::IncompleteCoverage)
    );
}

#[rstest]
fn rejects_cross_splice_zero_and_corrupt_aggregate() {
    let coordinates = VerifiedReferenceFactCoordinatesV1::verify({
        let mut claim = dependencies(5, Some(25), 1, None)
            .coordinates()
            .claim()
            .clone();
        claim.predecessor_identity = None;
        claim
    })
    .unwrap();
    assert_eq!(
        VerifiedTimeZoneDependenciesV1::verify(coordinates, d(0), d(23)),
        Err(TimeZoneErrorV1::InvalidDependency)
    );
    let mut wrong_ruleset = proposals();
    let first_id = authority::issue_fact_v1(wrong_ruleset[0].clone())
        .unwrap()
        .identity();
    wrong_ruleset[1] = time_zone_catalog_proposal(
        b"Asia/Tokyo",
        d(21),
        36_000,
        2,
        Some(first_id),
        15,
        Some(25),
        wrong_ruleset[1].dependencies.clone(),
    );
    assert_eq!(
        authority::prepare_resolution_v1(request(), wrong_ruleset, d(16), d(17)),
        Err(TimeZoneErrorV1::InvalidDependency)
    );
    let mut zero_request = request();
    zero_request.request_identity = d(0);
    assert_eq!(
        authority::prepare_resolution_v1(zero_request, proposals(), d(16), d(17)),
        Err(TimeZoneErrorV1::InvalidRequest)
    );
    let prepared = authority::prepare_resolution_v1(request(), proposals(), d(16), d(17)).unwrap();
    assert_eq!(
        authority::seal_readback_v1(prepared, d(0), 1),
        Err(TimeZoneErrorV1::StoreUntrusted)
    );
    let readback = authority::seal_readback_v1(
        authority::prepare_resolution_v1(request(), proposals(), d(16), d(17)).unwrap(),
        d(18),
        1,
    )
    .unwrap();
    let mut corrupt = readback.canonical_bytes().to_vec();
    *corrupt.last_mut().unwrap() ^= 1;
    assert_eq!(
        authority::decode_readback_v1(&corrupt),
        Err(TimeZoneErrorV1::StoreUntrusted)
    );
}

#[rstest]
fn rejects_unknown_tags_trailing_bytes_capacity_and_changed_meaning() {
    let prepared = authority::prepare_resolution_v1(request(), proposals(), d(16), d(17)).unwrap();
    let readback = authority::seal_readback_v1(prepared, d(18), 1).unwrap();
    let mut trailing = readback.canonical_bytes().to_vec();
    trailing.push(0);
    assert_eq!(
        authority::decode_readback_v1(&trailing),
        Err(TimeZoneErrorV1::StoreUntrusted)
    );
    let mut changed = request();
    changed.window_end_ns_exclusive = 19;
    assert_ne!(
        authority::request_meaning_digest_v1(&request()).unwrap(),
        authority::request_meaning_digest_v1(&changed).unwrap()
    );
    let mut oversized = request();
    oversized.r0_locator_bytes = vec![1; codec::MAX_LOCATOR_BYTES + 1].into();
    assert_eq!(
        authority::request_meaning_digest_v1(&oversized),
        Err(TimeZoneErrorV1::InvalidRequest)
    );
}
