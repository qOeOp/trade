//! An admitted Product Edge deployment for acceptance proofs that need one to exist first.
//!
//! Sealed behind `sealed-deployment-acceptance`: no production build compiles it. It creates
//! nothing a production path could not: it issues a genesis Operator Authorization through
//! [`OperatorAuthorizationIssuerPostgresV1::issue_genesis`] and bootstraps a deployment through
//! [`ProductEdgePostgresOwnerV1::bootstrap_genesis`], both over `connect_existing`, so the
//! deployment carries every check those Owners make. Requests are then admitted with the
//! deployment's own `admit_*` calls, through [`ProductEdgeDeploymentAcceptanceFixtureV1::connect_owner`].
//!
//! Every identity derives from the caller's `fixture_key`, and the validity window is fixed, so
//! ensuring the same key twice proposes the same authorization and the same binding: each Owner
//! answers its own exact replay with what it already holds, and a key first ensured with other
//! content is refused by that Owner as a conflicting replay, which is returned by name.
//!
//! A deployment's operations are fixed at genesis (its genesis is refused once it has history,
//! and a successor authorization may differ only in identity and lifetime), so the caller passes
//! every operation it will admit. One key per caller keeps callers from sharing a history head.
//!
//! A research entry, for example, binds the source-intake and research-goal operations:
//!
//! ```ignore
//! let deployment = ensure_product_edge_deployment_acceptance_fixture_v1(
//!     &operator_authorization_database_url,
//!     &product_edge_database_url,
//!     &DeploymentAcceptanceProposalV1 {
//!         fixture_key: "research-entry-17".into(),
//!         audience: SOURCE_INTAKE_TARGET_OWNER_V1.into(),
//!         permissions: vec!["research:submit".into(), "research:view".into()],
//!         operations: vec![
//!             DeploymentAcceptanceOperationV1 {
//!                 operation: SOURCE_INTAKE_OPERATION_V1.into(),
//!                 operation_schema: SOURCE_INTAKE_OPERATION_SCHEMA_V1.into(),
//!                 allowed_effects: SOURCE_INTAKE_REQUIRED_EFFECTS_V1.map(Into::into).to_vec(),
//!             },
//!             DeploymentAcceptanceOperationV1 {
//!                 operation: RESEARCH_GOAL_OPERATION_V2.into(),
//!                 operation_schema: RESEARCH_GOAL_SCHEMA_V2.into(),
//!                 allowed_effects: vec!["R_AND_D_RESEARCH_MUTATION_V1".into()],
//!             },
//!         ],
//!     },
//! )
//! .await?;
//! let edge = deployment.connect_owner(&product_edge_database_url).await?;
//! ```

use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_operator_authorization::{
    OperationManifestBindingV1, OperatorAuthorizationError,
    OperatorAuthorizationIssuanceProposalV1, OperatorAuthorizationIssuerPostgresV1,
    OperatorAuthorizationLocatorV1, OperatorAuthorizationScopeV1,
};

use crate::{
    AgentOperationManifestProposalV1, AgentOperationManifestSetV1, ProductEdgeAuthorizationTrustV1,
    ProductEdgeBootstrapProposalV1, ProductEdgeError, ProductEdgePostgresOwnerV1,
};

/// 2026-01-01T00:00:00Z. Fixed, so a second ensure proposes exactly what the first committed.
const VALID_FROM_EPOCH_MS: u64 = 1_767_225_600_000;
/// 2036-01-01T00:00:00Z. Neither Owner caps a lifetime; each only orders the binding inside the
/// authorization and the manifests around the binding, which one shared window satisfies.
const VALID_THROUGH_EPOCH_MS: u64 = 2_082_758_400_000;
const ISSUER_IDENTITY: &str = "operator-authorization-issuer-acceptance-v1";
const ISSUER_KEY_VERSION: &str = "acceptance-key-v1";

