//! Publishes one sealed deployment-store publication into the custody store, as the publisher
//! principal.
//!
//! Run on the administrator's side, never in the stack: the publisher's credential stays with the
//! administrator, and the stack's custodian cannot publish. The sealed file is re-read byte for byte
//! and both signatures are re-verified before anything is written. Only `PUBLISHED` or `REPLAYED`
//! exits zero; a head mismatch or a conflict wrote nothing and exits non-zero, naming which it was.

use std::{
    io::{self, Write},
    path::Path,
};

use serde::Serialize;
use vibe_data::owner::{
    DeploymentStorePublishOutcomeV1, publish_sealed_deployment_store_publication_v1,
};
use vibe_strategy_factory_rd_owner_api::{required_env, signing_key_file::read_bounded_file};

const SEALED_PATH_ENV: &str = "DEPLOYMENT_STORE_SEALED_PUBLICATION_PATH";
const PUBLISHER_DATABASE_URL_ENV: &str = "DEPLOYMENT_STORE_PUBLISHER_DATABASE_URL";
const MAX_SEALED_BYTES: usize = 256 * 1024;

#[derive(Serialize)]
struct PublishReceiptV1 {
    outcome: DeploymentStorePublishOutcomeV1,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    if std::env::args().nth(1).is_some() {
        anyhow::bail!("the deployment-store publisher accepts no command-line arguments");
    }
    let sealed = read_bounded_file(
        Path::new(&required_env(SEALED_PATH_ENV)?),
        MAX_SEALED_BYTES,
        "Sealed deployment-store publication",
    )?;
    let outcome = publish_sealed_deployment_store_publication_v1(
        &required_env(PUBLISHER_DATABASE_URL_ENV)?,
        &sealed,
    )
    .await
    .map_err(|e| anyhow::anyhow!("deployment-store publication was not published: {e}"))?;
    let mut stdout = io::stdout().lock();
    stdout.write_all(&serde_json::to_vec(&PublishReceiptV1 { outcome })?)?;
    stdout.write_all(b"\n")?;

    match outcome {
        DeploymentStorePublishOutcomeV1::Published | DeploymentStorePublishOutcomeV1::Replayed => {
            Ok(())
        }
        DeploymentStorePublishOutcomeV1::HeadMismatch => anyhow::bail!(
            "the current head is not the one this publication expects; nothing was written"
        ),
        DeploymentStorePublishOutcomeV1::Conflict => anyhow::bail!(
            "another manifest or head already holds this identity or generation; nothing was written"
        ),
    }
}
