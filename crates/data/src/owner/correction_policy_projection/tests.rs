use super::{CorrectionPolicyProjectionErrorV1 as Error, authority, codec};
use rstest::rstest;

#[allow(clippy::too_many_arguments, reason = "compact projection test matrix")]
fn p(
    root: u8,
    binding: u8,
    fact: u8,
    version: u64,
    stream: &[u8],
    seq: u64,
    frontier: u8,
    from: i128,
) -> super::CorrectionPolicyProjectionV1 {
    authority::projection_for_test(root, binding, fact, version, stream, seq, frontier, from)
}

#[rstest]
fn first_projection_is_canonical_and_deterministic() {
    let a = authority::first_for_test(p(1, 2, 3, 1, b"corrections", 7, 4, 100)).unwrap();
    let b = authority::first_for_test(p(1, 2, 3, 1, b"corrections", 7, 4, 100)).unwrap();
    assert_eq!(a, b);
    assert_eq!(a.identity(), b.identity());
    codec::verify(a.canonical_bytes(), a.identity()).unwrap();
    assert!(a.canonical_bytes().starts_with(&[0, 1, 0, 0, 0, 0, 0, 11]));
}

#[rstest]
fn replay_w3_can_consume_the_complete_typed_projection() {
    let value = p(1, 2, 3, 1, b"corrections", 7, 4, 100);
    assert_eq!(value.stream_identity(), b"corrections");
    assert_eq!(value.sequence(), 7);
    assert!(value.successor_only());
    assert_eq!(value.source_binding_identity().as_bytes(), &[2; 32]);
    assert_eq!(value.source_binding_fact_digest().as_bytes(), &[3; 32]);
    assert_eq!(value.source_binding_lineage_root().as_bytes(), &[1; 32]);
    assert_eq!(value.source_binding_lineage_version(), 1);
    assert_eq!(value.correction_frontier_digest().as_bytes(), &[4; 32]);
    assert_eq!(value.effective_from_ns(), 100);
    assert_eq!(value.effective_until_ns(), None);
    assert_eq!(value.provider_available_ns(), 10);
    assert_eq!(value.retrieval_ns(), 20);
    assert_eq!(value.correction_publication_ns(), 15);
    assert_eq!(value.owner_observation_ns(), 25);
    assert_eq!(value.decision_cut(), 30);
    assert_eq!(value.clock_head_identity().as_bytes(), &[8; 32]);
    assert_eq!(value.clock_head_digest().as_bytes(), &[9; 32]);
    assert_eq!(value.r0_coordinate_identity().as_bytes(), &[10; 32]);
    assert_eq!(value.r0_coordinate_digest().as_bytes(), &[11; 32]);
}

#[rstest]
fn identical_later_version_coalesces_without_earlier_availability() {
    let first = p(1, 2, 3, 1, b"corrections", 7, 4, 100);
    let mut later = p(1, 2, 6, 2, b"corrections", 7, 4, 200);
    later.decision_cut = 40;
    later.clock_head_identity =
        crate::owner::source_binding::BindingDigest::from_untrusted_bytes([12; 32]);
    later.clock_head_digest =
        crate::owner::source_binding::BindingDigest::from_untrusted_bytes([13; 32]);
    later.r0_coordinate_identity =
        crate::owner::source_binding::BindingDigest::from_untrusted_bytes([14; 32]);
    later.r0_coordinate_digest =
        crate::owner::source_binding::BindingDigest::from_untrusted_bytes([15; 32]);
    let (closed, current) = authority::join_for_test(&first, later).unwrap();
    assert_eq!(closed, current);
    assert_eq!(current.effective_from_ns, 100);
    assert_eq!(current.provider_available_ns, 10);
    assert_eq!(current.decision_cut(), first.decision_cut());
    assert_eq!(current.clock_head_identity(), first.clock_head_identity());
    assert_eq!(current.clock_head_digest(), first.clock_head_digest());
    assert_eq!(
        current.r0_coordinate_identity(),
        first.r0_coordinate_identity()
    );
    assert_eq!(current.r0_coordinate_digest(), first.r0_coordinate_digest());
}

#[rstest]
fn direct_distinct_successor_closes_prior_half_open_interval() {
    let first = p(1, 2, 3, 1, b"corrections", 7, 4, 100);
    let next = p(1, 2, 6, 2, b"corrections", 8, 7, 200);
    let (closed, current) = authority::join_for_test(&first, next).unwrap();
    assert_eq!(closed.effective_until_ns, Some(200));
    assert_eq!(current.effective_until_ns, None);
    codec::verify(closed.canonical_bytes(), closed.identity()).unwrap();
}

#[rstest]
fn lineage_and_frontier_splices_fail_closed() {
    let prior = p(1, 2, 3, 2, b"corrections", 7, 4, 100);
    let cases = [
        (p(1, 2, 6, 4, b"corrections", 8, 7, 200), Error::LineageGap),
        (
            p(1, 2, 6, 1, b"corrections", 8, 7, 200),
            Error::LineageRegression,
        ),
        (p(1, 2, 6, 2, b"other", 8, 7, 200), Error::StreamChanged),
        (
            p(9, 2, 6, 3, b"corrections", 8, 7, 200),
            Error::CrossSourceSplice,
        ),
        (
            p(1, 5, 6, 3, b"corrections", 8, 7, 200),
            Error::CrossSourceSplice,
        ),
        (
            p(1, 2, 6, 3, b"corrections", 10, 7, 200),
            Error::FrontierGap,
        ),
        (
            p(1, 2, 6, 3, b"corrections", 6, 7, 200),
            Error::FrontierRegression,
        ),
        (p(1, 2, 6, 3, b"other", 8, 7, 200), Error::StreamChanged),
    ];
    for (next, e) in cases {
        assert_eq!(authority::join_for_test(&prior, next), Err(e));
    }
}

#[rstest]
fn branch_same_sequence_with_changed_frontier_and_bad_interval_fail() {
    let prior = p(1, 2, 3, 1, b"corrections", 7, 4, 100);
    assert_eq!(
        authority::join_for_test(&prior, p(1, 2, 6, 2, b"corrections", 7, 9, 200)),
        Err(Error::LineageBranch)
    );
    assert_eq!(
        authority::join_for_test(&prior, p(1, 2, 6, 2, b"corrections", 8, 9, 100)),
        Err(Error::InvalidInterval)
    );
}

#[rstest]
fn canonical_verifier_rejects_corruption_trailing_and_capacity() {
    let value = p(1, 2, 3, 1, b"corrections", 7, 4, 100);
    let mut corrupt = value.canonical_bytes().to_vec();
    corrupt[0] = 9;
    assert_eq!(
        codec::verify(&corrupt, value.identity()),
        Err(Error::CorruptCanonicalBytes)
    );
    let mut trailing = value.canonical_bytes().to_vec();
    trailing.push(0);
    assert_eq!(
        codec::verify(&trailing, codec::identity(&trailing)),
        Err(Error::CorruptCanonicalBytes)
    );
    let oversized = vec![0; 2049];
    assert_eq!(
        codec::verify(&oversized, codec::identity(&oversized)),
        Err(Error::CapacityExceeded)
    );
}
