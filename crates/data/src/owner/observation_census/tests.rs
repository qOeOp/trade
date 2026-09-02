use super::*;
use crate::owner::{
    pit_snapshot::{
        UntrustedCorrectionPublicationTime, UntrustedEventEffectiveTime,
        UntrustedPitSnapshotLocatorFields, UntrustedPitSnapshotTimeEvidence,
        UntrustedProviderAvailableTime, UntrustedRetrievalTime, UntrustedSnapshotDecisionCut,
    },
    source_binding::UntrustedCompleteFrontier,
    strategy_input_joined_cut::{
        StrategyInputJoinRoleClaimV1, derive_strategy_input_join_identity_v2,
    },
};

fn digest(byte: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([byte; 32])
}
fn request(trigger: u64) -> UntrustedObservationCensusRequestV1 {
    let roles = vec![
        StrategyInputJoinRoleClaimV1 {
            semantic_id: "OPEN".into(),
            input_role_identity: digest(21),
        },
        StrategyInputJoinRoleClaimV1 {
            semantic_id: "CLOSE".into(),
            input_role_identity: digest(22),
        },
    ];
    let inputs = roles
        .iter()
        .map(|role| role.semantic_id.clone())
        .collect::<Vec<_>>();
    let join = derive_strategy_input_join_identity_v2(
        "PAIR",
        &inputs,
        "strategy.input-join.latest-not-after-trigger.v1",
        "CLOSE",
        100,
    );
    let frontier = UntrustedCompleteFrontier {
        stream_identity: "frontier".into(),
        cut_identity: "cut".into(),
        sequence: 1,
        digest: digest(9),
    };
    let time = UntrustedPitSnapshotTimeEvidence {
        event_effective: UntrustedEventEffectiveTime::from_untrusted(1, "clock", "epoch"),
        provider_available: UntrustedProviderAvailableTime::from_untrusted(2, "clock", "epoch"),
        retrieval: UntrustedRetrievalTime::from_untrusted(3, "clock", "epoch"),
        correction_publication: Some(UntrustedCorrectionPublicationTime::from_untrusted(
            4, "clock", "epoch",
        )),
        decision_cut: UntrustedSnapshotDecisionCut::from_untrusted(7, "clock", "epoch"),
        monotonic_sequence: 1,
        restart_continuity_digest: digest(8),
        skew_bound: 1,
        uncertainty_bound: 0,
        observed_at: 5,
        valid_through: 8,
    };
    let pit = UntrustedPitSnapshotLocator::from_untrusted(UntrustedPitSnapshotLocatorFields {
        owner: "MARKET_DATA".into(),
        request_identity: digest(2),
        request_digest: digest(3),
        correlation_identity: digest(4),
        requester_identity: digest(5),
        scope_digest: digest(6),
        snapshot_identity: digest(7),
        fact_digest: digest(8),
        source_binding_identity: digest(9),
        source_binding_lineage_root: digest(10),
        source_binding_lineage_version: 1,
        lineage_root: digest(11),
        lineage_version: 1,
        predecessor_snapshot_identity: None,
        predecessor_fact_digest: None,
        source_frontier: frontier.clone(),
        correction_frontier: frontier,
        time_evidence: time,
    });
    UntrustedObservationCensusRequestV1::new(
        digest(1),
        pit,
        UntrustedStrategyInputJoinClaimV1 {
            strategy_design_identity: digest(20),
            join_semantic_id: "PAIR".into(),
            join_identity: join,
            alignment_semantic_id: "strategy.input-join.latest-not-after-trigger.v1".into(),
            trigger_input_id: "CLOSE".into(),
            max_staleness_ns: 100,
            roles,
        },
        trigger,
        digest(30),
    )
}

