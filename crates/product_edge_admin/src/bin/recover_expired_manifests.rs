use std::{env, fs};

use sha2::{Digest, Sha256};
use vibe_product_edge::ProductEdgeAuthorizationTrustV1;
use vibe_product_edge_admin::{
    RecoveryRuntimeBindingV1, parse_expired_manifest_recovery_config, recover_expired_manifests,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config_path = env::args()
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("missing expired manifest recovery config path"))?;
    let config = parse_expired_manifest_recovery_config(&fs::read(config_path)?)?;
    let request_proof_digest = {
        let request_proof = env::var("RD_OWNER_API_TOKEN")?;
        format!("sha256:{:x}", Sha256::digest(request_proof.as_bytes()))
    };
    let runtime = RecoveryRuntimeBindingV1 {
        deployment_identity: env::var("PRODUCT_EDGE_DEPLOYMENT_IDENTITY")?,
        request_proof_digest,
        trust: ProductEdgeAuthorizationTrustV1 {
            issuer_identity: env::var("PRODUCT_EDGE_TRUSTED_ISSUER_IDENTITY")?,
            issuer_key_version: env::var("PRODUCT_EDGE_TRUSTED_ISSUER_KEY_VERSION")?,
            audience: env::var("PRODUCT_EDGE_TRUSTED_AUTHORIZATION_AUDIENCE")?,
        },
    };
    let receipt = recover_expired_manifests(
        config,
        runtime,
        &env::var("OPERATOR_AUTHORIZATION_DATABASE_URL")?,
        &env::var("PRODUCT_EDGE_DATABASE_URL")?,
    )
    .await?;
    println!("{}", serde_json::to_string(&receipt)?);
    Ok(())
}
