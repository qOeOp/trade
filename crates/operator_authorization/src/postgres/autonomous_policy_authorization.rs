//! The Autonomous Policy Authorization kind over the shared grant engine.
//!
//! Strategy Governance binds one of these to every unattended lifecycle
//! decision and Product Edge seals it into the lifecycle request admission;
//! neither can mint or revoke one. Both read it through
//! `operator_authorization_api.lock_current_autonomous_policy_authorization_v1`.

use sqlx::{PgPool, Postgres, Transaction};

use super::{OperatorAuthorizationIssuerPostgresV1, grant};
use crate::{
    AutonomousPolicyAuthorizationContentV1, AutonomousPolicyAuthorizationIssuanceProposalV1,
    AutonomousPolicyAuthorizationLocatorV1, AutonomousPolicyAuthorizationReadRequestV1,
    AutonomousPolicyAuthorizationReadbackV1, AutonomousPolicyAuthorizationResolutionV1,
    AutonomousPolicyAuthorizationRevocationFrontierV1,
    AutonomousPolicyAuthorizationRevocationProposalV1,
    AutonomousPolicyAuthorizationSuccessorProposalV1,
    AutonomousPolicyAuthorizationUnavailableReasonV1, OperatorAuthorizationError,
    UntrustedCanonicalAutonomousPolicyAuthorizationEvidenceV1,
};

pub(super) async fn migrate(pool: &PgPool) -> Result<(), OperatorAuthorizationError> {
    grant::migrate::<AutonomousPolicyAuthorizationContentV1>(pool).await
}

impl OperatorAuthorizationIssuerPostgresV1 {
    pub async fn issue_autonomous_policy_authorization_genesis(
        &self,
        proposal: AutonomousPolicyAuthorizationIssuanceProposalV1,
    ) -> Result<AutonomousPolicyAuthorizationReadbackV1, OperatorAuthorizationError> {
        self.issue_grant_genesis(proposal).await
    }

    pub async fn issue_autonomous_policy_authorization_successor(
        &self,
        proposal: AutonomousPolicyAuthorizationSuccessorProposalV1,
    ) -> Result<AutonomousPolicyAuthorizationReadbackV1, OperatorAuthorizationError> {
        self.issue_grant_successor(proposal).await
    }

    pub async fn revoke_autonomous_policy_authorization(
        &self,
        proposal: AutonomousPolicyAuthorizationRevocationProposalV1,
    ) -> Result<AutonomousPolicyAuthorizationRevocationFrontierV1, OperatorAuthorizationError> {
        self.revoke_grant::<AutonomousPolicyAuthorizationContentV1>(proposal)
            .await
    }
}

/// Resolves one Autonomous Policy Authorization under the issuer's locks on
/// the caller's transaction.
pub async fn resolve_autonomous_policy_authorization_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    request: &AutonomousPolicyAuthorizationReadRequestV1,
) -> AutonomousPolicyAuthorizationResolutionV1 {
    if request.validate().is_err() {
        return AutonomousPolicyAuthorizationResolutionV1::Unavailable {
            reason: AutonomousPolicyAuthorizationUnavailableReasonV1::InvalidRequest,
        };
    }
    grant::resolve_grant_in_transaction::<AutonomousPolicyAuthorizationContentV1>(
        transaction,
        &request.locator,
        &(&request.expected_resource, &request.expected_manifest),
    )
    .await
}

/// Parses the lock function's envelope into non-authoritative Autonomous
/// Policy Authorization evidence.
pub fn parse_untrusted_autonomous_policy_authorization_envelope_v1(
    bytes: &[u8],
    locator: &AutonomousPolicyAuthorizationLocatorV1,
) -> Result<UntrustedCanonicalAutonomousPolicyAuthorizationEvidenceV1, OperatorAuthorizationError> {
    grant::parse_untrusted_grant_envelope::<AutonomousPolicyAuthorizationContentV1>(bytes, locator)
}

#[cfg(test)]
mod parser_tests {
    use rstest::rstest;

    use super::*;
    use crate::{GrantContentV1, postgres::grant::fixtures};

    fn canonical_envelope() -> (
        serde_json::Value,
        AutonomousPolicyAuthorizationLocatorV1,
        AutonomousPolicyAuthorizationLocatorV1,
        AutonomousPolicyAuthorizationContentV1,
        String,
    ) {
        let content = crate::autonomous_policy_authorization::tests::content();
        let mut successor_content = content.clone();
        successor_content.valid_through_epoch_ms = 2_000;
        successor_content.operation_manifest.manifest_identity = "manifest-v2".into();
        successor_content.operation_manifest.manifest_digest = format!("sha256:{}", "b".repeat(64));
        fixtures::canonical_envelope(content, successor_content)
    }