#[test]
fn positive_census_core_is_default_build_reachable_and_rejects_cross_pit_frames() {
    let (open_binding, open_frame, _, _) =
        crate::owner::sample_fact::tests::point_event_projection_fixture_variant_v2(
            10,
            1,
            30,
            digest(21),
        );
    let (close_binding, close_frame, _, _) =
        crate::owner::sample_fact::tests::point_event_projection_fixture_variant_v2(
            10,
            1,
            30,
            digest(22),
        );
    let mut request = request(close_frame.trigger().lifecycle().logical_time());
    request.join_claim.strategy_design_identity = open_binding.locator().strategy_design_identity();
    request.pit_locator.snapshot_identity = close_frame.trigger().snapshot_identity();
    request.pit_locator.fact_digest = close_frame.trigger().snapshot_fact_digest();
    request.request_meaning_digest = authority::request_meaning_digest(&request).unwrap();
    let (census, joined) = authority::issue_observation_census_and_joined_cut_v1(
        &request,
        &[open_binding.clone(), close_binding.clone()],
        vec![open_frame.clone(), close_frame],
    )
    .unwrap();
    assert!(verify_observation_census_readback_v1(&census));
    assert!(verify_strategy_input_joined_cut_readback_v1(&joined));

    let (_, foreign_frame, _, _) =
        crate::owner::sample_fact::tests::point_event_projection_fixture_variant_v2(
            10,
            1,
            31,
            digest(22),
        );
    assert_eq!(
        authority::issue_observation_census_and_joined_cut_v1(
            &request,
            &[open_binding, close_binding],
            vec![open_frame, foreign_frame],
        ),
        Err(ObservationCensusErrorV1::IncompleteCensus)
    );
}

#[test]
fn same_id_with_changed_join_meaning_has_distinct_recovery_meaning() {
    assert_eq!(
        request(10).request_identity(),
        request(11).request_identity()
    );
    assert_ne!(
        request(10).request_meaning_digest(),
        request(11).request_meaning_digest()
    );
    assert_eq!(
        request(10).locator().request_meaning_digest(),
        request(10).request_meaning_digest()
    );
}

#[test]
fn checked_request_codec_rejects_oversized_role_text() {
    let mut value = request(10);
    value.join_claim.roles[0].semantic_id = "x".repeat(codec::MAX_JOIN_TEXT_BYTES + 1);
    assert_eq!(
        authority::request_meaning_digest(&value),
        Err(ObservationCensusErrorV1::CapacityExceeded)
    );
}

