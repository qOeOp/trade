//! Measures the deployment's store and completes an administrator's draft into the authoring
//! `deployment-store-publication-seal` reads.
//!
//! Run it where the deployment reaches its store, in the stack's own network: the endpoint and TLS
//! identities a manifest binds are the view from there, so a measurement taken from anywhere else
//! would never be admitted. It connects over TLS pinned to the root the deployment pins, as the
//! credential in the secret file the deployment leases, and writes nothing to the store. The secret
//! is read from its file and never printed; the authoring it writes names the file and the digest of
//! its bytes, not its contents.

use std::{
    fs::OpenOptions,
    io::{self, Write},
    path::Path,
};

use anyhow::Context;
use vibe_data::owner::author_deployment_store_publication_v1;
use vibe_strategy_factory_rd_owner_api::{required_env, signing_key_file::read_bounded_file};

const DRAFT_PATH_ENV: &str = "DEPLOYMENT_STORE_PUBLICATION_DRAFT_PATH";
const LEASED_FILE_PATH_ENV: &str = "DEPLOYMENT_STORE_LEASED_FILE_PATH";
const ROOT_CERTIFICATE_PATH_ENV: &str = "DEPLOYMENT_STORE_POSTGRES_ROOT_CERTIFICATE_PATH";
const OUTPUT_PATH_ENV: &str = "DEPLOYMENT_STORE_PUBLICATION_AUTHORING_OUTPUT_PATH";
const MAX_DRAFT_BYTES: usize = 64 * 1024;
// The deployment's own bounds on the files it reads (`credential_files::read_regular_file`), so a
// publication is never authored from a file the deployment would refuse.
const MAX_CREDENTIAL_BYTES: usize = 4 * 1024;
const MAX_ROOT_CERTIFICATE_BYTES: usize = 4 * 1024;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    if std::env::args().nth(1).is_some() {
        anyhow::bail!("the deployment-store publication author accepts no command-line arguments");
    }
    let draft = read_bounded_file(
        Path::new(&required_env(DRAFT_PATH_ENV)?),
        MAX_DRAFT_BYTES,
        "Deployment-store publication draft",
    )?;
    let credential_path = required_env(LEASED_FILE_PATH_ENV)?;
    // The handle a manifest names is the file's name in the deployment's secrets directory.
    let credential_identity = Path::new(&credential_path)
        .file_name()
        .and_then(|name| name.to_str())
        .context("the credential path names a file")?
        .to_owned();
    let credential = read_bounded_file(
        Path::new(&credential_path),
        MAX_CREDENTIAL_BYTES,
        "Deployment-store credential",
    )?;
    let root = read_bounded_file(
        Path::new(&required_env(ROOT_CERTIFICATE_PATH_ENV)?),
        MAX_ROOT_CERTIFICATE_BYTES,
        "Deployment-store PostgreSQL root certificate",
    )?;
    let output_path = required_env(OUTPUT_PATH_ENV)?;
    let authoring =
        author_deployment_store_publication_v1(&draft, &credential_identity, &credential, &root)
            .await
            .map_err(|e| anyhow::anyhow!("deployment-store publication was not authored: {e}"))?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&output_path)
        .with_context(|| format!("authoring output {output_path} must not already exist"))?;
    output.write_all(&authoring)?;
    output.write_all(b"\n")?;
    let mut stdout = io::stdout().lock();
    writeln!(stdout, "authored {output_path}")?;
    Ok(())
}
