use super::*;

type CoordinateMutation = Box<dyn Fn(&mut ReferenceFactCoordinateClaimV1)>;

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
        restart_continuity_digest: d(14),
        uncertainty_bound: 1,
        skew_bound: 2,
        comparison_rule: 1,
        epoch_proof_identity: None,
        epoch_proof_digest: None,
    }
}

fn frontier(stream: &[u8], value: u8) -> ReferenceFactFrontierV1 {
    ReferenceFactFrontierV1 {
        stream_identity: stream.to_vec().into_boxed_slice(),
        cut_identity: d(value),
        sequence: u64::from(value),
        digest: d(value + 1),
    }
}

fn coordinate_claim() -> ReferenceFactCoordinateClaimV1 {
    ReferenceFactCoordinateClaimV1 {
        pit: ReferenceFactPitCutV1 {
            snapshot_identity: d(3),
            fact_digest: d(4),
            decision_cut: 100,
            observed_at: 100,
            valid_through: 101,
            clock: clock(),
        },
        replay_start_event_ns: 10,
        replay_end_event_ns_exclusive: 20,
        source: AdmittedReferenceFactSourceV1 {
            binding_identity: d(5),
            binding_fact_digest: d(6),
            lineage_root: d(7),
            lineage_version: 1,
            admitted: true,
            frontier: frontier(b"source", 8),
        },
        correction: frontier(b"correction", 10),
        time: ReferenceFactEffectiveTimeV1 {
            effective_from_ns: 5,
            effective_until_ns: Some(25),
            provider_available_ns: 70,
            retrieval_ns: 80,
            correction_publication_ns: 75,
            owner_observation_ns: 90,
            decision_cut: 100,
        },
        fact_clock: clock(),
        predecessor_identity: Some(d(12)),
        stable_correlation: d(13),
    }
}

#[test]
fn verifies_complete_comparable_coordinates() {
    let verified = VerifiedReferenceFactCoordinatesV1::verify(coordinate_claim()).unwrap();
    assert_eq!(verified.claim().pit.snapshot_identity, d(3));
}

#[test]
fn rejects_zero_and_empty_coordinate_fields() {
    let cases: Vec<CoordinateMutation> = vec![
        Box::new(|claim| claim.pit.snapshot_identity = d(0)),
        Box::new(|claim| claim.pit.fact_digest = d(0)),
        Box::new(|claim| claim.pit.decision_cut = 0),
        Box::new(|claim| claim.pit.clock.clock_identity = Box::new([])),
        Box::new(|claim| claim.pit.clock.restart_continuity_digest = d(0)),
        Box::new(|claim| claim.source.binding_identity = d(0)),
        Box::new(|claim| claim.source.lineage_version = 0),
        Box::new(|claim| claim.source.frontier.stream_identity = Box::new([])),
        Box::new(|claim| claim.correction.sequence = 0),
        Box::new(|claim| claim.time.provider_available_ns = 0),
        Box::new(|claim| claim.stable_correlation = d(0)),
        Box::new(|claim| claim.predecessor_identity = Some(d(0))),
    ];
    for mutate in cases {
        let mut claim = coordinate_claim();
        mutate(&mut claim);
        assert!(VerifiedReferenceFactCoordinatesV1::verify(claim).is_err());
    }
}

#[test]
fn rejects_unadmitted_source_and_bad_frontiers() {
    let mut unavailable = coordinate_claim();
    unavailable.source.admitted = false;
    assert_eq!(
        VerifiedReferenceFactCoordinatesV1::verify(unavailable),
        Err(ReferenceFactCoordinateErrorV1::SourceUnavailable)
    );

    let mut source = coordinate_claim();
    source.source.frontier.digest = d(0);
    assert_eq!(
        VerifiedReferenceFactCoordinatesV1::verify(source),
        Err(ReferenceFactCoordinateErrorV1::InvalidSourceFrontier)
    );

    let mut correction = coordinate_claim();
    correction.correction.cut_identity = d(0);
    assert_eq!(
        VerifiedReferenceFactCoordinatesV1::verify(correction),
        Err(ReferenceFactCoordinateErrorV1::InvalidCorrectionFrontier)
    );
}

