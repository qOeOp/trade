//! The Portfolio resource grant kind over the shared grant engine.
//!
//! These are the names Product Edge and the deployment migration already use;
//! each is a thin wrapper over [`super::grant`] for the Portfolio content type.

use sqlx::{PgPool, Postgres, Transaction};

use super::{OperatorAuthorizationIssuerPostgresV1, grant};
use crate::{
    OperatorAuthorizationError, PortfolioResourceGrantContentV1,
    PortfolioResourceGrantIssuanceProposalV1, PortfolioResourceGrantLocatorV1,
    PortfolioResourceGrantReadRequestV1, PortfolioResourceGrantReadbackV1,
    PortfolioResourceGrantResolutionV1, PortfolioResourceGrantRevocationFrontierV1,
    PortfolioResourceGrantRevocationProposalV1, PortfolioResourceGrantSuccessorProposalV1,
    PortfolioResourceGrantUnavailableReasonV1, UntrustedCanonicalPortfolioResourceGrantEvidenceV1,
};

pub(super) async fn migrate(pool: &PgPool) -> Result<(), OperatorAuthorizationError> {
    grant::migrate::<PortfolioResourceGrantContentV1>(pool).await
}

impl OperatorAuthorizationIssuerPostgresV1 {
    pub async fn issue_portfolio_resource_grant_genesis(
        &self,
        proposal: PortfolioResourceGrantIssuanceProposalV1,
    ) -> Result<PortfolioResourceGrantReadbackV1, OperatorAuthorizationError> {
        self.issue_grant_genesis(proposal).await
    }

    pub async fn issue_portfolio_resource_grant_successor(
        &self,
        proposal: PortfolioResourceGrantSuccessorProposalV1,
    ) -> Result<PortfolioResourceGrantReadbackV1, OperatorAuthorizationError> {
        self.issue_grant_successor(proposal).await
    }

    pub async fn revoke_portfolio_resource_grant(
        &self,
        proposal: PortfolioResourceGrantRevocationProposalV1,
    ) -> Result<PortfolioResourceGrantRevocationFrontierV1, OperatorAuthorizationError> {
        self.revoke_grant::<PortfolioResourceGrantContentV1>(proposal)
            .await
    }
}

/// Resolves one Portfolio resource grant under the issuer's locks on the
/// caller's transaction.
pub async fn resolve_portfolio_resource_grant_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    request: &PortfolioResourceGrantReadRequestV1,
) -> PortfolioResourceGrantResolutionV1 {
    if request.validate().is_err() {
        return PortfolioResourceGrantResolutionV1::Unavailable {
            reason: PortfolioResourceGrantUnavailableReasonV1::InvalidRequest,
        };
    }
    grant::resolve_grant_in_transaction::<PortfolioResourceGrantContentV1>(
        transaction,
        &request.locator,
        &(&request.expected_resource, &request.expected_manifest),
    )
    .await
}

/// Parses the lock function's envelope into non-authoritative Portfolio grant
/// evidence.
pub fn parse_untrusted_portfolio_resource_grant_envelope_v1(
    bytes: &[u8],
    locator: &PortfolioResourceGrantLocatorV1,
) -> Result<UntrustedCanonicalPortfolioResourceGrantEvidenceV1, OperatorAuthorizationError> {
    grant::parse_untrusted_grant_envelope::<PortfolioResourceGrantContentV1>(bytes, locator)
}

#[cfg(test)]
pub(super) fn grant_advisory_lock_identity(resource_digest: &str) -> String {
    grant::GrantSchemaV1::of::<PortfolioResourceGrantContentV1>()
        .advisory_lock_identity(resource_digest)
}

#[cfg(test)]
pub(super) async fn lock_grant_resource_for_write(
    transaction: &mut Transaction<'_, Postgres>,
    resource_digest: &str,
) -> Result<(), OperatorAuthorizationError> {
    grant::lock_grant_resource_for_write(
        transaction,
        &grant::GrantSchemaV1::of::<PortfolioResourceGrantContentV1>(),
        resource_digest,
    )
    .await
}

#[cfg(test)]
mod parser_tests {
    use rstest::rstest;