/// The request proof the authorization is issued with and every admission into these deployments
/// presents. It is a canonical digest, `sha256:` and 64 lowercase hex digits, because consumers
/// such as Source Intake refuse any other shape; it is the SHA-256 of a fixed domain string.
fn request_proof_digest() -> String {
    format!(
        "sha256:{:x}",
        Sha256::digest(b"vibe-product-edge/deployment-acceptance/request-proof/v1")
    )
}

/// One operation the deployment may admit, bound at genesis.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeploymentAcceptanceOperationV1 {
    pub operation: String,
    pub operation_schema: String,
    pub allowed_effects: Vec<String>,
}

/// What a caller asks for. `fixture_key` is the caller's identity for this deployment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeploymentAcceptanceProposalV1 {
    pub fixture_key: String,
    /// The Owner every operation targets, and the authorization's audience.
    pub audience: String,
    pub permissions: Vec<String>,
    pub operations: Vec<DeploymentAcceptanceOperationV1>,
}

/// An operation as the deployment bound it: its manifest's identity and digest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeploymentAcceptanceBoundOperationV1 {
    pub operation: DeploymentAcceptanceOperationV1,
    pub manifest: OperationManifestBindingV1,
}

/// Everything a later fixture needs to admit its own requests into this deployment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProductEdgeDeploymentAcceptanceFixtureV1 {
    pub deployment_identity: String,
    pub binding_identity: String,
    pub binding_generation: u64,
    pub principal: String,
    pub audience: String,
    pub permissions: Vec<String>,
    pub authorization: OperatorAuthorizationLocatorV1,
    pub authorization_trust: ProductEdgeAuthorizationTrustV1,
    /// The request proof the authorization was issued with; every admission into this deployment
    /// presents the same one.
    pub request_proof_digest: String,
    pub operations: Vec<DeploymentAcceptanceBoundOperationV1>,
    pub valid_from_epoch_ms: u64,
    pub valid_through_epoch_ms: u64,
}

impl ProductEdgeDeploymentAcceptanceFixtureV1 {
    /// The deployment's Product Edge Owner, through which its `admit_*` calls are made.
    pub async fn connect_owner(
        &self,
        product_edge_database_url: &str,
    ) -> Result<ProductEdgePostgresOwnerV1, ProductEdgeError> {
        ProductEdgePostgresOwnerV1::connect_existing(
            product_edge_database_url,
            &self.deployment_identity,
            self.authorization_trust.clone(),
        )
        .await
    }

    /// The bound operation named `operation`, so a caller can refuse by name when it is missing.
    pub fn operation(&self, operation: &str) -> Option<&DeploymentAcceptanceBoundOperationV1> {
        self.operations
            .iter()
            .find(|bound| bound.operation.operation == operation)
    }
}

#[derive(Debug, Error)]
pub enum DeploymentAcceptanceFixtureErrorV1 {
    /// The key was ensured before with a different audience, permissions or operations, which the
    /// named Owner refused as a conflicting replay of what it holds.
    #[error(
        "fixture key {fixture_key} already names a deployment with other content ({owner} refused the replay)"
    )]
    DeploymentExistsWithDifferentContent {
        fixture_key: String,
        owner: &'static str,
    },
    /// The store clock is outside the fixed window: the deployment cannot admit anything.
    #[error(
        "deployment {deployment_identity} is not current at {owner_now_epoch_ms}: valid from {valid_from_epoch_ms} through {valid_through_epoch_ms}"
    )]
    BindingNotCurrent {
        deployment_identity: String,
        owner_now_epoch_ms: u64,
        valid_from_epoch_ms: u64,
        valid_through_epoch_ms: u64,
    },
    #[error(transparent)]
    OperatorAuthorization(OperatorAuthorizationError),
    #[error(transparent)]
    ProductEdge(ProductEdgeError),
}