#[test]
fn full_request_codec_round_trips_and_every_meaning_field_is_bound() {
    let expected = request(10);
    let bytes = authority::encode_observation_census_request_v1(&expected).unwrap();
    assert_eq!(
        authority::decode_observation_census_request_v1(&bytes).unwrap(),
        expected
    );

    macro_rules! changed {
        ($mutation:expr) => {{
            let mut candidate = expected.clone();
            $mutation(&mut candidate);
            candidate.request_meaning_digest =
                authority::request_meaning_digest(&candidate).unwrap();
            assert_ne!(
                candidate.request_meaning_digest(),
                expected.request_meaning_digest()
            );
        }};
    }

    changed!(|value: &mut UntrustedObservationCensusRequestV1| value.pit_locator.owner.push('2'));
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .request_identity = digest(40));
    changed!(
        |value: &mut UntrustedObservationCensusRequestV1| value.pit_locator.request_digest =
            digest(40)
    );
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .correlation_identity =
        digest(40));
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .requester_identity =
        digest(40));
    changed!(
        |value: &mut UntrustedObservationCensusRequestV1| value.pit_locator.scope_digest =
            digest(40)
    );
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .snapshot_identity = digest(40));
    changed!(
        |value: &mut UntrustedObservationCensusRequestV1| value.pit_locator.fact_digest =
            digest(40)
    );
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .source_binding_identity =
        digest(40));
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .source_binding_lineage_root =
        digest(40));
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .source_binding_lineage_version +=
        1);
    changed!(
        |value: &mut UntrustedObservationCensusRequestV1| value.pit_locator.lineage_root =
            digest(40)
    );
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .lineage_version += 1);
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .predecessor_snapshot_identity =
        Some(digest(40)));
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .predecessor_fact_digest =
        Some(digest(40)));
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .source_frontier
        .stream_identity
        .push('2'));
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .source_frontier
        .cut_identity
        .push('2'));
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .source_frontier
        .sequence += 1);
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .source_frontier
        .digest = digest(40));
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .correction_frontier
        .stream_identity
        .push('2'));
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .correction_frontier
        .cut_identity
        .push('2'));
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .correction_frontier
        .sequence += 1);
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .correction_frontier
        .digest = digest(40));
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .time_evidence
        .event_effective
        .value += 1);
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .time_evidence
        .event_effective
        .clock_identity
        .push('2'));
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .time_evidence
        .event_effective
        .clock_epoch
        .push('2'));
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .time_evidence
        .provider_available
        .value += 1);
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .time_evidence
        .retrieval
        .value += 1);
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .time_evidence
        .correction_publication = None);
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .time_evidence
        .decision_cut
        .value += 1);
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .time_evidence
        .monotonic_sequence += 1);
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .time_evidence
        .restart_continuity_digest =
        digest(40));
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .time_evidence
        .skew_bound += 1);
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .time_evidence
        .uncertainty_bound += 1);
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .time_evidence
        .observed_at += 1);
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .pit_locator
        .time_evidence
        .valid_through += 1);
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .join_claim
        .strategy_design_identity =
        digest(40));
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .join_claim
        .join_semantic_id
        .push('2'));
    changed!(
        |value: &mut UntrustedObservationCensusRequestV1| value.join_claim.join_identity =
            digest(40)
    );
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .join_claim
        .alignment_semantic_id
        .push('2'));
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .join_claim
        .trigger_input_id
        .push('2'));
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value
        .join_claim
        .max_staleness_ns += 1);
    changed!(
        |value: &mut UntrustedObservationCensusRequestV1| value.join_claim.roles[0]
            .semantic_id
            .push('2')
    );
    changed!(
        |value: &mut UntrustedObservationCensusRequestV1| value.join_claim.roles[0]
            .input_role_identity = digest(40)
    );
    changed!(|value: &mut UntrustedObservationCensusRequestV1| value.trigger_logical_time += 1);
    changed!(
        |value: &mut UntrustedObservationCensusRequestV1| value.stable_correlation = digest(40)
    );
}

#[test]
fn request_codec_rejects_corruption_version_trailing_and_capacity() {
    let mut corrupted = authority::encode_observation_census_request_v1(&request(10))
        .unwrap()
        .into_vec();
    corrupted[70] ^= 1;
    assert_eq!(
        authority::decode_observation_census_request_v1(&corrupted),
        Err(ObservationCensusErrorV1::DigestMismatch)
    );
    let mut wrong_version = authority::encode_observation_census_request_v1(&request(10))
        .unwrap()
        .into_vec();
    wrong_version[1] = 2;
    assert_eq!(
        authority::decode_observation_census_request_v1(&wrong_version),
        Err(ObservationCensusErrorV1::CodecMismatch)
    );
    let mut trailing = authority::encode_observation_census_request_v1(&request(10))
        .unwrap()
        .into_vec();
    trailing.push(0);
    assert_eq!(
        authority::decode_observation_census_request_v1(&trailing),
        Err(ObservationCensusErrorV1::CodecMismatch)
    );
    assert_eq!(
        authority::decode_observation_census_request_v1(&vec![0; codec::MAX_REQUEST_BYTES + 1]),
        Err(ObservationCensusErrorV1::CapacityExceeded)
    );
}

