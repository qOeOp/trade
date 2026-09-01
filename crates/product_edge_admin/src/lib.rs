use serde::{Deserialize, Serialize};
use sqlx::{Connection, Row};
use vibe_operator_authorization::{
    ExpiredManifestRecoveryEpochV1, OperatorAuthorizationExpiredManifestRecoveryProposalV1,
    OperatorAuthorizationIssuerPostgresV1, OperatorAuthorizationLocatorV1,
    OperatorAuthorizationReadbackV1,
};
use vibe_product_edge::{
    AgentOperationManifestProposalV1, ProductEdgeAuthorizationTrustV1,
    ProductEdgeExpiredManifestRecoveryProposalV1, ProductEdgePostgresOwnerV1,
    ProductEdgeSuccessorProposalV1,
};

pub const EXPIRED_MANIFEST_RECOVERY_ADMIN_SCHEMA_V1: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExpiredManifestRecoveryAdminConfigV1 {
    pub schema_version: u32,
    pub postgresql_target: ExpiredManifestRecoveryPostgresqlTargetV1,
    pub operator_authorization: OperatorAuthorizationExpiredManifestRecoveryProposalV1,
    pub product_edge: ProductEdgeExpiredManifestRecoveryTemplateV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExpiredManifestRecoveryPostgresqlTargetV1 {
    pub database_name: String,
    pub operator_authorization_role: String,
    pub product_edge_role: String,
    pub system_identifier: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductEdgeExpiredManifestRecoveryTemplateV1 {
    pub recovery_epoch: ExpiredManifestRecoveryEpochV1,
    pub successor: ProductEdgeRecoverySuccessorTemplateV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductEdgeRecoverySuccessorTemplateV1 {
    pub deployment_identity: String,
    pub binding_identity: String,
    pub predecessor_binding_identity: String,
    pub expected_history_head: String,
    pub generation: u64,
    pub effective_principal: String,
    pub scope_policy_version: String,
    pub capability_policy_version: String,
    pub audit_policy_version: String,
    pub valid_from_epoch_ms: u64,
    pub valid_through_epoch_ms: u64,
    pub manifests: Vec<AgentOperationManifestProposalV1>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecoveryRuntimeBindingV1 {
    pub deployment_identity: String,
    pub request_proof_digest: String,
    pub trust: ProductEdgeAuthorizationTrustV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ExpiredManifestRecoveryAdminReceiptV1 {
    schema_version: u32,
    recovery_epoch_identity: String,
    recovery_epoch_digest: String,
    operator_authorization: OperatorAuthorizationLocatorV1,
    product_edge: ProductEdgeRecoveryBindingLocatorV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProductEdgeRecoveryBindingLocatorV1 {
    deployment_identity: String,
    binding_identity: String,
    generation: u64,
    history_head_identity: String,
}

pub fn parse_expired_manifest_recovery_config(
    bytes: &[u8],
) -> anyhow::Result<ExpiredManifestRecoveryAdminConfigV1> {
    Ok(serde_json::from_slice(bytes)?)
}

impl ExpiredManifestRecoveryAdminConfigV1 {
    pub fn validate(&self, runtime: &RecoveryRuntimeBindingV1) -> anyhow::Result<()> {
        if self.schema_version != EXPIRED_MANIFEST_RECOVERY_ADMIN_SCHEMA_V1 {
            anyhow::bail!("unsupported expired manifest recovery admin schema");
        }
        self.postgresql_target.validate()?;
        self.operator_authorization.validate()?;
        runtime.trust.validate()?;

        if self.operator_authorization.recovery_epoch != self.product_edge.recovery_epoch {
            anyhow::bail!("Operator Authorization and Product Edge recovery epochs differ");
        }

        let authorization = &self.operator_authorization.successor;
        let successor = &self.product_edge.successor;
        if successor.deployment_identity != runtime.deployment_identity {
            anyhow::bail!("recovery deployment does not match configured Product Edge deployment");
        }

        if authorization.issuer_identity != runtime.trust.issuer_identity
            || authorization.issuer_key_version != runtime.trust.issuer_key_version
            || authorization.scope.audience != runtime.trust.audience
        {
            anyhow::bail!("recovery authorization does not match configured Product Edge trust");
        }

        if authorization.request_proof_digest != runtime.request_proof_digest {
            anyhow::bail!("recovery authorization request proof does not match runtime secret");
        }

        if authorization.scope.principal != successor.effective_principal
            || authorization.not_before_epoch_ms != successor.valid_from_epoch_ms
            || authorization.valid_through_epoch_ms != successor.valid_through_epoch_ms
        {
            anyhow::bail!("recovery authorization and Product Edge identity/time bounds differ");
        }

        if successor.manifests.iter().any(|manifest| {
            manifest.capability_policy_digest != successor.capability_policy_version
        }) {
            anyhow::bail!(
                "Product Edge manifest capability policy differs from its binding policy"
            );
        }

        self.product_edge
            .proposal(validation_locator())
            .validate()?;
        Ok(())
    }
}

impl ExpiredManifestRecoveryPostgresqlTargetV1 {
    fn validate(&self) -> anyhow::Result<()> {
        if self.database_name.trim().is_empty()
            || self.operator_authorization_role.trim().is_empty()
            || self.product_edge_role.trim().is_empty()
            || self.system_identifier.trim().is_empty()
        {
            anyhow::bail!("recovery PostgreSQL target fields must be nonempty");
        }

        if self.operator_authorization_role == self.product_edge_role {
            anyhow::bail!("recovery PostgreSQL Owner roles must be distinct");
        }
        Ok(())
    }
}

impl ProductEdgeExpiredManifestRecoveryTemplateV1 {
    fn proposal(
        &self,
        authorization: OperatorAuthorizationLocatorV1,
    ) -> ProductEdgeExpiredManifestRecoveryProposalV1 {
        ProductEdgeExpiredManifestRecoveryProposalV1 {
            recovery_epoch: self.recovery_epoch.clone(),
            successor: self.successor.proposal(authorization),
        }
    }
}

impl ProductEdgeRecoverySuccessorTemplateV1 {
    fn proposal(
        &self,
        authorization: OperatorAuthorizationLocatorV1,
    ) -> ProductEdgeSuccessorProposalV1 {
        ProductEdgeSuccessorProposalV1 {
            deployment_identity: self.deployment_identity.clone(),
            binding_identity: self.binding_identity.clone(),
            predecessor_binding_identity: self.predecessor_binding_identity.clone(),
            expected_history_head: self.expected_history_head.clone(),
            generation: self.generation,
            effective_principal: self.effective_principal.clone(),
            scope_policy_version: self.scope_policy_version.clone(),
            capability_policy_version: self.capability_policy_version.clone(),
            audit_policy_version: self.audit_policy_version.clone(),
            valid_from_epoch_ms: self.valid_from_epoch_ms,
            valid_through_epoch_ms: self.valid_through_epoch_ms,
            authorization,
            manifests: self.manifests.clone(),
        }
    }
}

pub async fn recover_expired_manifests(
    config: ExpiredManifestRecoveryAdminConfigV1,
    runtime: RecoveryRuntimeBindingV1,
    operator_authorization_database_url: &str,
    product_edge_database_url: &str,
) -> anyhow::Result<ExpiredManifestRecoveryAdminReceiptV1> {
    config.validate(&runtime)?;

    require_recovery_postgresql_target(
        &config.postgresql_target,
        operator_authorization_database_url,
        product_edge_database_url,
    )
    .await?;

    let issuer =
        OperatorAuthorizationIssuerPostgresV1::connect(operator_authorization_database_url).await?;
    let authorization = issuer
        .recover_expired_manifests(config.operator_authorization.clone())
        .await?;
    require_exact_authorization_readback(&config, &authorization)?;

    let authorization_locator = authorization.locator();
    let proposal = config.product_edge.proposal(authorization_locator.clone());
    let product_edge = ProductEdgePostgresOwnerV1::connect(
        product_edge_database_url,
        &runtime.deployment_identity,
        runtime.trust,
    )
    .await?;
    let binding = product_edge.recover_expired_manifests(proposal).await?;
    if binding.deployment_identity() != config.product_edge.successor.deployment_identity
        || binding.binding_identity() != config.product_edge.successor.binding_identity
        || binding.generation() != config.product_edge.successor.generation
        || binding.authorization().locator() != authorization_locator
    {
        anyhow::bail!("Product Edge recovery returned a mismatched canonical readback");
    }

    Ok(ExpiredManifestRecoveryAdminReceiptV1 {
        schema_version: EXPIRED_MANIFEST_RECOVERY_ADMIN_SCHEMA_V1,
        recovery_epoch_identity: config
            .operator_authorization
            .recovery_epoch
            .recovery_epoch_identity
            .clone(),
        recovery_epoch_digest: config
            .operator_authorization
            .recovery_epoch
            .recovery_epoch_digest
            .clone(),
        operator_authorization: authorization_locator,
        product_edge: ProductEdgeRecoveryBindingLocatorV1 {
            deployment_identity: binding.deployment_identity().to_string(),
            binding_identity: binding.binding_identity().to_string(),
            generation: binding.generation(),
            history_head_identity: binding.history_head_identity().to_string(),
        },
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ObservedPostgresqlTargetV1 {
    database_name: String,
    role: String,
    system_identifier: String,
}

async fn require_recovery_postgresql_target(
    expected: &ExpiredManifestRecoveryPostgresqlTargetV1,
    operator_authorization_database_url: &str,
    product_edge_database_url: &str,
) -> anyhow::Result<()> {
    let operator_authorization =
        read_postgresql_target(operator_authorization_database_url).await?;
    let product_edge = read_postgresql_target(product_edge_database_url).await?;

    require_observed_postgresql_targets(expected, &operator_authorization, &product_edge)
}

fn require_observed_postgresql_targets(
    expected: &ExpiredManifestRecoveryPostgresqlTargetV1,
    operator_authorization: &ObservedPostgresqlTargetV1,
    product_edge: &ObservedPostgresqlTargetV1,
) -> anyhow::Result<()> {
    if operator_authorization.database_name != expected.database_name
        || operator_authorization.role != expected.operator_authorization_role
        || operator_authorization.system_identifier != expected.system_identifier
    {
        anyhow::bail!("Operator Authorization PostgreSQL target does not match recovery config");
    }

    if product_edge.database_name != expected.database_name
        || product_edge.role != expected.product_edge_role
        || product_edge.system_identifier != expected.system_identifier
    {
        anyhow::bail!("Product Edge PostgreSQL target does not match recovery config");
    }

    if operator_authorization.database_name != product_edge.database_name
        || operator_authorization.system_identifier != product_edge.system_identifier
    {
        anyhow::bail!("recovery PostgreSQL Owner targets do not share one authority database");
    }
    Ok(())
}

async fn read_postgresql_target(database_url: &str) -> anyhow::Result<ObservedPostgresqlTargetV1> {
    let mut connection = sqlx::PgConnection::connect(database_url).await?;
    let mut transaction = connection.begin().await?;
    sqlx::query("SET TRANSACTION READ ONLY")
        .execute(&mut *transaction)
        .await?;
    let row = sqlx::query(
        "SELECT current_database()::text AS database_name, current_user::text AS role_name, system_identifier::text AS system_identifier FROM pg_control_system()",
    )
    .fetch_one(&mut *transaction)
    .await?;
    let observed = ObservedPostgresqlTargetV1 {
        database_name: row.try_get("database_name")?,
        role: row.try_get("role_name")?,
        system_identifier: row.try_get("system_identifier")?,
    };
    transaction.rollback().await?;
    Ok(observed)
}

fn require_exact_authorization_readback(
    config: &ExpiredManifestRecoveryAdminConfigV1,
    readback: &OperatorAuthorizationReadbackV1,
) -> anyhow::Result<()> {
    let expected = &config.operator_authorization.successor;
    if readback.locator().authorization_identity != expected.authorization_identity
        || readback.issuer_identity() != expected.issuer_identity
        || readback.issuer_key_version() != expected.issuer_key_version
        || readback.scope() != &expected.scope
        || readback.request_proof_digest() != expected.request_proof_digest
        || readback.operation_manifests() != expected.operation_manifests
        || readback.not_before_epoch_ms() != expected.not_before_epoch_ms
        || readback.valid_through_epoch_ms() != expected.valid_through_epoch_ms
        || readback.recovery_epoch() != Some(&config.operator_authorization.recovery_epoch)
    {
        anyhow::bail!("Operator Authorization recovery returned a mismatched canonical readback");
    }
    Ok(())
}

fn validation_locator() -> OperatorAuthorizationLocatorV1 {
    OperatorAuthorizationLocatorV1 {
        authorization_identity: "prewrite-validation-only".to_string(),
        issuance_receipt_identity: "prewrite-validation-only".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;
    use vibe_operator_authorization::{
        ExpiredManifestRecoveryTransitionV1, ManifestSemanticKeyV1, OperationManifestBindingV1,
        OperatorAuthorizationIssuanceProposalV1, OperatorAuthorizationScopeV1,
    };

    fn manifest_binding(
        manifest: &AgentOperationManifestProposalV1,
    ) -> anyhow::Result<OperationManifestBindingV1> {
        Ok(OperationManifestBindingV1 {
            manifest_identity: manifest.manifest_identity()?,
            manifest_digest: manifest.manifest_digest()?,
        })
    }

    fn manifest(operation: &str, from: u64, through: u64) -> AgentOperationManifestProposalV1 {
        AgentOperationManifestProposalV1 {
            operation: operation.to_string(),
            operation_schema: format!("{operation}.schema.v1"),
            target_owner: "R_AND_D".to_string(),
            allowed_effects: vec!["R_AND_D_RESEARCH_MUTATION_V1".to_string()],
            prohibited_effects: vec![
                "LIVE_TRADING_V1".to_string(),
                "PROTECTED_FEEDBACK_DETAIL_V1".to_string(),
                "REAL_TRADING_V1".to_string(),
            ],
            capability_policy_digest: "capability-policy-v2".to_string(),
            effective_from_epoch_ms: from,
            valid_through_epoch_ms: through,
        }
    }

    fn config() -> ExpiredManifestRecoveryAdminConfigV1 {
        let old = manifest("research.submit.v1", 10, 20);
        let new = manifest("research.submit.v1", 20, 30);
        let epoch = ExpiredManifestRecoveryEpochV1::new(vec![
            ExpiredManifestRecoveryTransitionV1::Retained {
                semantic_key: ManifestSemanticKeyV1 {
                    operation: old.operation.clone(),
                    operation_schema: old.operation_schema.clone(),
                    target_owner: old.target_owner.clone(),
                },
                predecessor_manifest: manifest_binding(&old).unwrap(),
                successor_manifest: manifest_binding(&new).unwrap(),
            },
        ])
        .unwrap();
        let successor_bindings = epoch.successor_operation_manifests();
        ExpiredManifestRecoveryAdminConfigV1 {
            schema_version: 1,
            postgresql_target: ExpiredManifestRecoveryPostgresqlTargetV1 {
                database_name: "authority".to_string(),
                operator_authorization_role: "operator_authorization_owner".to_string(),
                product_edge_role: "product_edge_owner".to_string(),
                system_identifier: "7257365662980929064".to_string(),
            },
            operator_authorization: OperatorAuthorizationExpiredManifestRecoveryProposalV1 {
                recovery_epoch: epoch.clone(),
                predecessor_authorization: OperatorAuthorizationLocatorV1 {
                    authorization_identity: "authorization-1".to_string(),
                    issuance_receipt_identity: "issuance-1".to_string(),
                },
                expected_current_frontier_identity: "frontier-1".to_string(),
                successor: OperatorAuthorizationIssuanceProposalV1 {
                    authorization_identity: "authorization-2".to_string(),
                    issuer_identity: "issuer-1".to_string(),
                    issuer_key_version: "key-1".to_string(),
                    scope: OperatorAuthorizationScopeV1 {
                        principal: "principal-1".to_string(),
                        audience: "R_AND_D".to_string(),
                        permissions: vec!["research:submit".to_string()],
                    },
                    request_proof_digest: "sha256:proof".to_string(),
                    operation_manifests: successor_bindings,
                    not_before_epoch_ms: 20,
                    valid_through_epoch_ms: 30,
                    expected_revocation_head: "EMPTY".to_string(),
                },
            },
            product_edge: ProductEdgeExpiredManifestRecoveryTemplateV1 {
                recovery_epoch: epoch,
                successor: ProductEdgeRecoverySuccessorTemplateV1 {
                    deployment_identity: "deployment-1".to_string(),
                    binding_identity: "binding-2".to_string(),
                    predecessor_binding_identity: "binding-1".to_string(),
                    expected_history_head: "binding-1".to_string(),
                    generation: 2,
                    effective_principal: "principal-1".to_string(),
                    scope_policy_version: "scope-policy-v1".to_string(),
                    capability_policy_version: "capability-policy-v2".to_string(),
                    audit_policy_version: "audit-policy-v1".to_string(),
                    valid_from_epoch_ms: 20,
                    valid_through_epoch_ms: 30,
                    manifests: vec![new],
                },
            },
        }
    }

    fn runtime() -> RecoveryRuntimeBindingV1 {
        RecoveryRuntimeBindingV1 {
            deployment_identity: "deployment-1".to_string(),
            request_proof_digest: "sha256:proof".to_string(),
            trust: ProductEdgeAuthorizationTrustV1 {
                issuer_identity: "issuer-1".to_string(),
                issuer_key_version: "key-1".to_string(),
                audience: "R_AND_D".to_string(),
            },
        }
    }

    #[rstest]
    fn exact_config_parses_and_prevalidates_without_owner_writes() {
        let config = config();
        let bytes = serde_json::to_vec(&config).unwrap();
        let parsed = parse_expired_manifest_recovery_config(&bytes).unwrap();
        assert_eq!(parsed, config);
        parsed.validate(&runtime()).unwrap();
    }

    #[rstest]
    fn parser_rejects_unknown_top_level_fields() {
        let value = serde_json::json!({
            "schema_version": 1,
            "postgresql_target": config().postgresql_target,
            "operator_authorization": config().operator_authorization,
            "product_edge": config().product_edge,
            "unexpected": true,
        });
        assert!(
            parse_expired_manifest_recovery_config(&serde_json::to_vec(&value).unwrap()).is_err()
        );

        let mut nested = serde_json::to_value(config()).unwrap();
        nested["product_edge"]["successor"]["unexpected"] = serde_json::json!(true);
        assert!(
            parse_expired_manifest_recovery_config(&serde_json::to_vec(&nested).unwrap()).is_err()
        );

        let mut missing_target = serde_json::to_value(config()).unwrap();
        missing_target
            .as_object_mut()
            .unwrap()
            .remove("postgresql_target");
        assert!(
            parse_expired_manifest_recovery_config(&serde_json::to_vec(&missing_target).unwrap())
                .is_err()
        );
    }

    #[rstest]
    fn prevalidation_rejects_epoch_manifest_and_runtime_cross_splices() {
        let mut mismatched_epoch = config();
        mismatched_epoch
            .product_edge
            .recovery_epoch
            .recovery_epoch_identity = "changed".to_string();
        assert!(mismatched_epoch.validate(&runtime()).is_err());

        let mut mismatched_manifest = config();
        mismatched_manifest.product_edge.successor.manifests[0].operation = "other".to_string();
        assert!(mismatched_manifest.validate(&runtime()).is_err());

        let mut mismatched_runtime = runtime();
        mismatched_runtime.request_proof_digest = "sha256:other".to_string();
        assert!(config().validate(&mismatched_runtime).is_err());

        let mut mismatched_deployment = runtime();
        mismatched_deployment.deployment_identity = "other".to_string();
        assert!(config().validate(&mismatched_deployment).is_err());

        let mut mismatched_trust = runtime();
        mismatched_trust.trust.issuer_key_version = "other".to_string();
        assert!(config().validate(&mismatched_trust).is_err());
    }

    #[rstest]
    fn prevalidation_rejects_identity_time_and_policy_mismatch() {
        let mut identity = config();
        identity.product_edge.successor.effective_principal = "other".to_string();
        assert!(identity.validate(&runtime()).is_err());

        let mut time = config();
        time.product_edge.successor.valid_from_epoch_ms = 21;
        assert!(time.validate(&runtime()).is_err());

        let mut policy = config();
        policy.product_edge.successor.capability_policy_version = "other".to_string();
        assert!(policy.validate(&runtime()).is_err());
    }

    #[rstest]
    fn prevalidation_rejects_postgresql_target_cross_splices() {
        let mut empty_database = config();
        empty_database.postgresql_target.database_name = " ".to_string();
        assert!(empty_database.validate(&runtime()).is_err());

        let mut empty_system = config();
        empty_system.postgresql_target.system_identifier.clear();
        assert!(empty_system.validate(&runtime()).is_err());

        let mut empty_role = config();
        empty_role
            .postgresql_target
            .operator_authorization_role
            .clear();
        assert!(empty_role.validate(&runtime()).is_err());

        let mut same_role = config();
        same_role.postgresql_target.product_edge_role = same_role
            .postgresql_target
            .operator_authorization_role
            .clone();
        assert!(same_role.validate(&runtime()).is_err());
    }

    #[rstest]
    fn prewrite_readback_rejects_postgresql_target_cross_splices() {
        let expected = config().postgresql_target;
        let operator_authorization = ObservedPostgresqlTargetV1 {
            database_name: expected.database_name.clone(),
            role: expected.operator_authorization_role.clone(),
            system_identifier: expected.system_identifier.clone(),
        };
        let product_edge = ObservedPostgresqlTargetV1 {
            database_name: expected.database_name.clone(),
            role: expected.product_edge_role.clone(),
            system_identifier: expected.system_identifier.clone(),
        };
        require_observed_postgresql_targets(&expected, &operator_authorization, &product_edge)
            .unwrap();

        let mut wrong_role = product_edge.clone();
        wrong_role.role = operator_authorization.role.clone();
        assert!(
            require_observed_postgresql_targets(&expected, &operator_authorization, &wrong_role,)
                .is_err()
        );

        let mut wrong_database = product_edge.clone();
        wrong_database.database_name = "other".to_string();
        assert!(
            require_observed_postgresql_targets(
                &expected,
                &operator_authorization,
                &wrong_database,
            )
            .is_err()
        );

        let mut wrong_system = operator_authorization;
        wrong_system.system_identifier = "other".to_string();
        assert!(
            require_observed_postgresql_targets(&expected, &wrong_system, &product_edge).is_err()
        );
    }
}
