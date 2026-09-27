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
    fs::OpenOptions,
    io::{self, Write},
    path::Path,
};
use vibe_strategy_factory_rd_owner_api::{
    required_env,
    signing_key_file::{read_bounded_file, read_ed25519_signing_key},
};

use anyhow::Context;
use serde::Serialize;
use vibe_strategy_factory::{
    CatalogAdminCommandKindV3, ReplayPolicyCatalogAdminCommandAuthoringV3,
    seal_replay_policy_catalog_admin_command_v3,
};

const AUTHORING_PATH_ENV: &str = "REPLAY_POLICY_CATALOG_COMMAND_AUTHORING_PATH";
const SIGNING_KEY_PATH_ENV: &str = "REPLAY_POLICY_CATALOG_SIGNING_KEY_PATH";
const OUTPUT_PATH_ENV: &str = "REPLAY_POLICY_CATALOG_SEALED_COMMAND_OUTPUT_PATH";
const MAX_AUTHORING_BYTES: usize = 64 * 1024;

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
    let signing_key = read_ed25519_signing_key(
        Path::new(&required_env(SIGNING_KEY_PATH_ENV)?),
        "Catalog signing key",
    )?;
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

fn lower_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