    fn parse(
        value: &serde_json::Value,
        locator: &AutonomousPolicyAuthorizationLocatorV1,
    ) -> Result<UntrustedCanonicalAutonomousPolicyAuthorizationEvidenceV1, OperatorAuthorizationError>
    {
        parse_untrusted_autonomous_policy_authorization_envelope_v1(
            &serde_json::to_vec(value).unwrap(),
            locator,
        )
    }

    #[rstest]
    fn kind_names_never_collide_with_the_portfolio_grant() {
        let schema = grant::GrantSchemaV1::of::<AutonomousPolicyAuthorizationContentV1>();
        assert_eq!(
            schema.issuances,
            "operator_authorization_private.autonomous_policy_authorization_issuances_v1"
        );
        assert_eq!(
            schema.lock_function,
            "operator_authorization_api.lock_current_autonomous_policy_authorization_v1"
        );
        assert_eq!(
            AutonomousPolicyAuthorizationContentV1::grant_identity_domain(),
            "operator-authorization-autonomous-policy-authorization-v1"
        );
    }

    #[rstest]
    fn parser_returns_non_authoritative_evidence_for_a_later_cut() {
        let (envelope, genesis, successor, content, frontier_identity) = canonical_envelope();
        let evidence = parse(&envelope, &successor).unwrap();
        assert_eq!(evidence.locator(), successor);
        assert_eq!(evidence.frontier_identity(), frontier_identity);
        assert!(evidence.matches_resource(&content.resource()));
        assert!(evidence.matches_operation_manifest(&content.operation_manifest));
        assert!(evidence.content().permits_action("INITIAL_ACTIVATION"));
        assert!(!evidence.content().permits_action("RETIREMENT"));
        assert!(evidence.is_current_at(130));
        assert!(!evidence.is_current_at(content.valid_through_epoch_ms));

        let revoked = parse(&envelope, &genesis).unwrap();
        assert!(!revoked.is_current_at(130));
        assert!(parse(&serde_json::to_value(&evidence).unwrap(), &successor).is_err());
    }

    #[rstest]
    fn parser_binds_every_coordinate_and_complete_locked_history() {
        let (envelope, _, successor, _, _) = canonical_envelope();
        let selected_index = envelope["issuances"]
            .as_array()
            .unwrap()
            .iter()
            .position(|row| row["grant_identity"] == successor.grant_identity)
            .unwrap();
        let current_frontier_index = envelope["frontiers"].as_array().unwrap().len() - 1;
        let content_paths = [
            "issuer_identity",
            "issuer_key_version",
            "policy/policy_identity",
            "policy/policy_version",
            "scope/principal",
            "scope/audience",
            "scope/permissions/0",
            "account_identity",
            "execution_mode",
            "strategy_generation_identity",
            "execution_scope_identity",
            "permitted_actions/0",
            "permitted_intent_classes/0",
            "capital_policy/envelope_identity",
            "capital_policy/envelope_version",
            "capital_policy/envelope_digest",
            "operation_manifest/manifest_identity",
            "operation_manifest/manifest_digest",
            "effective_at_epoch_ms",
            "valid_through_epoch_ms",
        ];
        let mut paths = AutonomousPolicyAuthorizationContentV1::MIRROR_COLUMNS
            .iter()
            .map(|column| format!("/issuances/{selected_index}/{column}"))
            .collect::<Vec<_>>();
        paths.extend(content_paths.iter().map(|path| {
            format!("/issuances/{selected_index}/issuance_json/proposal/content/{path}")
        }));
        paths.extend([
            format!("/issuances/{selected_index}/grant_identity"),
            format!("/issuances/{selected_index}/issuer_identity"),
            format!("/issuances/{selected_index}/resource_digest"),
            format!("/issuances/{selected_index}/semantic_digest"),
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
        ]);

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

        let mut invalid_observation = envelope;
        invalid_observation["observed_at_epoch_ms"] = serde_json::json!(-1);
        assert!(parse(&invalid_observation, &successor).is_err());
        assert!(
            parse_untrusted_autonomous_policy_authorization_envelope_v1(b"{}", &successor).is_err()
        );
    }
}
