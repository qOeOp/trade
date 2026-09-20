use rstest::rstest;

#[rstest]
fn external_callers_cannot_construct_terminal_receipts() {
    let cases = trybuild::TestCases::new();
    cases.compile_fail("tests/ui/terminal_receipt_constructor_is_private.rs");
    cases.compile_fail("tests/ui/terminal_receipt_cannot_deserialize.rs");
    cases.compile_fail("tests/ui/committed_cuts_cannot_be_rebuilt_outside_the_parser.rs");
}
