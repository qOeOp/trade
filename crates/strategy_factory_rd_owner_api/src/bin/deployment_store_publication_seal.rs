//! Seals one authored deployment-store publication: a store manifest and the head that makes it
//! current, both signed with the store signing key.
//!
//! Run on the administrator's machine, never in the stack. The key file holds the Ed25519 seed whose
//! public half the deployment pins as its store signer. It is a key of its own, not the Replay Policy
//! Catalog's. This binary reads it from a private file, never prints it, refuses to overwrite an
//! existing sealed publication, and the sealer it calls proves the sealed bytes verify under the key's
//! public half before anything is written.

use std::{
    fs::OpenOptions,
    io::{self, Write},
    path::Path,
};

use anyhow::Context;
use vibe_data::owner::seal_deployment_store_publication_v1;
use vibe_strategy_factory_rd_owner_api::{
    required_env,
    signing_key_file::{read_bounded_file, read_ed25519_signing_key},
};

const AUTHORING_PATH_ENV: &str = "DEPLOYMENT_STORE_PUBLICATION_AUTHORING_PATH";
const SIGNING_KEY_PATH_ENV: &str = "DEPLOYMENT_STORE_SIGNING_KEY_PATH";
const OUTPUT_PATH_ENV: &str = "DEPLOYMENT_STORE_SEALED_PUBLICATION_OUTPUT_PATH";
const MAX_AUTHORING_BYTES: usize = 64 * 1024;

fn main() -> anyhow::Result<()> {
    if std::env::args().nth(1).is_some() {
        anyhow::bail!("the deployment-store publication sealer accepts no command-line arguments");
    }
    let authoring = read_bounded_file(
        Path::new(&required_env(AUTHORING_PATH_ENV)?),
        MAX_AUTHORING_BYTES,
        "Deployment-store publication authoring",
    )?;
    let signing_key = read_ed25519_signing_key(
        Path::new(&required_env(SIGNING_KEY_PATH_ENV)?),
        "Deployment-store signing key",
    )?;
    let output_path = required_env(OUTPUT_PATH_ENV)?;
    let (sealed, summary) = seal_deployment_store_publication_v1(&authoring, &signing_key)
        .map_err(|e| anyhow::anyhow!("deployment-store publication was not sealed: {e}"))?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&output_path)
        .with_context(|| {
            format!("sealed publication output {output_path} must not already exist")
        })?;
    output.write_all(&sealed)?;
    output.write_all(b"\n")?;
    let mut stdout = io::stdout().lock();
    stdout.write_all(&serde_json::to_vec(&summary)?)?;
    stdout.write_all(b"\n")?;
    Ok(())
}
