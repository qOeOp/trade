use std::{env, fs};

use serde::Deserialize;
use sha2::{Digest, Sha256};
use vibe_operator_authorization::{
    OperationManifestBindingV1, OperatorAuthorizationIssuanceProposalV1,
    OperatorAuthorizationIssuerPostgresV1, OperatorAuthorizationScopeV1,
};
use vibe_product_edge::{
    AgentOperationManifestProposalV1, ProductEdgeAuthorizationTrustV1,
    ProductEdgeBootstrapProposalV1, ProductEdgePostgresOwnerV1, SOURCE_INTAKE_OPERATION_SCHEMA_V1,
    SOURCE_INTAKE_OPERATION_V1, SOURCE_INTAKE_REQUIRED_EFFECTS_V1, SOURCE_INTAKE_TARGET_OWNER_V1,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BootstrapConfigV1 {
    authorization_identity: String,
    issuer_identity: String,
    issuer_key_version: String,
    authorization_audience: String,
    deployment_identity: String,
    binding_identity: String,
    effective_principal: String,
    scope_policy_version: String,
    capability_policy_digest: String,
    audit_policy_version: String,
    valid_from_epoch_ms: u64,
    valid_through_epoch_ms: u64,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config_path = env::args()
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("missing bootstrap config path"))?;
    let config: BootstrapConfigV1 = serde_json::from_slice(&fs::read(config_path)?)?;
    let issuer_url = env::var("OPERATOR_AUTHORIZATION_DATABASE_URL")?;
    let product_edge_url = env::var("PRODUCT_EDGE_DATABASE_URL")?;
    let request_proof = env::var("RD_OWNER_API_TOKEN")?;
    let request_proof_digest = format!("sha256:{:x}", Sha256::digest(request_proof.as_bytes()));
    let trust = ProductEdgeAuthorizationTrustV1 {
        issuer_identity: env::var("PRODUCT_EDGE_TRUSTED_ISSUER_IDENTITY")?,
        issuer_key_version: env::var("PRODUCT_EDGE_TRUSTED_ISSUER_KEY_VERSION")?,
        audience: env::var("PRODUCT_EDGE_TRUSTED_AUTHORIZATION_AUDIENCE")?,
    };

    if config.issuer_identity != trust.issuer_identity
        || config.issuer_key_version != trust.issuer_key_version
        || config.authorization_audience != trust.audience
    {
        anyhow::bail!("bootstrap issuance does not match configured Product Edge trust");
    }

    let mut manifests = vec![
        manifest(
            "research_goal.submit_or_resolve.v2",
            "sourced-research-goal-v2",
            "R_AND_D",
            vec!["R_AND_D_RESEARCH_MUTATION_V1".to_string()],
            &config,
        ),
        manifest(
            "artifact_build.submit_or_resolve.v1",
            "rd-artifact-build-request-v1",
            "R_AND_D",
            vec![
                "R_AND_D_ARTIFACT_BUILD_MUTATION_V1".to_string(),
                "R_AND_D_PROVIDER_INVOCATION_V1".to_string(),
            ],
            &config,
        ),
        manifest(
            SOURCE_INTAKE_OPERATION_V1,
            SOURCE_INTAKE_OPERATION_SCHEMA_V1,
            SOURCE_INTAKE_TARGET_OWNER_V1,
            SOURCE_INTAKE_REQUIRED_EFFECTS_V1
                .into_iter()
                .map(str::to_string)
                .collect(),
            &config,
        ),
    ];
    manifests.sort_by_key(|manifest| manifest.manifest_identity().expect("validated manifest"));
    let manifest_bindings = manifests
        .iter()
        .map(|manifest| {
            Ok(OperationManifestBindingV1 {
                manifest_identity: manifest.manifest_identity()?,
                manifest_digest: manifest.manifest_digest()?,
            })
        })
        .collect::<Result<Vec<_>, vibe_product_edge::ProductEdgeError>>()?;

    let issuer = OperatorAuthorizationIssuerPostgresV1::connect(&issuer_url).await?;
    let authorization = issuer
        .issue_genesis(OperatorAuthorizationIssuanceProposalV1 {
            authorization_identity: config.authorization_identity,
            issuer_identity: config.issuer_identity,
            issuer_key_version: config.issuer_key_version,
            scope: OperatorAuthorizationScopeV1 {
                principal: config.effective_principal.clone(),
                audience: config.authorization_audience,
                permissions: vec![
                    "research:artifact-build".to_string(),
                    "research:source-intake".to_string(),
                    "research:submit".to_string(),
                    "research:view".to_string(),
                ],
            },
            request_proof_digest,
            operation_manifests: manifest_bindings,
            not_before_epoch_ms: config.valid_from_epoch_ms,
            valid_through_epoch_ms: config.valid_through_epoch_ms,
            expected_revocation_head: "EMPTY".to_string(),
        })
        .await?;
    let product_edge =
        ProductEdgePostgresOwnerV1::connect(&product_edge_url, &config.deployment_identity, trust)
            .await?;
    let binding = product_edge
        .bootstrap_genesis(ProductEdgeBootstrapProposalV1 {
            deployment_identity: config.deployment_identity,
            binding_identity: config.binding_identity,
            expected_history_head: "EMPTY".to_string(),
            generation: 1,
            effective_principal: config.effective_principal,
            scope_policy_version: config.scope_policy_version,
            capability_policy_version: config.capability_policy_digest.clone(),
            audit_policy_version: config.audit_policy_version,
            valid_from_epoch_ms: config.valid_from_epoch_ms,
            valid_through_epoch_ms: config.valid_through_epoch_ms,
            authorization: authorization.locator(),
            manifests,
        })
        .await?;
    println!("{}", serde_json::to_string(&binding)?);
    Ok(())
}

fn manifest(
    operation: &str,
    operation_schema: &str,
    target_owner: &str,
    allowed_effects: Vec<String>,
    config: &BootstrapConfigV1,
) -> AgentOperationManifestProposalV1 {
    AgentOperationManifestProposalV1 {
        operation: operation.to_string(),
        operation_schema: operation_schema.to_string(),
        target_owner: target_owner.to_string(),
        allowed_effects,
        prohibited_effects: vec![
            "LIVE_TRADING_V1".to_string(),
            "PROTECTED_FEEDBACK_DETAIL_V1".to_string(),
            "REAL_TRADING_V1".to_string(),
        ],
        capability_policy_digest: config.capability_policy_digest.clone(),
        effective_from_epoch_ms: config.valid_from_epoch_ms,
        valid_through_epoch_ms: config.valid_through_epoch_ms,
    }
}