    use super::*;
    use crate::{
        GrantContentV1, PORTFOLIO_OWNER_AUDIENCE_V1, PORTFOLIO_VIEW_PERMISSION_V1,
        PortfolioResourceModeV1, PortfolioResourceV1, ProductEdgeManifestBindingV1,
        postgres::grant::fixtures,
    };

    fn canonical_envelope() -> (
        serde_json::Value,
        PortfolioResourceGrantLocatorV1,
        PortfolioResourceGrantLocatorV1,
        PortfolioResourceGrantContentV1,
        String,
    ) {
        let content = PortfolioResourceGrantContentV1 {
            issuer_identity: "issuer-v1".into(),
            issuer_key_version: "key-v1".into(),
            resource: PortfolioResourceV1 {
                principal: "principal-v1".into(),
                audience: PORTFOLIO_OWNER_AUDIENCE_V1.into(),
                permission: PORTFOLIO_VIEW_PERMISSION_V1.into(),
                account_identity: "account-v1".into(),
                execution_scope_identity: "execution-scope-v1".into(),
                mode: PortfolioResourceModeV1::Paper,
            },
            product_edge_manifest: ProductEdgeManifestBindingV1 {
                manifest_locator: "manifest-v1".into(),
                manifest_digest: format!("sha256:{}", "a".repeat(64)),
            },
            effective_at_epoch_ms: 10,
            valid_through_epoch_ms: 1_000,
        };
        let mut successor_content = content.clone();
        successor_content.valid_through_epoch_ms = 2_000;
        successor_content.product_edge_manifest.manifest_locator = "manifest-v2".into();
        successor_content.product_edge_manifest.manifest_digest =
            format!("sha256:{}", "b".repeat(64));
        fixtures::canonical_envelope(content, successor_content)
    }

    fn parse(
        value: &serde_json::Value,
        locator: &PortfolioResourceGrantLocatorV1,
    ) -> Result<UntrustedCanonicalPortfolioResourceGrantEvidenceV1, OperatorAuthorizationError>
    {
        parse_untrusted_portfolio_resource_grant_envelope_v1(
            &serde_json::to_vec(value).unwrap(),
            locator,
        )
    }

    #[rstest]
    fn kind_names_are_the_ones_the_deployment_already_uses() {
        let schema = grant::GrantSchemaV1::of::<PortfolioResourceGrantContentV1>();
        assert_eq!(
            schema.issuances,
            "operator_authorization_private.portfolio_resource_grant_issuances_v1"
        );
        assert_eq!(
            schema.lock_function,
            "operator_authorization_api.lock_current_portfolio_resource_grant_v1"
        );
        assert_eq!(
            schema.advisory_lock_identity("sha256:x"),
            "operator-authorization.portfolio-resource-grant.resource.v1:sha256:x"
        );
        assert_eq!(
            PortfolioResourceGrantContentV1::grant_identity_domain(),
            "operator-authorization-portfolio-resource-grant-v1"
        );
        assert_eq!(
            PortfolioResourceGrantContentV1::content_digest_domain(),
            "operator-authorization.portfolio-resource-grant-content.v1"
        );
    }

    #[rstest]
    fn parser_returns_non_authoritative_evidence_for_a_later_cut() {
        let (envelope, genesis, successor, content, frontier_identity) = canonical_envelope();
        let evidence = parse(&envelope, &successor).unwrap();
        assert_eq!(evidence.locator(), successor);
        assert_eq!(evidence.frontier_identity(), frontier_identity);
        assert!(evidence.matches_resource(&content.resource));
        assert!(evidence.matches_product_edge_manifest(&content.product_edge_manifest));
        assert!(evidence.is_current_at(130));
        assert!(!evidence.is_current_at(content.valid_through_epoch_ms));

        let revoked = parse(&envelope, &genesis).unwrap();
        assert!(!revoked.is_current_at(130));
        assert!(parse(&serde_json::to_value(&evidence).unwrap(), &successor).is_err());
    }

