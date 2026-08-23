use std::{env, fs};

use vibe_product_edge::{
    ProductEdgeAuthorizationTrustV1, ProductEdgeBootstrapProposalV1, ProductEdgePostgresOwnerV1,
    ProductEdgeSuccessorProposalV1,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let action = env::args()
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("missing action"))?;
    let proposal_path = env::args()
        .nth(2)
        .ok_or_else(|| anyhow::anyhow!("missing proposal path"))?;
    let database_url = env::var("PRODUCT_EDGE_DATABASE_URL")
        .map_err(|_| anyhow::anyhow!("PRODUCT_EDGE_DATABASE_URL is missing"))?;
    let deployment_identity = env::var("PRODUCT_EDGE_DEPLOYMENT_IDENTITY")
        .map_err(|_| anyhow::anyhow!("PRODUCT_EDGE_DEPLOYMENT_IDENTITY is missing"))?;
    let bytes = fs::read(proposal_path)?;
    let owner = ProductEdgePostgresOwnerV1::connect(
        &database_url,
        deployment_identity,
        ProductEdgeAuthorizationTrustV1 {
            issuer_identity: env::var("PRODUCT_EDGE_TRUSTED_ISSUER_IDENTITY")?,
            issuer_key_version: env::var("PRODUCT_EDGE_TRUSTED_ISSUER_KEY_VERSION")?,
            audience: env::var("PRODUCT_EDGE_TRUSTED_AUTHORIZATION_AUDIENCE")?,
        },
    )
    .await?;
    let value = match action.as_str() {
        "bootstrap-genesis" => serde_json::to_value(
            owner
                .bootstrap_genesis(serde_json::from_slice::<ProductEdgeBootstrapProposalV1>(
                    &bytes,
                )?)
                .await?,
        )?,
        "activate-successor" => serde_json::to_value(
            owner
                .activate_successor(serde_json::from_slice::<ProductEdgeSuccessorProposalV1>(
                    &bytes,
                )?)
                .await?,
        )?,
        _ => anyhow::bail!("unsupported action"),
    };
    println!("{}", serde_json::to_string(&value)?);
    Ok(())
}
