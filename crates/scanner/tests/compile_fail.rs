use rstest::rstest;

#[rstest]
fn external_callers_cannot_construct_terminal_receipts() {
    let cases = trybuild::TestCases::new();
    cases.compile_fail("tests/ui/terminal_receipt_constructor_is_private.rs");
    cases.compile_fail("tests/ui/product_edge_reader_cannot_commit.rs");
    cases.compile_fail("tests/ui/product_edge_reader_has_no_raw_store.rs");
    cases.compile_fail("tests/ui/caller_store_cannot_issue_product_edge_reader.rs");
    cases.compile_fail("tests/ui/caller_store_cannot_claim_read_source.rs");
    cases.compile_fail("tests/ui/terminal_receipt_cannot_deserialize.rs");
}
