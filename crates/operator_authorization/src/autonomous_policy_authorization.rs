//! Autonomous Policy Authorization: the grant an unattended lifecycle
//! decision must bind before any Paper or Live add-risk intent exists.
//!
//! `docs/architecture/product-edge.md` names its fields: policy identity and
//! version, principal and scope, strategy generation and Execution Scope,
//! permitted intent and action classes, capital-policy bounds, effective and
//! expiry times, revocation frontier, and admitted operation manifest. It is
//! one more kind of the shared grant shape; Strategy Governance consumes it as
//! `UntrustedAutonomousPolicyReadback` and never mints it.

use serde::{Deserialize, Serialize};

use crate::{
    ExecutionModeV1, GrantContentV1, GrantIssuanceProposalV1, GrantLocatorV1, GrantReadbackV1,
    GrantResolutionV1, GrantRevocationFrontierV1, GrantRevocationProposalV1,
    GrantSuccessorProposalV1, GrantUnavailableReasonV1, OperationManifestBindingV1,
    OperatorAuthorizationError, OperatorAuthorizationScopeV1, UntrustedCanonicalGrantEvidenceV1,
    canonical_digest, grant, is_sha256_digest,
};

pub const AUTONOMOUS_POLICY_AUTHORIZATION_SCHEMA_V1: u32 = 1;
pub const STRATEGY_GOVERNANCE_AUDIENCE_V1: &str = "STRATEGY_GOVERNANCE";

/// The seven canonical Strategy Governance lifecycle actions.
pub const LIFECYCLE_ACTIONS_V1: [&str; 7] = [
    "DE_RISK",
    "INITIAL_ACTIVATION",
    "PAUSE",
    "PROMOTION",
    "RECOVERY",
    "REDUCTION",
    "RETIREMENT",
];

/// The versioned policy an authorization is issued under.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AutonomousPolicyV1 {
    pub policy_identity: String,
    pub policy_version: String,
}

/// The exact Governance capital policy an authorization is bounded by. The
/// bounds themselves live in the content-addressed envelope Strategy
/// Governance owns; the authorization binds that envelope, never a copy of
/// its numbers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CapitalPolicyBindingV1 {
    pub envelope_identity: String,
    pub envelope_version: String,
    pub envelope_digest: String,
}

/// The resource one Autonomous Policy Authorization history belongs to.
///
/// Successor authorizations renew this exact resource; a different principal,
/// request scope, account, mode, generation, Execution Scope, or policy is a
/// different history with its own genesis and revocation frontier.
///
/// The request scope is the second half of the "principal and scope" the
/// architecture requires this authorization to bind. Strategy Governance
/// compares it against the lifecycle request's own scope, so it has to be a
/// coordinate the Issuer signed: a value a reader could supply would make that
/// comparison compare the request with itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AutonomousPolicyResourceV1 {
    pub principal: String,
    pub request_scope_identity: String,
    pub audience: String,
    pub account_identity: String,
    pub execution_mode: ExecutionModeV1,
    pub strategy_generation_identity: String,
    pub execution_scope_identity: String,
    pub policy_identity: String,
}

impl AutonomousPolicyResourceV1 {
    pub fn validate(&self) -> Result<(), OperatorAuthorizationError> {
        if self.principal.trim().is_empty()
            || self.request_scope_identity.trim().is_empty()
            || self.audience != STRATEGY_GOVERNANCE_AUDIENCE_V1
            || self.account_identity.trim().is_empty()
            || self.strategy_generation_identity.trim().is_empty()
            || self.execution_scope_identity.trim().is_empty()
            || self.policy_identity.trim().is_empty()
        {
            return Err(OperatorAuthorizationError::InvalidProposal(
                "autonomous policy resource coordinates",
            ));
        }
        Ok(())
    }

