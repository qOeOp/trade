use std::{
    fs,
    io::{self, Write},
    path::Path,
};
use vibe_strategy_factory_rd_owner_api::required_env;

use anyhow::Context;
use sqlx::postgres::PgPoolOptions;
use vibe_strategy_factory::{
    ReplayPolicyCatalogBootstrapReceiptV3, read_authenticated_replay_policy_catalog_v3,
};

const DATABASE_URL_ENV: &str = "RD_OWNER_DATABASE_URL";
const SEALED_CREATE_COMMAND_PATH_ENV: &str = "REPLAY_POLICY_CATALOG_BOOTSTRAP_CREATE_COMMAND_PATH";
const TRUSTED_VERIFIER_IDENTITY_ENV: &str = "REPLAY_POLICY_CATALOG_TRUSTED_VERIFIER_IDENTITY";
const TRUSTED_VERIFIER_PUBLIC_KEY_PATH_ENV: &str =
    "REPLAY_POLICY_CATALOG_TRUSTED_VERIFIER_PUBLIC_KEY_PATH";
const MAX_SEALED_COMMAND_BYTES: usize = 64 * 1024;
const MAX_PUBLIC_KEY_FILE_BYTES: usize = 128;
const MAX_RECEIPT_BYTES: usize = 16 * 1024;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    require_no_arguments(std::env::args().skip(1))?;
    let database_url = required_env(DATABASE_URL_ENV)?;
    let sealed_create_command_path = required_env(SEALED_CREATE_COMMAND_PATH_ENV)?;
    let trusted_verifier_identity = required_env(TRUSTED_VERIFIER_IDENTITY_ENV)?;
    require_trusted_verifier_identity(&trusted_verifier_identity)?;
    let trusted_verifier_public_key_bytes = read_bounded_file(
        Path::new(&required_env(TRUSTED_VERIFIER_PUBLIC_KEY_PATH_ENV)?),
        MAX_PUBLIC_KEY_FILE_BYTES,
        "trusted verifier public key",
    )?;
    let trusted_verifier_public_key_hex =
        canonical_public_key_hex(&trusted_verifier_public_key_bytes)?;
    let sealed_create_command_json = read_bounded_file(
        Path::new(&sealed_create_command_path),
        MAX_SEALED_COMMAND_BYTES,
        "sealed Catalog create command",
    )?;

    if sealed_create_command_json.is_empty() {
        anyhow::bail!("sealed Catalog create command must not be empty");
    }

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_lazy(&database_url)
        .context("R&D Owner database URL is invalid")?;
    let binding = read_authenticated_replay_policy_catalog_v3(
        &pool,
        &sealed_create_command_json,
        &trusted_verifier_identity,
        trusted_verifier_public_key_hex,
    )
    .await
    .map_err(|_| anyhow::anyhow!("Replay Policy Catalog Owner readback was not accepted"))?;
    let receipt =
        ReplayPolicyCatalogBootstrapReceiptV3::from_binding(&trusted_verifier_identity, &binding);
    let canonical_receipt = serde_json::to_vec(&receipt)
        .context("Replay Policy Catalog Owner readback receipt serialization failed")?;
    if canonical_receipt.len() > MAX_RECEIPT_BYTES {
        anyhow::bail!("Replay Policy Catalog Owner readback receipt exceeds the output bound");
    }
    let mut stdout = io::stdout().lock();
    stdout.write_all(&canonical_receipt)?;
    stdout.write_all(b"\n")?;
    Ok(())
}

fn require_no_arguments(mut arguments: impl Iterator<Item = String>) -> anyhow::Result<()> {
    if arguments.next().is_some() {
        anyhow::bail!("Replay Policy Catalog Owner readback accepts no command-line arguments");
    }
    Ok(())
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