    #[rstest]
    fn parser_binds_every_grant_coordinate_and_complete_locked_history() {
        let (envelope, _, successor, _, _) = canonical_envelope();
        let selected_index = envelope["issuances"]
            .as_array()
            .unwrap()
            .iter()
            .position(|row| row["grant_identity"] == successor.grant_identity)
            .unwrap();
        let current_frontier_index = envelope["frontiers"].as_array().unwrap().len() - 1;
        let paths = [
            format!("/issuances/{selected_index}/grant_identity"),
            format!("/issuances/{selected_index}/issuer_identity"),
            format!("/issuances/{selected_index}/principal"),
            format!("/issuances/{selected_index}/audience"),
            format!("/issuances/{selected_index}/permission"),
            format!("/issuances/{selected_index}/account_identity"),
            format!("/issuances/{selected_index}/execution_scope_identity"),
            format!("/issuances/{selected_index}/mode"),
            format!("/issuances/{selected_index}/resource_digest"),
            format!("/issuances/{selected_index}/semantic_digest"),
            format!("/issuances/{selected_index}/issuance_json/proposal/content/issuer_identity"),
            format!(
                "/issuances/{selected_index}/issuance_json/proposal/content/issuer_key_version"
            ),
            format!(
                "/issuances/{selected_index}/issuance_json/proposal/content/resource/principal"
            ),
            format!("/issuances/{selected_index}/issuance_json/proposal/content/resource/audience"),
            format!(
                "/issuances/{selected_index}/issuance_json/proposal/content/resource/permission"
            ),
            format!(
                "/issuances/{selected_index}/issuance_json/proposal/content/resource/account_identity"
            ),
            format!(
                "/issuances/{selected_index}/issuance_json/proposal/content/resource/execution_scope_identity"
            ),
            format!("/issuances/{selected_index}/issuance_json/proposal/content/resource/mode"),
            format!(
                "/issuances/{selected_index}/issuance_json/proposal/content/product_edge_manifest/manifest_locator"
            ),
            format!(
                "/issuances/{selected_index}/issuance_json/proposal/content/product_edge_manifest/manifest_digest"
            ),
            format!(
                "/issuances/{selected_index}/issuance_json/proposal/content/effective_at_epoch_ms"
            ),
            format!(
                "/issuances/{selected_index}/issuance_json/proposal/content/valid_through_epoch_ms"
            ),
            format!("/issuances/{selected_index}/receipt_json/receipt_identity"),
            format!("/issuances/{selected_index}/committed_at_epoch_ms"),
            format!("/frontiers/{current_frontier_index}/frontier_identity"),
            format!("/frontiers/{current_frontier_index}/resource_digest"),
            format!("/frontiers/{current_frontier_index}/frontier_digest"),
            format!("/frontiers/{current_frontier_index}/frontier_json/revocations/0/reason_code"),
            "/head/frontier_identity".into(),
            "/head/frontier_digest".into(),
            "/outboxes/0/payload_digest".into(),
            "/outboxes/0/payload_json/event_kind".into(),
        ];

        for path in paths {
            let mut changed = envelope.clone();
            let target = changed.pointer_mut(&path).unwrap();
            *target = match target {
                serde_json::Value::String(_) => serde_json::json!("tampered"),
                serde_json::Value::Number(number) => {
                    serde_json::json!(number.as_i64().unwrap() + 1)
                }
                _ => unreachable!("mutation path must name a scalar"),
            };
            assert!(parse(&changed, &successor).is_err(), "accepted {path}");
        }

        for key in ["issuances", "frontiers", "outboxes"] {
            let mut reordered = envelope.clone();
            reordered[key].as_array_mut().unwrap().reverse();
            assert!(
                parse(&reordered, &successor).is_err(),
                "accepted {key} reorder"
            );

            let mut duplicated = envelope.clone();
            let duplicate = duplicated[key].as_array().unwrap()[0].clone();
            duplicated[key].as_array_mut().unwrap().push(duplicate);
            assert!(
                parse(&duplicated, &successor).is_err(),
                "accepted duplicate {key}"
            );
        }

        let mut extra_column = envelope.clone();
        extra_column["issuances"][selected_index]["unexpected"] = serde_json::json!("x");
        assert!(
            parse(&extra_column, &successor).is_err(),
            "accepted extra column"
        );

        let mut invalid_observation = envelope;
        invalid_observation["observed_at_epoch_ms"] = serde_json::json!(-1);
        assert!(parse(&invalid_observation, &successor).is_err());
        assert!(parse_untrusted_portfolio_resource_grant_envelope_v1(b"{}", &successor).is_err());
    }
}
