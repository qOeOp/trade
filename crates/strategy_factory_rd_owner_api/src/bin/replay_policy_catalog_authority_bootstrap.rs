use std::{
    fs,
    io::{self, Write},
    path::Path,
};

use anyhow::Context;
use sqlx::postgres::PgPoolOptions;
use vibe_strategy_factory::ensure_authenticated_replay_policy_catalog_genesis_v1;

const DATABASE_URL_ENV: &str = "RD_FACT_WRITER_DATABASE_URL";
const SEALED_REQUEST_PATH_ENV: &str = "REPLAY_POLICY_CATALOG_BOOTSTRAP_REQUEST_PATH";
const TRUSTED_VERIFIER_IDENTITY_ENV: &str = "REPLAY_POLICY_CATALOG_TRUSTED_VERIFIER_IDENTITY";
const TRUSTED_VERIFIER_PUBLIC_KEY_PATH_ENV: &str =
    "REPLAY_POLICY_CATALOG_TRUSTED_VERIFIER_PUBLIC_KEY_PATH";
const MAX_SEALED_REQUEST_BYTES: usize = 64 * 1024;
const MAX_PUBLIC_KEY_FILE_BYTES: usize = 128;
const MAX_RECEIPT_BYTES: usize = 16 * 1024;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    require_no_arguments(std::env::args().skip(1))?;

    let database_url = require_environment(DATABASE_URL_ENV)?;
    let sealed_request_path = require_environment(SEALED_REQUEST_PATH_ENV)?;
    let trusted_verifier_identity = require_environment(TRUSTED_VERIFIER_IDENTITY_ENV)?;
    require_trusted_verifier_identity(&trusted_verifier_identity)?;
    let trusted_verifier_public_key_bytes = read_bounded_file(
        Path::new(&require_environment(TRUSTED_VERIFIER_PUBLIC_KEY_PATH_ENV)?),
        MAX_PUBLIC_KEY_FILE_BYTES,
        "trusted verifier public key",
    )?;
    let trusted_verifier_public_key_hex =
        canonical_public_key_hex(&trusted_verifier_public_key_bytes)?;
    let sealed_request_json = read_bounded_file(
        Path::new(&sealed_request_path),
        MAX_SEALED_REQUEST_BYTES,
        "sealed Catalog bootstrap request",
    )?;

    if sealed_request_json.is_empty() {
        anyhow::bail!("sealed Catalog bootstrap request must not be empty");
    }

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_lazy(&database_url)
        .context("R&D fact-writer database URL is invalid")?;
    let receipt = ensure_authenticated_replay_policy_catalog_genesis_v1(
        &pool,
        &sealed_request_json,
        &trusted_verifier_identity,
        trusted_verifier_public_key_hex,
    )
    .await
    .map_err(|_| anyhow::anyhow!("Replay Policy Catalog bootstrap was not accepted"))?;
    let canonical_receipt = serde_json::to_vec(&receipt)
        .context("Replay Policy Catalog bootstrap receipt serialization failed")?;

    if canonical_receipt.len() > MAX_RECEIPT_BYTES {
        anyhow::bail!("Replay Policy Catalog bootstrap receipt exceeds the output bound");
    }
    let mut stdout = io::stdout().lock();
    stdout.write_all(&canonical_receipt)?;
    stdout.write_all(b"\n")?;
    Ok(())
}

fn require_no_arguments(mut arguments: impl Iterator<Item = String>) -> anyhow::Result<()> {
    if arguments.next().is_some() {
        anyhow::bail!("Replay Policy Catalog bootstrap accepts no command-line arguments");
    }
    Ok(())
}

fn require_environment(name: &'static str) -> anyhow::Result<String> {
    std::env::var(name).with_context(|| format!("{name} must be explicitly set"))
}

fn read_bounded_file(path: &Path, limit: usize, label: &'static str) -> anyhow::Result<Vec<u8>> {
    let metadata = fs::metadata(path).with_context(|| format!("{label} file is unavailable"))?;

    if !metadata.is_file() {
        anyhow::bail!("{label} path must identify a regular file");
    }

    if metadata.len() > limit as u64 {
        anyhow::bail!("{label} file exceeds its byte bound");
    }
    let bytes = fs::read(path).with_context(|| format!("{label} file is unreadable"))?;

    if bytes.len() > limit {
        anyhow::bail!("{label} file exceeds its byte bound");
    }
    Ok(bytes)
}

fn require_trusted_verifier_identity(value: &str) -> anyhow::Result<&str> {
    if value.is_empty()
        || value.len() > 256
        || !value.is_ascii()
        || value.trim() != value
        || value.bytes().any(|byte| byte.is_ascii_control())
    {
        anyhow::bail!("trusted verifier identity is invalid");
    }
    Ok(value)
}

fn canonical_public_key_hex(bytes: &[u8]) -> anyhow::Result<&str> {
    let text = std::str::from_utf8(bytes).context("trusted verifier public key is not UTF-8")?;
    let value = text
        .strip_suffix("\r\n")
        .or_else(|| text.strip_suffix('\n'))
        .unwrap_or(text);

    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        anyhow::bail!("trusted verifier public key must be canonical lowercase hex");
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn public_key_requires_exact_lowercase_hex_without_ambient_whitespace() {
        let key = "01abcdef".repeat(8);
        assert_eq!(canonical_public_key_hex(key.as_bytes()).unwrap(), key);
        assert_eq!(
            canonical_public_key_hex(format!("{key}\n").as_bytes()).unwrap(),
            key
        );
        assert!(canonical_public_key_hex(key.to_uppercase().as_bytes()).is_err());
        assert!(canonical_public_key_hex(format!(" {key}").as_bytes()).is_err());
        assert!(canonical_public_key_hex(format!("{key}\n\n").as_bytes()).is_err());
    }

    #[rstest]
    fn verifier_identity_and_arguments_are_bounded() {
        assert_eq!(
            require_trusted_verifier_identity("verifier-v1").unwrap(),
            "verifier-v1"
        );
        assert!(require_trusted_verifier_identity("").is_err());
        assert!(require_trusted_verifier_identity(" verifier-v1").is_err());
        assert!(require_trusted_verifier_identity("verifier\nv1").is_err());
        assert!(require_trusted_verifier_identity(&"v".repeat(257)).is_err());
        assert!(require_no_arguments(std::iter::empty()).is_ok());
        assert!(require_no_arguments(["unexpected".to_owned()].into_iter()).is_err());
    }

    #[rstest]
    fn database_pool_is_lazy_until_core_verifies_the_request() {
        let source = include_str!("replay_policy_catalog_authority_bootstrap.rs");
        let eager_connect = [".", "connect("].concat();
        assert!(source.contains(".connect_lazy(&database_url)"));
        assert!(!source.contains(&eager_connect));
    }
}