    pub fn digest(&self) -> Result<String, OperatorAuthorizationError> {
        self.validate()?;
        canonical_digest("operator-authorization.autonomous-policy-resource.v1", self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AutonomousPolicyAuthorizationContentV1 {
    pub issuer_identity: String,
    pub issuer_key_version: String,
    pub policy: AutonomousPolicyV1,
    pub scope: OperatorAuthorizationScopeV1,
    pub request_scope_identity: String,
    pub account_identity: String,
    pub execution_mode: ExecutionModeV1,
    pub strategy_generation_identity: String,
    pub execution_scope_identity: String,
    pub permitted_actions: Vec<String>,
    pub permitted_intent_classes: Vec<String>,
    pub capital_policy: CapitalPolicyBindingV1,
    pub operation_manifest: OperationManifestBindingV1,
    pub effective_at_epoch_ms: u64,
    pub valid_through_epoch_ms: u64,
}

impl AutonomousPolicyAuthorizationContentV1 {
    pub fn resource(&self) -> AutonomousPolicyResourceV1 {
        AutonomousPolicyResourceV1 {
            principal: self.scope.principal.clone(),
            request_scope_identity: self.request_scope_identity.clone(),
            audience: self.scope.audience.clone(),
            account_identity: self.account_identity.clone(),
            execution_mode: self.execution_mode,
            strategy_generation_identity: self.strategy_generation_identity.clone(),
            execution_scope_identity: self.execution_scope_identity.clone(),
            policy_identity: self.policy.policy_identity.clone(),
        }
    }

    pub fn validate(&self) -> Result<(), OperatorAuthorizationError> {
        self.scope.validate()?;
        self.resource().validate()?;

        if self.issuer_identity.trim().is_empty()
            || self.issuer_key_version.trim().is_empty()
            || self.policy.policy_version.trim().is_empty()
            || self.permitted_actions.is_empty()
            || !sorted_unique(&self.permitted_actions)
            || self
                .permitted_actions
                .iter()
                .any(|action| !LIFECYCLE_ACTIONS_V1.contains(&action.as_str()))
            || self.permitted_intent_classes.is_empty()
            || self
                .permitted_intent_classes
                .iter()
                .any(|class| class.trim().is_empty())
            || !sorted_unique(&self.permitted_intent_classes)
            || self.capital_policy.envelope_identity.trim().is_empty()
            || self.capital_policy.envelope_version.trim().is_empty()
            || !is_sha256_digest(&self.capital_policy.envelope_digest)
            || self.operation_manifest.manifest_identity.trim().is_empty()
            || !is_sha256_digest(&self.operation_manifest.manifest_digest)
            || self.effective_at_epoch_ms >= self.valid_through_epoch_ms
        {
            return Err(OperatorAuthorizationError::InvalidProposal(
                "autonomous policy authorization content",
            ));
        }
        Ok(())
    }

    pub fn content_digest(&self) -> Result<String, OperatorAuthorizationError> {
        self.validate()?;
        canonical_digest(&Self::content_digest_domain(), self)
    }

    pub fn grant_identity(&self) -> Result<String, OperatorAuthorizationError> {
        Ok(grant::grant_identity_for::<Self>(&self.content_digest()?))
    }

    pub fn permits_action(&self, action: &str) -> bool {
        self.permitted_actions.iter().any(|item| item == action)
    }

    pub fn permits_intent_class(&self, class: &str) -> bool {
        self.permitted_intent_classes
            .iter()
            .any(|item| item == class)
    }
}

fn sorted_unique(values: &[String]) -> bool {
    values.windows(2).all(|pair| pair[0] < pair[1])
}

impl GrantContentV1 for AutonomousPolicyAuthorizationContentV1 {
    type Expected<'a> = (
        &'a AutonomousPolicyResourceV1,
        &'a OperationManifestBindingV1,
    );

    const KIND_STEM: &'static str = "autonomous-policy-authorization";
    const TABLE_STEM: &'static str = "autonomous_policy_authorization";
    const SCHEMA_VERSION: u32 = AUTONOMOUS_POLICY_AUTHORIZATION_SCHEMA_V1;
    // Strategy Governance is the intended reader of this kind, but the
    // deployment topology does not define a Governance database role yet, so
    // there is nothing to grant EXECUTE to. When
    // `product/rd-workbench/postgres-init/10-migrate-authority-custody.sh`
    // defines that role, it belongs in this list. Adding it is a shared-surface
    // change; leaving it out keeps the lock function closed rather than open.
    const CONSUMER_ROLES: &'static str = "product_edge_owner, operator_authorization_writer";
    const MIRROR_COLUMNS: &'static [&'static str] = &[
        "principal",
        "request_scope_identity",
        "audience",
        "account_identity",
        "execution_mode",
        "strategy_generation_identity",
        "execution_scope_identity",
        "policy_identity",
        "policy_version",
    ];

    fn validate(&self) -> Result<(), OperatorAuthorizationError> {
        Self::validate(self)
    }

    fn grant_identity(&self) -> Result<String, OperatorAuthorizationError> {
        Self::grant_identity(self)
    }

    fn resource_digest(&self) -> Result<String, OperatorAuthorizationError> {
        self.resource().digest()
    }

    fn issuer_identity(&self) -> &str {
        &self.issuer_identity
    }

    fn issuer_key_version(&self) -> &str {
        &self.issuer_key_version
    }

    fn effective_at_epoch_ms(&self) -> u64 {
        self.effective_at_epoch_ms
    }

    fn valid_through_epoch_ms(&self) -> u64 {
        self.valid_through_epoch_ms
    }

    fn same_resource(&self, other: &Self) -> bool {
        self.resource() == other.resource()
    }

    fn mirror_values(&self) -> Result<Vec<String>, OperatorAuthorizationError> {
        Ok(vec![
            self.scope.principal.clone(),
            self.request_scope_identity.clone(),
            self.scope.audience.clone(),
            self.account_identity.clone(),
            self.execution_mode.as_str().to_string(),
            self.strategy_generation_identity.clone(),
            self.execution_scope_identity.clone(),
            self.policy.policy_identity.clone(),
            self.policy.policy_version.clone(),
        ])
    }

    fn resource_matches(&self, expected: &Self::Expected<'_>) -> bool {
        &self.resource() == expected.0
    }

    fn manifest_matches(&self, expected: &Self::Expected<'_>) -> bool {
        &self.operation_manifest == expected.1
    }
}

pub type AutonomousPolicyAuthorizationIssuanceProposalV1 =
    GrantIssuanceProposalV1<AutonomousPolicyAuthorizationContentV1>;
pub type AutonomousPolicyAuthorizationLocatorV1 = GrantLocatorV1;
pub type AutonomousPolicyAuthorizationSuccessorProposalV1 =
    GrantSuccessorProposalV1<AutonomousPolicyAuthorizationContentV1>;
pub type AutonomousPolicyAuthorizationRevocationProposalV1 = GrantRevocationProposalV1;
pub type AutonomousPolicyAuthorizationRevocationFrontierV1 = GrantRevocationFrontierV1;
pub type AutonomousPolicyAuthorizationReadbackV1 =
    GrantReadbackV1<AutonomousPolicyAuthorizationContentV1>;
pub type UntrustedCanonicalAutonomousPolicyAuthorizationEvidenceV1 =
    UntrustedCanonicalGrantEvidenceV1<AutonomousPolicyAuthorizationContentV1>;
pub type AutonomousPolicyAuthorizationUnavailableReasonV1 = GrantUnavailableReasonV1;
pub type AutonomousPolicyAuthorizationResolutionV1 =
    GrantResolutionV1<AutonomousPolicyAuthorizationContentV1>;

impl UntrustedCanonicalAutonomousPolicyAuthorizationEvidenceV1 {
    pub fn matches_resource(&self, expected: &AutonomousPolicyResourceV1) -> bool {
        &self.content.resource() == expected
    }

