#![cfg(feature = "sealed-strategy-input-acceptance")]

use std::collections::BTreeSet;

use rstest::rstest;
use vibe_data::owner::sealed_acceptance::issue_strategy_input_universe_frame;
use vibe_data::owner::source_binding::BindingDigest;

const OPEN_ROLE_IDENTITY: [u8; 32] = [
    188, 119, 32, 67, 197, 45, 36, 25, 82, 171, 129, 189, 167, 136, 146, 135, 178, 160, 162, 108,
    2, 83, 105, 97, 42, 22, 217, 120, 49, 133, 15, 115,
];
const CLOSE_ROLE_IDENTITY: [u8; 32] = [
    104, 195, 30, 17, 126, 250, 168, 34, 91, 223, 251, 134, 191, 8, 138, 196, 0, 145, 143, 202,
    147, 146, 144, 96, 163, 22, 78, 125, 143, 96, 236, 90,
];
const STRATEGY_DESIGN_IDENTITY: [u8; 32] = [
    202, 109, 110, 206, 104, 192, 162, 0, 156, 57, 11, 175, 182, 163, 124, 136, 229, 156, 137, 195,
    38, 194, 2, 172, 51, 3, 187, 106, 84, 93, 174, 230,
];

#[rstest]
fn fixed_owner_path_issues_one_stable_two_member_open_close_frame() {
    let first = issue_strategy_input_universe_frame().expect("fixed SEALED_ACCEPTANCE fixture");
    let repeated = issue_strategy_input_universe_frame().expect("stable SEALED_ACCEPTANCE replay");

    assert_eq!(first, repeated);
    assert_ne!(first.digest().as_bytes(), &[0; 32]);
    assert_ne!(first.selection().selection_identity().as_bytes(), &[0; 32]);
    assert_ne!(first.selection().selection_digest().as_bytes(), &[0; 32]);
    assert_eq!(first.selection().members().len(), 2);
    assert_eq!(
        first
            .selection()
            .members()
            .iter()
            .map(|member| (member.member_key(), member.instrument()))
            .collect::<Vec<_>>(),
        vec![("AAPL", "AAPL.XNAS"), ("MSFT", "MSFT.XNAS")]
    );
    assert_eq!(
        first
            .selection()
            .members()
            .iter()
            .map(|member| member.instrument())
            .collect::<BTreeSet<_>>()
            .len(),
        2
    );
    assert_eq!(first.values().len(), 4);
    assert_eq!(
        first
            .values()
            .iter()
            .map(|value| value.member_key())
            .collect::<BTreeSet<_>>(),
        BTreeSet::from(["AAPL", "MSFT"])
    );
    assert_eq!(
        first
            .values()
            .iter()
            .map(|value| value.input_role_identity())
            .collect::<BTreeSet<_>>()
            .len(),
        2
    );
    let open_role = BindingDigest::from_untrusted_bytes(OPEN_ROLE_IDENTITY);
    let close_role = BindingDigest::from_untrusted_bytes(CLOSE_ROLE_IDENTITY);
    assert_eq!(
        first
            .values()
            .iter()
            .map(|value| (value.member_key(), value.input_role_identity()))
            .collect::<BTreeSet<_>>(),
        BTreeSet::from([
            ("AAPL", open_role),
            ("AAPL", close_role),
            ("MSFT", open_role),
            ("MSFT", close_role),
        ])
    );

    let mantissas = first
        .values()
        .iter()
        .map(|value| i128::from_le_bytes(*value.value_bytes()))
        .collect::<BTreeSet<_>>();
    assert_eq!(mantissas, BTreeSet::from([18_641, 18_725, 41_981, 42_115]));
    assert_eq!(first.role_bindings().len(), 2);
    assert!(first.role_bindings().iter().all(|binding| {
        binding.research_request_identity() == BindingDigest::from_untrusted_bytes([1; 32])
            && binding.strategy_design_identity()
                == BindingDigest::from_untrusted_bytes(STRATEGY_DESIGN_IDENTITY)
            && [open_role, close_role].contains(&binding.input_role_identity())
    }));
    assert!(first.values().iter().all(|value| {
        value.observation_batch_digest() == first.trigger().observation_batch_digest()
            && value.trigger_digest() == first.trigger().digest()
    }));
}

// The crate's public positive types retain private fields and no `Deserialize`; their existing
// compile-fail examples remain active under this feature. This integration test can only observe
// the receipt returned by the zero-argument sealed adapter.