/// Ensures the deployment `proposal.fixture_key` names exists, admitted and current, and returns
/// its handle. Idempotent for the same proposal; see the module documentation.
pub async fn ensure_product_edge_deployment_acceptance_fixture_v1(
    operator_authorization_database_url: &str,
    product_edge_database_url: &str,
    proposal: &DeploymentAcceptanceProposalV1,
) -> Result<ProductEdgeDeploymentAcceptanceFixtureV1, DeploymentAcceptanceFixtureErrorV1> {
    let key = &proposal.fixture_key;
    let principal = format!("acceptance-principal-{key}");
    let deployment_identity = format!("acceptance-deployment-{key}");
    let binding_identity = format!("acceptance-binding-{key}");
    let manifests = proposal
        .operations
        .iter()
        .map(|operation| AgentOperationManifestProposalV1 {
            operation: operation.operation.clone(),
            operation_schema: operation.operation_schema.clone(),
            target_owner: proposal.audience.clone(),
            allowed_effects: operation.allowed_effects.clone(),
            prohibited_effects: vec!["REAL_TRADING_V1".to_string()],
            capability_policy_digest: format!("sha256:{}", "c".repeat(64)),
            effective_from_epoch_ms: VALID_FROM_EPOCH_MS,
            valid_through_epoch_ms: VALID_THROUGH_EPOCH_MS,
        })
        .collect::<Vec<_>>();
    let mut operations = Vec::with_capacity(manifests.len());
    for (operation, manifest) in proposal.operations.iter().zip(&manifests) {
        operations.push(DeploymentAcceptanceBoundOperationV1 {
            operation: operation.clone(),
            manifest: OperationManifestBindingV1 {
                manifest_identity: manifest
                    .manifest_identity()
                    .map_err(DeploymentAcceptanceFixtureErrorV1::ProductEdge)?,
                manifest_digest: manifest
                    .manifest_digest()
                    .map_err(DeploymentAcceptanceFixtureErrorV1::ProductEdge)?,
            },
        });
    }
    // Operator Authorization requires its manifest bindings in identity order.
    let mut manifest_bindings = operations
        .iter()
        .map(|bound| bound.manifest.clone())
        .collect::<Vec<_>>();
    manifest_bindings.sort_by(|a, b| a.manifest_identity.cmp(&b.manifest_identity));

    let issuer = OperatorAuthorizationIssuerPostgresV1::connect_existing(
        operator_authorization_database_url,
    )
    .await
    .map_err(DeploymentAcceptanceFixtureErrorV1::OperatorAuthorization)?;
    let authorization = issuer
        .issue_genesis(OperatorAuthorizationIssuanceProposalV1 {
            authorization_identity: format!("acceptance-authorization-{key}"),
            issuer_identity: ISSUER_IDENTITY.to_string(),
            issuer_key_version: ISSUER_KEY_VERSION.to_string(),
            scope: OperatorAuthorizationScopeV1 {
                principal: principal.clone(),
                audience: proposal.audience.clone(),
                permissions: proposal.permissions.clone(),
            },
            request_proof_digest: request_proof_digest(),
            operation_manifests: manifest_bindings,
            not_before_epoch_ms: VALID_FROM_EPOCH_MS,
            valid_through_epoch_ms: VALID_THROUGH_EPOCH_MS,
            expected_revocation_head: "EMPTY".to_string(),
        })
        .await
        .map_err(|e| match e {
            OperatorAuthorizationError::ConflictingReplay => {
                DeploymentAcceptanceFixtureErrorV1::DeploymentExistsWithDifferentContent {
                    fixture_key: key.clone(),
                    owner: "Operator Authorization",
                }
            }
            e => DeploymentAcceptanceFixtureErrorV1::OperatorAuthorization(e),
        })?
        .locator();

    let authorization_trust = ProductEdgeAuthorizationTrustV1 {
        issuer_identity: ISSUER_IDENTITY.to_string(),
        issuer_key_version: ISSUER_KEY_VERSION.to_string(),
        audience: proposal.audience.clone(),
    };
    let edge = ProductEdgePostgresOwnerV1::connect_existing(
        product_edge_database_url,
        &deployment_identity,
        authorization_trust.clone(),
    )
    .await
    .map_err(DeploymentAcceptanceFixtureErrorV1::ProductEdge)?;
    let owner_now_epoch_ms = edge
        .store_clock_ms()
        .await
        .map_err(DeploymentAcceptanceFixtureErrorV1::ProductEdge)?;
    if !(VALID_FROM_EPOCH_MS..VALID_THROUGH_EPOCH_MS).contains(&owner_now_epoch_ms) {
        return Err(DeploymentAcceptanceFixtureErrorV1::BindingNotCurrent {
            deployment_identity,
            owner_now_epoch_ms,
            valid_from_epoch_ms: VALID_FROM_EPOCH_MS,
            valid_through_epoch_ms: VALID_THROUGH_EPOCH_MS,
        });
    }
    let readback = edge
        .bootstrap_genesis(ProductEdgeBootstrapProposalV1 {
            deployment_identity: deployment_identity.clone(),
            binding_identity: binding_identity.clone(),
            expected_history_head: "EMPTY".to_string(),
            generation: 1,
            effective_principal: principal.clone(),
            scope_policy_version: "acceptance-scope-v1".to_string(),
            capability_policy_version: "acceptance-capability-v1".to_string(),
            audit_policy_version: "acceptance-audit-v1".to_string(),
            valid_from_epoch_ms: VALID_FROM_EPOCH_MS,
            valid_through_epoch_ms: VALID_THROUGH_EPOCH_MS,
            authorization: authorization.clone(),
            manifests: AgentOperationManifestSetV1::new(manifests)
                .map_err(DeploymentAcceptanceFixtureErrorV1::ProductEdge)?,
        })
        .await
        .map_err(|e| match e {
            ProductEdgeError::ConflictingReplay => {
                DeploymentAcceptanceFixtureErrorV1::DeploymentExistsWithDifferentContent {
                    fixture_key: key.clone(),
                    owner: "Product Edge",
                }
            }
            e => DeploymentAcceptanceFixtureErrorV1::ProductEdge(e),
        })?;

    Ok(ProductEdgeDeploymentAcceptanceFixtureV1 {
        deployment_identity,
        binding_identity,
        binding_generation: readback.generation(),
        principal,
        audience: proposal.audience.clone(),
        permissions: proposal.permissions.clone(),
        authorization,
        authorization_trust,
        request_proof_digest: request_proof_digest(),
        operations,
        valid_from_epoch_ms: VALID_FROM_EPOCH_MS,
        valid_through_epoch_ms: VALID_THROUGH_EPOCH_MS,
    })
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use rstest::rstest;
    use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

    use super::*;
    use crate::ProductEdgeAdmissionRequestV1;

    const AUDIENCE: &str = "DEPLOYMENT_ACCEPTANCE_PROBE";

    fn operation(name: &str) -> DeploymentAcceptanceOperationV1 {
        DeploymentAcceptanceOperationV1 {
            operation: format!("deployment_acceptance.{name}.v1"),
            operation_schema: format!("deployment-acceptance-{name}-v1"),
            allowed_effects: vec![format!("DEPLOYMENT_ACCEPTANCE_{}_V1", name.to_uppercase())],
        }
    }

    fn proposal(key: &str, operations: &[&str]) -> DeploymentAcceptanceProposalV1 {
        DeploymentAcceptanceProposalV1 {
            fixture_key: key.to_string(),
            audience: AUDIENCE.to_string(),
            permissions: vec!["deployment-acceptance:probe".to_string()],
            operations: operations.iter().map(|name| operation(name)).collect(),
        }
    }

    fn request(
        deployment: &ProductEdgeDeploymentAcceptanceFixtureV1,
        identity: &str,
        operation: &DeploymentAcceptanceOperationV1,
    ) -> ProductEdgeAdmissionRequestV1 {
        ProductEdgeAdmissionRequestV1 {
            request_identity: identity.to_string(),
            typed_payload: serde_json::json!({ "request_identity": identity }),
            operation: operation.operation.clone(),
            operation_schema: operation.operation_schema.clone(),
            target_owner: AUDIENCE.to_string(),
            requested_effects: operation.allowed_effects.clone(),
            request_proof_digest: deployment.request_proof_digest.clone(),
            audit_correlation: format!("acceptance:{identity}"),
        }
    }

    /// Source Intake's own check, `validate_digest`, refuses anything but `sha256:` and 64
    /// lowercase hex digits; the first version of this fixture presented `sha256:acceptance-proof`
    /// and every research entry built on it would have been refused before admitting anything.
    #[rstest]
    fn the_request_proof_is_a_canonical_sha256_digest() {
        let digest = request_proof_digest();
        assert_eq!(digest.len(), 71, "{digest}");
        assert!(digest.starts_with("sha256:"), "{digest}");
        assert!(
            digest[7..]
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)),
            "{digest}"
        );
    }

    /// The ordered chain's database is never reset, so every run takes its own keys.
    fn run_key(name: &str) -> String {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("epoch")
            .as_nanos();
        format!("{name}-{nanos}")
    }

    /// Ensure creates an admitted, current deployment that admits its bound operations; ensuring
    /// the same key again returns the same deployment; the same key with other operations is
    /// refused by name; a second key in the same store gets a deployment of its own.
    #[rstest]
    #[tokio::test]
    #[ignore = "requires the disposable canonical OA/PE PostgreSQL topology"]
    async fn deployment_fixture_is_admitted_idempotent_and_refuses_other_content_by_name() {
        let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let oa_url =
            test_database.database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter);
        let pe_url = test_database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner);
        let key = run_key("probe");

        let first = ensure_product_edge_deployment_acceptance_fixture_v1(
            oa_url,
            pe_url,
            &proposal(&key, &["alpha"]),
        )
        .await
        .unwrap();
        assert_eq!(first.binding_generation, 1);
        assert!(first.operation(&operation("alpha").operation).is_some());
        assert!(first.operation(&operation("beta").operation).is_none());

        // Acceptance state, not only the absence of an error: the bound operation is admitted and
        // the Owner resolves the admission it recorded. A fixture that refused everything, or
        // returned a handle to nothing, fails here.
        let edge = first.connect_owner(pe_url).await.unwrap();
        let admitted = edge
            .admit_request(request(
                &first,
                &format!("{key}-alpha"),
                &operation("alpha"),
            ))
            .await
            .unwrap();
        let resolved = edge
            .resolve_admission(&format!("{key}-alpha"), &first.request_proof_digest)
            .await
            .unwrap()
            .expect("the admission the Owner just recorded");
        assert_eq!(resolved.locator(), admitted.locator());

        // An operation the deployment did not bind at genesis is not admitted.
        assert!(
            edge.admit_request(request(&first, &format!("{key}-beta"), &operation("beta")))
                .await
                .is_err()
        );

        let again = ensure_product_edge_deployment_acceptance_fixture_v1(
            oa_url,
            pe_url,
            &proposal(&key, &["alpha"]),
        )
        .await
        .unwrap();
        assert_eq!(again, first);

        let widened = ensure_product_edge_deployment_acceptance_fixture_v1(
            oa_url,
            pe_url,
            &proposal(&key, &["alpha", "beta"]),
        )
        .await;
        assert!(
            matches!(
                &widened,
                Err(DeploymentAcceptanceFixtureErrorV1::DeploymentExistsWithDifferentContent {
                    fixture_key,
                    ..
                }) if fixture_key == &key
            ),
            "{widened:?}"
        );

        // History is per deployment: another key in the same store has its own genesis.
        let other = ensure_product_edge_deployment_acceptance_fixture_v1(
            oa_url,
            pe_url,
            &proposal(&run_key("other"), &["alpha", "beta"]),
        )
        .await
        .unwrap();
        assert_ne!(other.deployment_identity, first.deployment_identity);
        assert_eq!(other.binding_generation, 1);
        assert!(other.operation(&operation("beta").operation).is_some());
    }
}
