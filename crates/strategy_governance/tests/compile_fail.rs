use rstest::rstest;

#[rstest]
fn external_callers_cannot_install_a_runtime_owner_source() {
    let cases = trybuild::TestCases::new();
    cases.compile_fail("tests/ui/missing_runtime_source_trait.rs");
    cases.compile_fail("tests/ui/missing_runtime_source_view.rs");
}

#[rstest]
fn owner_frontier_types_are_not_interchangeable() {
    let cases = trybuild::TestCases::new();
    cases.compile_fail("tests/ui/digest_is_not_time_frontier.rs");
    cases.compile_fail("tests/ui/qualification_is_not_time_frontier.rs");
    cases.compile_fail("tests/ui/time_is_not_qualification_frontier.rs");
}
