/// Canonical content identity without source authority.
#[derive(Debug)]
pub struct CanonicalDatasetManifest(Vec<u8>);
impl CanonicalDatasetManifest {
    /// Parses canonical JSON content.
    /// # Errors
    /// Fails on invalid size, JSON, or encoding.
    pub fn parse(bytes: &[u8]) -> anyhow::Result<Self> {
        anyhow::ensure!((1..=1_048_576).contains(&bytes.len()), "invalid size");
        let value: serde_json::Value = serde_json::from_slice(bytes)?;
        let mut canonical = serde_json::to_vec(&value)?;
        canonical.push(b'\n');
        anyhow::ensure!(canonical == bytes, "dataset manifest is not canonical JSON");
        Ok(Self(canonical))
    }
    /// Returns canonical bytes.
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::CanonicalDatasetManifest;

    #[rstest]
    fn binds_only_exact_canonical_content() {
        let manifest = CanonicalDatasetManifest::parse(b"{\"a\":1,\"b\":2}\n").unwrap();
        assert_eq!(manifest.canonical_bytes(), b"{\"a\":1,\"b\":2}\n");
        assert!(CanonicalDatasetManifest::parse(b"{\"b\":2,\"a\":1}\n").is_err());
        assert!(CanonicalDatasetManifest::parse(b"{\"a\":1,\"b\":2}").is_err());
    }
}
