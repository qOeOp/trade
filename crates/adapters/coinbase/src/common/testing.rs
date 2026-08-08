/// Loads a test fixture file by name from the crate's `test_data/` directory.
///
/// # Panics
///
/// Panics if the fixture file does not exist or cannot be read.
pub fn load_test_fixture(name: &str) -> String {
    let path = format!("{}/test_data/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("Failed to load test fixture '{path}': {e}"))
}
