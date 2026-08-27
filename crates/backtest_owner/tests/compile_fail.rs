use rstest::rstest;

#[rstest]
fn callers_cannot_forge_positive_replay_evidence() {
    let cases = trybuild::TestCases::new();
    cases.compile_fail("tests/ui/caller_constructs_result.rs");
    cases.compile_fail("tests/ui/caller_constructs_diagnostic.rs");
    cases.compile_fail("tests/ui/caller_deserializes_result.rs");
    cases.compile_fail("tests/ui/caller_deserializes_observation.rs");
    cases.compile_fail("tests/ui/caller_deserializes_diagnostic.rs");
    cases.compile_fail("tests/ui/caller_implements_observation.rs");
}