    pub fn matches_operation_manifest(&self, expected: &OperationManifestBindingV1) -> bool {
        &self.content.operation_manifest == expected
    }
}

/// What a consumer supplies to resolve one authorization: the locator it was
/// handed plus the resource and operation manifest it independently expects.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AutonomousPolicyAuthorizationReadRequestV1 {
    pub locator: AutonomousPolicyAuthorizationLocatorV1,
    pub expected_resource: AutonomousPolicyResourceV1,
    pub expected_manifest: OperationManifestBindingV1,
}

impl AutonomousPolicyAuthorizationReadRequestV1 {
    pub fn validate(&self) -> Result<(), OperatorAuthorizationError> {
        self.expected_resource.validate()?;

        if self.locator.validate().is_err()
            || self.expected_manifest.manifest_identity.trim().is_empty()
            || !is_sha256_digest(&self.expected_manifest.manifest_digest)
        {
            return Err(OperatorAuthorizationError::InvalidProposal(
                "autonomous policy authorization read",
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use rstest::rstest;

    use super::*;

    pub(crate) fn content() -> AutonomousPolicyAuthorizationContentV1 {
        AutonomousPolicyAuthorizationContentV1 {
            issuer_identity: "issuer-v1".into(),
            issuer_key_version: "key-v1".into(),
            policy: AutonomousPolicyV1 {
                policy_identity: "policy-paper-v1".into(),
                policy_version: "1".into(),
            },
            scope: OperatorAuthorizationScopeV1 {
                principal: "principal-v1".into(),
                audience: STRATEGY_GOVERNANCE_AUDIENCE_V1.into(),
                permissions: vec!["governance:unattended".into()],
            },
            request_scope_identity: "request-scope-v1".into(),
            account_identity: "account-v1".into(),
            execution_mode: ExecutionModeV1::Paper,
            strategy_generation_identity: "generation-v1".into(),
            execution_scope_identity: format!("sha256:{}", "e".repeat(64)),
            permitted_actions: vec!["INITIAL_ACTIVATION".into(), "PROMOTION".into()],
            permitted_intent_classes: vec!["ADD_RISK".into()],
            capital_policy: CapitalPolicyBindingV1 {
                envelope_identity: "envelope-v1".into(),
                envelope_version: "1".into(),
                envelope_digest: format!("sha256:{}", "c".repeat(64)),
            },
            operation_manifest: OperationManifestBindingV1 {
                manifest_identity: "manifest-v1".into(),
                manifest_digest: format!("sha256:{}", "a".repeat(64)),
            },
            effective_at_epoch_ms: 10,
            valid_through_epoch_ms: 1_000,
        }
    }

    #[rstest]
    fn content_binds_every_product_edge_field_and_fails_closed_on_each() {
        type Mutation = Box<dyn Fn(&mut AutonomousPolicyAuthorizationContentV1)>;
        let original = content();
        let identity = original.grant_identity().unwrap();
        assert_eq!(original.grant_identity().unwrap(), identity);
        assert!(identity.starts_with("operator-authorization-autonomous-policy-authorization-v1-"));

        let mutations: Vec<(&str, Mutation, bool)> = vec![
            (
                "issuer",
                Box::new(|c| c.issuer_identity.push_str("-x")),
                true,
            ),
            (
                "key",
                Box::new(|c| c.issuer_key_version.push_str("-x")),
                true,
            ),
            (
                "policy identity",
                Box::new(|c| c.policy.policy_identity.push_str("-x")),
                true,
            ),
            (
                "policy version",
                Box::new(|c| c.policy.policy_version.push_str("-x")),
                true,
            ),
            (
                "principal",
                Box::new(|c| c.scope.principal.push_str("-x")),
                true,
            ),
            (
                "request scope",
                Box::new(|c| c.request_scope_identity.push_str("-x")),
                true,
            ),
            (
                "audience",
                Box::new(|c| c.scope.audience = "R_AND_D".into()),
                false,
            ),
            (
                "account",
                Box::new(|c| c.account_identity.push_str("-x")),
                true,
            ),
            (
                "mode",
                Box::new(|c| c.execution_mode = ExecutionModeV1::Live),
                true,
            ),
            (
                "generation",
                Box::new(|c| c.strategy_generation_identity.push_str("-x")),
                true,
            ),
            (
                "execution scope",
                Box::new(|c| c.execution_scope_identity.push_str("-x")),
                true,
            ),
            (
                "actions",
                Box::new(|c| c.permitted_actions = vec!["PAUSE".into()]),
                true,
            ),
            (
                "unknown action",
                Box::new(|c| c.permitted_actions = vec!["TRADE".into()]),
                false,
            ),
            (
                "unsorted actions",
                Box::new(|c| c.permitted_actions.reverse()),
                false,
            ),
            (
                "no actions",
                Box::new(|c| c.permitted_actions.clear()),
                false,
            ),
            (
                "intent classes",
                Box::new(|c| c.permitted_intent_classes.push("REDUCE_RISK".into())),
                true,
            ),
            (
                "no intent classes",
                Box::new(|c| c.permitted_intent_classes.clear()),
                false,
            ),
            (
                "envelope identity",
                Box::new(|c| c.capital_policy.envelope_identity.push_str("-x")),
                true,
            ),
            (
                "envelope version",
                Box::new(|c| c.capital_policy.envelope_version.push_str("-x")),
                true,
            ),
            (
                "envelope digest",
                Box::new(|c| c.capital_policy.envelope_digest.replace_range(7..8, "d")),
                true,
            ),
            (
                "bad envelope digest",
                Box::new(|c| c.capital_policy.envelope_digest = "x".into()),
                false,
            ),
            (
                "manifest identity",
                Box::new(|c| c.operation_manifest.manifest_identity.push_str("-x")),
                true,
            ),
            (
                "manifest digest",
                Box::new(|c| {
                    c.operation_manifest
                        .manifest_digest
                        .replace_range(7..8, "b");
                }),
                true,
            ),
            (
                "effective",
                Box::new(|c| c.effective_at_epoch_ms += 1),
                true,
            ),
            (
                "valid through",
                Box::new(|c| c.valid_through_epoch_ms += 1),
                true,
            ),
            (
                "inverted window",
                Box::new(|c| c.valid_through_epoch_ms = c.effective_at_epoch_ms),
                false,
            ),
        ];

        for (name, mutate, valid) in mutations {
            let mut changed = original.clone();
            mutate(&mut changed);
            match changed.grant_identity() {
                Ok(changed_identity) => {
                    assert!(valid, "{name}: expected rejection");
                    assert_ne!(changed_identity, identity, "{name}: identity did not move");
                }
                Err(_) => assert!(!valid, "{name}: expected a distinct identity"),
            }
        }
    }

    #[rstest]
    fn resource_history_is_keyed_by_the_seven_coordinates() {
        let original = content();
        let mut renewed = original.clone();
        renewed.valid_through_epoch_ms = 2_000;
        renewed.permitted_actions = vec!["INITIAL_ACTIVATION".into()];
        renewed.operation_manifest.manifest_identity = "manifest-v2".into();
        assert!(renewed.same_resource(&original));
        assert_eq!(
            renewed.resource_digest().unwrap(),
            original.resource_digest().unwrap()
        );

        let mut other_generation = original.clone();
        other_generation.strategy_generation_identity = "generation-v2".into();
        assert!(!other_generation.same_resource(&original));
        let mut other_policy = original;
        other_policy.policy.policy_identity = "policy-live-v1".into();
        assert!(!other_policy.same_resource(&content()));
    }

    #[rstest]
    fn proposals_and_read_requests_validate_their_shape() {
        let content = content();
        let proposal = AutonomousPolicyAuthorizationIssuanceProposalV1 {
            grant_identity: content.grant_identity().unwrap(),
            content: content.clone(),
            expected_revocation_frontier_identity: "EMPTY".into(),
        };
        proposal.validate().unwrap();
        let mut forged = proposal.clone();
        forged.grant_identity.push_str("-forged");
        assert!(forged.validate().is_err());
        assert!(
            serde_json::from_str::<AutonomousPolicyAuthorizationContentV1>(
                &serde_json::to_string(&serde_json::json!({"unexpected": true})).unwrap()
            )
            .is_err()
        );

        let request = AutonomousPolicyAuthorizationReadRequestV1 {
            locator: AutonomousPolicyAuthorizationLocatorV1 {
                grant_identity: proposal.grant_identity,
                issuance_receipt_identity: "receipt-1".into(),
            },
            expected_resource: content.resource(),
            expected_manifest: content.operation_manifest,
        };
        request.validate().unwrap();
        let mut empty = request.clone();
        empty.locator.issuance_receipt_identity.clear();
        assert!(empty.validate().is_err());
        let mut wrong_audience = request;
        wrong_audience.expected_resource.audience = "PORTFOLIO".into();
        assert!(wrong_audience.validate().is_err());
    }
}
