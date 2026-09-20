use rstest::rstest;

#[rstest]
fn the_product_edge_read_capability_stays_scanner_owned() {
    let cases = trybuild::TestCases::new();
    cases.compile_fail("tests/ui/caller_store_cannot_claim_read_source.rs");
    cases.compile_fail("tests/ui/caller_store_cannot_issue_product_edge_reader.rs");
    cases.compile_fail("tests/ui/product_edge_reader_cannot_commit.rs");
    cases.compile_fail("tests/ui/product_edge_reader_has_no_raw_store.rs");
}