#[test]
fn rejects_invalid_intervals_gaps_and_ordering() {
    let mut replay = coordinate_claim();
    replay.replay_end_event_ns_exclusive = replay.replay_start_event_ns;
    assert_eq!(
        VerifiedReferenceFactCoordinatesV1::verify(replay),
        Err(ReferenceFactCoordinateErrorV1::InvalidReplayInterval)
    );

    for mutate in [
        |claim: &mut ReferenceFactCoordinateClaimV1| {
            claim.time.effective_until_ns = Some(claim.time.effective_from_ns);
        },
        |claim: &mut ReferenceFactCoordinateClaimV1| {
            claim.time.effective_from_ns = claim.replay_end_event_ns_exclusive;
        },
        |claim: &mut ReferenceFactCoordinateClaimV1| {
            claim.time.effective_until_ns = Some(claim.replay_start_event_ns);
        },
    ] {
        let mut claim = coordinate_claim();
        mutate(&mut claim);
        assert_eq!(
            VerifiedReferenceFactCoordinatesV1::verify(claim),
            Err(ReferenceFactCoordinateErrorV1::InvalidEffectiveInterval)
        );
    }

    let mut order = coordinate_claim();
    order.time.provider_available_ns = 81;
    assert_eq!(
        VerifiedReferenceFactCoordinatesV1::verify(order),
        Err(ReferenceFactCoordinateErrorV1::InvalidAvailabilityOrder)
    );
}

#[test]
fn rejects_future_and_incomparable_coordinates() {
    let mut future = coordinate_claim();
    future.time.owner_observation_ns = 101;
    assert_eq!(
        VerifiedReferenceFactCoordinatesV1::verify(future),
        Err(ReferenceFactCoordinateErrorV1::FutureObservation)
    );

    let mut wrong_cut = coordinate_claim();
    wrong_cut.time.decision_cut = 99;
    assert_eq!(
        VerifiedReferenceFactCoordinatesV1::verify(wrong_cut),
        Err(ReferenceFactCoordinateErrorV1::InvalidAvailabilityOrder)
    );

    let mut wrong_epoch = coordinate_claim();
    wrong_epoch.fact_clock.clock_epoch = b"other".to_vec().into_boxed_slice();
    assert_eq!(
        VerifiedReferenceFactCoordinatesV1::verify(wrong_epoch),
        Err(ReferenceFactCoordinateErrorV1::IncomparableClock)
    );

    let mut partial_epoch_proof = coordinate_claim();
    partial_epoch_proof.pit.clock.epoch_proof_identity = Some(d(15));
    partial_epoch_proof.fact_clock = partial_epoch_proof.pit.clock.clone();
    assert_eq!(
        VerifiedReferenceFactCoordinatesV1::verify(partial_epoch_proof),
        Err(ReferenceFactCoordinateErrorV1::IncomparableClock)
    );
}

#[test]
fn canonical_fact_bytes_are_bounded_and_digest_checked() {
    let bytes = b"canonical-fact";
    let identity = VerifiedReferenceFactCanonicalV1::derive_identity(
        NativeReferenceFactKindV1::Calendar,
        bytes,
    );
    let verified = VerifiedReferenceFactCanonicalV1::verify(
        NativeReferenceFactKindV1::Calendar,
        bytes.as_slice(),
        identity,
    )
    .unwrap();
    assert_eq!(verified.kind(), NativeReferenceFactKindV1::Calendar);
    assert_eq!(verified.canonical_bytes(), bytes);
    assert_eq!(verified.identity(), identity);
    assert_eq!(
        VerifiedReferenceFactCanonicalV1::verify(
            NativeReferenceFactKindV1::Calendar,
            bytes.as_slice(),
            d(1)
        ),
        Err(ReferenceFactCoordinateErrorV1::DigestMismatch)
    );
    assert_eq!(
        VerifiedReferenceFactCanonicalV1::verify(
            NativeReferenceFactKindV1::Calendar,
            Vec::new(),
            d(1)
        ),
        Err(ReferenceFactCoordinateErrorV1::InvalidCanonicalBytes)
    );
    assert_eq!(
        VerifiedReferenceFactCanonicalV1::verify(
            NativeReferenceFactKindV1::Calendar,
            vec![1; MAX_CANONICAL_FACT_BYTES + 1],
            d(1)
        ),
        Err(ReferenceFactCoordinateErrorV1::CapacityExceeded)
    );
    assert_eq!(
        VerifiedReferenceFactCanonicalV1::verify(
            NativeReferenceFactKindV1::Session,
            bytes.as_slice(),
            identity
        ),
        Err(ReferenceFactCoordinateErrorV1::DigestMismatch)
    );

    let mut self_predecessor = coordinate_claim();
    self_predecessor.predecessor_identity = Some(identity);
    let coordinates = VerifiedReferenceFactCoordinatesV1::verify(self_predecessor).unwrap();
    assert_eq!(
        verify_reference_fact_predecessor_v1(&coordinates, &verified),
        Err(ReferenceFactCoordinateErrorV1::CustodyCrossSplice)
    );
}

