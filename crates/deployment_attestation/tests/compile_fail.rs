use rstest::rstest;

#[rstest]
fn callers_cannot_inject_policy_or_construct_positive_evidence() {
    let cases = trybuild::TestCases::new();
    cases.compile_fail("tests/ui/caller_policy_injection.rs");
    cases.compile_fail("tests/ui/caller_positive_evidence.rs");
    cases.compile_fail("tests/ui/caller_deserialize_evidence.rs");
}
