use rstest::rstest;

#[rstest]
fn external_callers_cannot_construct_terminal_receipts() {
    let cases = trybuild::TestCases::new();
    cases.compile_fail("tests/ui/terminal_receipt_constructor_is_private.rs");
}