fn manifest_claim(facts: Vec<BindingDigest>) -> ReferenceFactCutManifestClaimV1 {
    let scope = d(20);
    let bytes = b"canonical-cut".to_vec().into_boxed_slice();
    let completeness = if facts.is_empty() {
        ReferenceFactCutCompletenessV1::ExplicitEmpty
    } else {
        ReferenceFactCutCompletenessV1::NonEmpty
    };
    let identity = VerifiedReferenceFactCutManifestV1::derive_identity(
        NativeReferenceFactKindV1::Calendar,
        scope,
        100,
        completeness,
        &facts,
        &bytes,
    )
    .unwrap();
    ReferenceFactCutManifestClaimV1 {
        kind: NativeReferenceFactKindV1::Calendar,
        scope_identity: scope,
        decision_cut: 100,
        completeness,
        fact_identities: facts.into_boxed_slice(),
        canonical_bytes: bytes,
        claimed_identity: identity,
    }
}

#[test]
fn verifies_nonempty_and_explicit_empty_complete_manifests() {
    let nonempty =
        VerifiedReferenceFactCutManifestV1::verify(manifest_claim(vec![d(21), d(22)]), false)
            .unwrap();
    assert_eq!(nonempty.fact_identities(), &[d(21), d(22)]);
    assert_eq!(nonempty.kind(), NativeReferenceFactKindV1::Calendar);
    assert_eq!(nonempty.scope_identity(), d(20));
    assert_eq!(nonempty.decision_cut(), 100);
    assert_eq!(nonempty.canonical_bytes(), b"canonical-cut");

    let empty = VerifiedReferenceFactCutManifestV1::verify(manifest_claim(vec![]), true).unwrap();
    assert!(empty.fact_identities().is_empty());
}

#[test]
fn rejects_incomplete_noncanonical_and_cross_spliced_manifests() {
    assert_eq!(
        VerifiedReferenceFactCutManifestV1::verify(manifest_claim(vec![]), false),
        Err(ReferenceFactCoordinateErrorV1::IncompleteCut)
    );
    for facts in [vec![d(22), d(21)], vec![d(21), d(21)]] {
        assert_eq!(
            VerifiedReferenceFactCutManifestV1::verify(manifest_claim(facts), false),
            Err(ReferenceFactCoordinateErrorV1::NonCanonicalManifest)
        );
    }
    let mut cross_spliced = manifest_claim(vec![d(21)]);
    cross_spliced.scope_identity = d(23);
    assert_eq!(
        VerifiedReferenceFactCutManifestV1::verify(cross_spliced, false),
        Err(ReferenceFactCoordinateErrorV1::DigestMismatch)
    );
    let mut wrong_kind = manifest_claim(vec![d(21)]);
    wrong_kind.kind = NativeReferenceFactKindV1::Session;
    assert_eq!(
        VerifiedReferenceFactCutManifestV1::verify(wrong_kind, false),
        Err(ReferenceFactCoordinateErrorV1::DigestMismatch)
    );
}

fn custody_claim(sequence: u64) -> ReferenceFactCustodyClaimV1 {
    custody_claim_for_store(sequence, d(29))
}

