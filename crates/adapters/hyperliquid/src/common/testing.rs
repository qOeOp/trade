/// Loads and deserializes a JSON test fixture from the `test_data/` directory.
#[expect(clippy::missing_panics_doc, reason = "test-only helper")]
pub fn load_test_data<T>(filename: &str) -> T
where
    T: serde::de::DeserializeOwned,
{
    let path = format!("test_data/{filename}");
    let content = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("Failed to read test data at {path}: {e}"));
    serde_json::from_str(&content)
        .unwrap_or_else(|e| panic!("Failed to parse test data at {path}: {e}"))
}