fn census_readback() -> ObservationCensusReadbackV1 {
    let mut entry_encoder = codec::Encoder::default();
    entry_encoder.u16(codec::VERSION);
    entry_encoder.digest(digest(21));
    entry_encoder.u64(10);
    entry_encoder.u64(9);
    entry_encoder.u64(7);
    entry_encoder.raw(&[4; 16]);
    entry_encoder.digest(digest(31));
    entry_encoder.digest(digest(32));
    let entry_bytes = entry_encoder.finish().unwrap().into_boxed_slice();
    let entry = ObservationCensusEntryV1 {
        input_role_identity: digest(21),
        logical_time: 10,
        event_time: 9,
        owner_sequence: 7,
        event_identity: [4; 16],
        trigger_digest: digest(31),
        value_digest: digest(32),
        identity: codec::digest(codec::ENTRY_DOMAIN, &entry_bytes),
        canonical_bytes: entry_bytes,
    };
    let mut record_encoder = codec::Encoder::default();
    record_encoder.u16(codec::VERSION);
    record_encoder.digest(digest(1));
    record_encoder.digest(digest(2));
    record_encoder.digest(digest(3));
    record_encoder.digest(digest(4));
    record_encoder.digest(digest(5));
    record_encoder.u64(10);
    record_encoder.u32(1);
    record_encoder.digest(entry.identity());
    let record_bytes = record_encoder.finish().unwrap().into_boxed_slice();
    let record_identity = codec::digest(codec::CENSUS_DOMAIN, &record_bytes);
    let record = ObservationCensusRecordV1 {
        request_identity: digest(1),
        request_meaning_digest: digest(2),
        pit_snapshot_identity: digest(3),
        pit_fact_digest: digest(4),
        join_identity: digest(5),
        trigger_logical_time: 10,
        entries: vec![entry].into_boxed_slice(),
        identity: record_identity,
        canonical_bytes: record_bytes,
    };
    let mut receipt_encoder = codec::Encoder::default();
    receipt_encoder.u16(codec::VERSION);
    receipt_encoder.digest(digest(1));
    receipt_encoder.digest(digest(2));
    receipt_encoder.digest(record_identity);
    receipt_encoder.digest(digest(30));
    let receipt_bytes = receipt_encoder.finish().unwrap().into_boxed_slice();
    let receipt = ObservationCensusReceiptV1 {
        request_identity: digest(1),
        request_meaning_digest: digest(2),
        census_identity: record_identity,
        stable_correlation: digest(30),
        identity: codec::digest(codec::RECEIPT_DOMAIN, &receipt_bytes),
        canonical_bytes: receipt_bytes,
    };
    ObservationCensusReadbackV1 { record, receipt }
}

#[test]
fn complete_storage_codec_round_trips_move_only_readback() {
    let expected = census_readback();
    let bytes = authority::encode_observation_census_storage_v1(&expected).unwrap();
    let actual = authority::decode_observation_census_storage_v1(&bytes).unwrap();
    assert_eq!(actual, expected);
    assert!(verify_observation_census_readback_v1(&actual));
}

#[test]
fn storage_codec_rejects_corruption_and_trailing_bytes() {
    let mut corrupted = authority::encode_observation_census_storage_v1(&census_readback())
        .unwrap()
        .into_vec();
    corrupted[40] ^= 1;
    assert_eq!(
        authority::decode_observation_census_storage_v1(&corrupted),
        Err(ObservationCensusErrorV1::DigestMismatch)
    );
    let mut trailing = authority::encode_observation_census_storage_v1(&census_readback())
        .unwrap()
        .into_vec();
    trailing.push(0);
    assert_eq!(
        authority::decode_observation_census_storage_v1(&trailing),
        Err(ObservationCensusErrorV1::DigestMismatch)
    );
}

#[test]
fn verifier_rejects_scalar_bytes_cross_splice() {
    let mut readback = census_readback();
    readback.record.entries[0].logical_time += 1;
    assert!(!verify_observation_census_readback_v1(&readback));
}