fn custody_claim_for_store(
    sequence: u64,
    store_generation_identity: BindingDigest,
) -> ReferenceFactCustodyClaimV1 {
    let (receipt, outbox) = VerifiedReferenceFactCustodyV1::derive_identities(
        NativeReferenceFactKindV1::Calendar,
        store_generation_identity,
        d(30),
        d(31),
        d(32),
        d(33),
        sequence,
    );
    ReferenceFactCustodyClaimV1 {
        kind: NativeReferenceFactKindV1::Calendar,
        store_generation_identity,
        request_identity: d(30),
        request_meaning_digest: d(31),
        cut_identity: d(32),
        stable_correlation: d(33),
        append_sequence: sequence,
        receipt_identity: receipt,
        outbox_identity: outbox,
    }
}

#[test]
fn custody_is_deterministic_write_once_and_cross_splice_safe() {
    let first = VerifiedReferenceFactCustodyV1::verify(custody_claim(1)).unwrap();
    assert_eq!(
        first.claim().receipt_identity,
        first.claim().outbox_identity
    );
    let replay = VerifiedReferenceFactCustodyV1::verify(custody_claim(1)).unwrap();
    assert_eq!(
        classify_custody_join_v1(&first, &replay),
        ReferenceFactCustodyJoinV1::ExactReplay
    );

    let second = VerifiedReferenceFactCustodyV1::verify(custody_claim(2)).unwrap();
    assert_eq!(
        classify_custody_join_v1(&first, &second),
        ReferenceFactCustodyJoinV1::Conflict
    );

    let mut splice = custody_claim(1);
    splice.cut_identity = d(34);
    assert_eq!(
        VerifiedReferenceFactCustodyV1::verify(splice),
        Err(ReferenceFactCoordinateErrorV1::CustodyCrossSplice)
    );

    let mut outbox_splice = custody_claim(1);
    outbox_splice.outbox_identity = d(35);
    assert_eq!(
        VerifiedReferenceFactCustodyV1::verify(outbox_splice),
        Err(ReferenceFactCoordinateErrorV1::CustodyCrossSplice)
    );

    let mut kind_splice = custody_claim(1);
    kind_splice.kind = NativeReferenceFactKindV1::Session;
    assert_eq!(
        VerifiedReferenceFactCustodyV1::verify(kind_splice),
        Err(ReferenceFactCoordinateErrorV1::CustodyCrossSplice)
    );
}

#[test]
fn custody_is_bound_to_one_nonzero_store_generation() {
    let first_store = custody_claim_for_store(1, d(29));
    let second_store = custody_claim_for_store(1, d(28));
    assert_ne!(first_store.receipt_identity, second_store.receipt_identity);

    let mut zero_generation = custody_claim(1);
    zero_generation.store_generation_identity = d(0);
    assert_eq!(
        VerifiedReferenceFactCustodyV1::verify(zero_generation),
        Err(ReferenceFactCoordinateErrorV1::MissingIdentity)
    );
}

#[test]
fn rejects_zero_and_overflowing_append_sequences() {
    assert_eq!(
        VerifiedReferenceFactCustodyV1::verify(custody_claim(0)),
        Err(ReferenceFactCoordinateErrorV1::InvalidCustody)
    );
    assert_eq!(next_append_sequence_v1(0).unwrap(), 1);
    assert_eq!(
        next_append_sequence_v1(u64::MAX),
        Err(ReferenceFactCoordinateErrorV1::AppendSequenceOverflow)
    );
}

#[test]
fn rejects_manifest_capacity_and_empty_bytes() {
    let mut empty_bytes = manifest_claim(vec![d(21)]);
    empty_bytes.canonical_bytes = Box::new([]);
    assert_eq!(
        VerifiedReferenceFactCutManifestV1::verify(empty_bytes, false),
        Err(ReferenceFactCoordinateErrorV1::InvalidCanonicalBytes)
    );

    let mut over_cap = manifest_claim(vec![d(21)]);
    over_cap.canonical_bytes = vec![0; MAX_CANONICAL_CUT_BYTES + 1].into_boxed_slice();
    assert_eq!(
        VerifiedReferenceFactCutManifestV1::verify(over_cap, false),
        Err(ReferenceFactCoordinateErrorV1::CapacityExceeded)
    );
}
