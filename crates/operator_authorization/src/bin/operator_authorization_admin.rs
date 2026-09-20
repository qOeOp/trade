use std::{env, fs};

use vibe_operator_authorization::{
    OperatorAuthorizationIssuanceProposalV1, OperatorAuthorizationIssuerPostgresV1,
    OperatorAuthorizationRevocationProposalV1, OperatorAuthorizationSuccessorIssuanceProposalV1,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let action = env::args()
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("missing action"))?;
    let database_url = env::var("OPERATOR_AUTHORIZATION_DATABASE_URL")
        .map_err(|_| anyhow::anyhow!("OPERATOR_AUTHORIZATION_DATABASE_URL is missing"))?;

    // Provisioning is its own action, and it is the only one that writes DDL.
    if action == "materialize-schema" {
        OperatorAuthorizationIssuerPostgresV1::materialize_schema(&database_url).await?;
        println!("{}", serde_json::json!({"materialized": true}));
        return Ok(());
    }

    let proposal_path = env::args()
        .nth(2)
        .ok_or_else(|| anyhow::anyhow!("missing proposal path"))?;
    let bytes = fs::read(proposal_path)?;
    // Issuing a grant is not provisioning: this connects to a topology someone
    // already materialized, and refuses if nobody has.
    let owner = OperatorAuthorizationIssuerPostgresV1::connect_existing(&database_url).await?;
    let value = match action.as_str() {
        "issue-genesis" => serde_json::to_value(
            owner
                .issue_genesis(serde_json::from_slice::<
                    OperatorAuthorizationIssuanceProposalV1,
                >(&bytes)?)
                .await?,
        )?,
        "issue-successor" => serde_json::to_value(
            owner
                .issue_successor(serde_json::from_slice::<
                    OperatorAuthorizationSuccessorIssuanceProposalV1,
                >(&bytes)?)
                .await?,
        )?,
        "revoke" => serde_json::to_value(
            owner
                .revoke(serde_json::from_slice::<
                    OperatorAuthorizationRevocationProposalV1,
                >(&bytes)?)
                .await?,
        )?,
        _ => anyhow::bail!("unsupported action"),
    };
    println!("{}", serde_json::to_string(&value)?);
    Ok(())
}
