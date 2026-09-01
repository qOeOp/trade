#[test]
fn sealed_readback_has_no_caller_constructor_or_codec() {
    let tests = trybuild::TestCases::new();
    tests.compile_fail("tests/ui/*.rs");
}
