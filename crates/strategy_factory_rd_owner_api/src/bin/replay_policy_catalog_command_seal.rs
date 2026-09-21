//! Seals one authored Replay Policy Catalog V3 administration command.
//!
//! An administrator writes the command in its authoring form - identities, expectations, the
//! policy, the economic configuration and the runner profile - and holds the Ed25519 signing
//! key whose public key the deployment trusts as the Catalog verifier. This binary turns that
//! authoring into the exact sealed JSON the `authority-admin` bootstrap applies. It reads the
//! key from a private file, never prints it, refuses to overwrite an existing sealed command,
//! and the sealer it calls proves the sealed bytes verify under the key's public half before
//! anything is written.

use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::Path,
};
use vibe_strategy_factory_rd_owner_api::required_env;

use anyhow::Context;
use ed25519_dalek::SigningKey;
use serde::Serialize;
use vibe_strategy_factory::{
    CatalogAdminCommandKindV3, ReplayPolicyCatalogAdminCommandAuthoringV3,
    seal_replay_policy_catalog_admin_command_v3,
};

const AUTHORING_PATH_ENV: &str = "REPLAY_POLICY_CATALOG_COMMAND_AUTHORING_PATH";
const SIGNING_KEY_PATH_ENV: &str = "REPLAY_POLICY_CATALOG_SIGNING_KEY_PATH";
const OUTPUT_PATH_ENV: &str = "REPLAY_POLICY_CATALOG_SEALED_COMMAND_OUTPUT_PATH";
const MAX_AUTHORING_BYTES: usize = 64 * 1024;
const MAX_SIGNING_KEY_FILE_BYTES: usize = 128;

/// What the sealer prints: enough to name the command and its verifier, and nothing that
/// could reconstruct the key.
#[derive(Serialize)]
struct SealedCommandSummaryV3 {
    schema_version: u16,
    command_identity: String,
    command_kind: CatalogAdminCommandKindV3,
    catalog_record_id: String,
    catalog_version: u64,
    verifier_identity: String,
    verifier_public_key_hex: String,
    sealed_command_bytes: usize,
}

fn main() -> anyhow::Result<()> {
    require_no_arguments(std::env::args().skip(1))?;
    let authoring_json = read_bounded_file(
        Path::new(&required_env(AUTHORING_PATH_ENV)?),
        MAX_AUTHORING_BYTES,
        "Catalog command authoring",
    )?;
    let authoring: ReplayPolicyCatalogAdminCommandAuthoringV3 =
        serde_json::from_slice(&authoring_json).context("Catalog command authoring is invalid")?;
    let signing_key = read_signing_key(Path::new(&required_env(SIGNING_KEY_PATH_ENV)?))?;
    let output_path = required_env(OUTPUT_PATH_ENV)?;
    let mut summary = SealedCommandSummaryV3 {
        schema_version: 3,
        command_identity: authoring.command_identity.clone(),
        command_kind: authoring.command_kind,
        catalog_record_id: authoring.catalog_record_id.clone(),
        catalog_version: authoring.catalog_version,
        verifier_identity: authoring.verifier_identity.clone(),
        verifier_public_key_hex: lower_hex(signing_key.verifying_key().as_bytes()),
        sealed_command_bytes: 0,
    };
    let sealed = seal_replay_policy_catalog_admin_command_v3(authoring, &signing_key)
        .map_err(|e| anyhow::anyhow!("Catalog command was not sealed: {e}"))?;
    summary.sealed_command_bytes = sealed.len();
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&output_path)
        .with_context(|| format!("sealed command output {output_path} must not already exist"))?;
    output.write_all(&sealed)?;
    output.write_all(b"\n")?;
    let mut stdout = io::stdout().lock();
    stdout.write_all(&serde_json::to_vec(&summary)?)?;
    stdout.write_all(b"\n")?;
    Ok(())
}

fn require_no_arguments(mut arguments: impl Iterator<Item = String>) -> anyhow::Result<()> {
    if arguments.next().is_some() {
        anyhow::bail!("Replay Policy Catalog command sealer accepts no command-line arguments");
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

/// The signing key file holds the 32-byte seed as exactly 64 lowercase hex characters, with at
/// most one trailing newline; anything else is refused rather than guessed at.
fn read_signing_key(path: &Path) -> anyhow::Result<SigningKey> {
    let bytes = read_bounded_file(path, MAX_SIGNING_KEY_FILE_BYTES, "Catalog signing key")?;
    let seed = parse_seed_hex(&bytes)?;
    Ok(SigningKey::from_bytes(&seed))
}

fn parse_seed_hex(bytes: &[u8]) -> anyhow::Result<[u8; 32]> {
    let text = std::str::from_utf8(bytes).context("Catalog signing key is not UTF-8")?;
    let value = text
        .strip_suffix("\r\n")
        .or_else(|| text.strip_suffix('\n'))
        .unwrap_or(text);

    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        anyhow::bail!("Catalog signing key must be exactly 64 lowercase hex characters");
    }
    let mut seed = [0_u8; 32];

    for (index, chunk) in value.as_bytes().chunks(2).enumerate() {
        let pair = std::str::from_utf8(chunk).context("Catalog signing key is not UTF-8")?;
        seed[index] = u8::from_str_radix(pair, 16).context("Catalog signing key is not hex")?;
    }
    Ok(seed)
}

fn lower_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn signing_key_file_requires_exact_lowercase_hex_seed() {
        let seed_hex = "1d".repeat(32);
        assert_eq!(parse_seed_hex(seed_hex.as_bytes()).unwrap(), [0x1d; 32]);
        assert_eq!(
            parse_seed_hex(format!("{seed_hex}\n").as_bytes()).unwrap(),
            [0x1d; 32]
        );
        assert!(parse_seed_hex(seed_hex.to_uppercase().as_bytes()).is_err());
        assert!(parse_seed_hex(format!(" {seed_hex}").as_bytes()).is_err());
        assert!(parse_seed_hex(&seed_hex.as_bytes()[..62]).is_err());
        assert!(require_no_arguments(std::iter::empty()).is_ok());
        assert!(require_no_arguments(["unexpected".to_owned()].into_iter()).is_err());
    }

    #[rstest]
    fn the_sealer_refuses_to_overwrite_and_never_serializes_the_seed() {
        let source = include_str!("replay_policy_catalog_command_seal.rs");
        assert!(source.contains(".create_new(true)"));
        assert!(!source.contains(&["to_", "bytes()"].concat()));
    }
}
