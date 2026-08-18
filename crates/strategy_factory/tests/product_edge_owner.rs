use std::sync::Arc;

use rstest::rstest;
use vibe_strategy_factory::product_edge::{
    InMemoryResearchGoalOwnerV1, ProductEdgeAdmissionPolicyV1, ProductEdgeChannel,
    ProductEdgeResearchGoalRequestV1, ProductEdgeResolution, ResearchGoalOwnerError,
    ResearchGoalOwnerPort, ResearchNextLegalAction, ResearchRequestDisposition, ResearchSourceV1,
    ResearchViewAvailability, ResearchViewPhase, SourcedResearchGoalV1,
    TrustedProductEdgeContextV1, decide_commit, identity_conflict_result, result_from_commit_at,
    semantic_digest,
};

fn policy() -> ProductEdgeAdmissionPolicyV1 {
    ProductEdgeAdmissionPolicyV1 {
        effective_principal: "admin".to_string(),
        permissioned_as: "u/admin".to_string(),
        shell_binding_identity: "windmill-product-edge-local-v1".to_string(),
        shell_history_head: "windmill-product-edge-local-history-genesis-v1".to_string(),
        authorization_identity: "local-single-user-research-v1".to_string(),
        authorization_policy_version: "rd-research-local-policy-v1".to_string(),
        manifest_identity: "windmill-research-goal-operation-manifest-v1".to_string(),
        manifest_version: "1".to_string(),
        capability_policy_version: "rd-product-edge-capabilities-v1".to_string(),
        audit_policy_version: "rd-product-edge-audit-v1".to_string(),
    }
}

fn context() -> TrustedProductEdgeContextV1 {
    TrustedProductEdgeContextV1 {
        effective_principal: "admin".to_string(),
        permissioned_as: "u/admin".to_string(),
        authorized_scope: vec!["research:submit".to_string(), "research:view".to_string()],
        shell_binding_identity: "windmill-product-edge-local-v1".to_string(),
        shell_history_head: "windmill-product-edge-local-history-genesis-v1".to_string(),
        shell_binding_generation: 1,
        shell_binding_state: "ACTIVE".to_string(),
        authorization_identity: "local-single-user-research-v1".to_string(),
        authorization_policy_version: "rd-research-local-policy-v1".to_string(),
        manifest_identity: "windmill-research-goal-operation-manifest-v1".to_string(),
        manifest_version: "1".to_string(),
        capability_policy_version: "rd-product-edge-capabilities-v1".to_string(),
        audit_policy_version: "rd-product-edge-audit-v1".to_string(),
        target_owner: "R_AND_D".to_string(),
        target_operation: "research_goal.submit_or_resolve.v1".to_string(),
        operation_schema: "sourced-research-goal-v1".to_string(),
    }
}

fn request(channel: ProductEdgeChannel) -> ProductEdgeResearchGoalRequestV1 {
    ProductEdgeResearchGoalRequestV1 {
        request_identity: "research-request-01JZTEST0000000000000001".to_string(),
        channel,
        context: context(),
        goal: SourcedResearchGoalV1 {
            hypothesis: "BTC perpetual hourly momentum persists after explicit costs.".to_string(),
            mechanism: "Slow information diffusion creates short-lived continuation.".to_string(),
            falsification_question: "Does net continuation disappear out of sample after costs?"
                .to_string(),
            expected_observation: "Positive net continuation across preregistered windows."
                .to_string(),
            required_data: vec!["PIT hourly trades and funding".to_string()],
            cost_assumption: "Maker and taker fee schedule plus observed spread.".to_string(),
            capacity_assumption: "Single-user research, no capital allocation claim.".to_string(),
            protected_feedback_frontier: "qualification-frontier:none".to_string(),
            sources: vec![ResearchSourceV1 {
                locator: "https://example.com/source".to_string(),
                content_digest:
                    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                        .to_string(),
                observed_at: "2026-08-18T12:00:00Z".to_string(),
                source_cut: "source-cut-2026-08-18".to_string(),
                license_basis: "public documentation; research citation only".to_string(),
                interpretation: "Defines the market observation used to frame the hypothesis."
                    .to_string(),
            }],
        },
    }
}

#[tokio::test]
async fn accepted_receipt_and_view_are_native_owner_facts() {
    let owner = InMemoryResearchGoalOwnerV1::new(policy());
    let result = owner
        .submit(request(ProductEdgeChannel::App))
        .await
        .unwrap();

    assert_eq!(result.resolution, ProductEdgeResolution::Accepted);
    assert_eq!(
        result.next_legal_action,
        ResearchNextLegalAction::WaitForRAndDExecution
    );
    let receipt = result.owner_receipt.unwrap();
    assert_eq!(receipt.disposition, ResearchRequestDisposition::Accepted);
    assert!(receipt.resulting_research_intent_identity.is_some());
    let view = result.research_view.unwrap();
    assert_eq!(view.availability, ResearchViewAvailability::Available);
    assert_eq!(view.phase, ResearchViewPhase::IntentFrozen);
    assert_eq!(
        view.next_legal_action,
        ResearchNextLegalAction::WaitForRAndDExecution
    );
    assert!(view.valid_through_epoch_ms > view.projection_at_epoch_ms);
}

#[tokio::test]
async fn malformed_goal_commits_rejected_receipt_without_research_fact() {
    let owner = InMemoryResearchGoalOwnerV1::new(policy());
    let mut malformed = request(ProductEdgeChannel::App);
    malformed.goal.sources.clear();
    let result = owner.submit(malformed).await.unwrap();

    assert_eq!(result.resolution, ProductEdgeResolution::RejectedNoWrite);
    assert_eq!(
        result.next_legal_action,
        ResearchNextLegalAction::CorrectInputAndCreateSuccessorRequest
    );
    let receipt = result.owner_receipt.unwrap();
    assert_eq!(
        receipt.disposition,
        ResearchRequestDisposition::RejectedNoWrite
    );
    assert!(receipt.resulting_research_intent_identity.is_none());
    assert_eq!(
        receipt.rejection_code.as_deref(),
        Some("SOURCE_SET_INVALID")
    );
    assert!(result.research_view.is_none());
}

#[tokio::test]
async fn app_and_mcp_replay_converge_on_one_receipt() {
    let owner = InMemoryResearchGoalOwnerV1::new(policy());
    let app = owner
        .submit(request(ProductEdgeChannel::App))
        .await
        .unwrap();
    let mcp = owner
        .submit(request(ProductEdgeChannel::Mcp))
        .await
        .unwrap();
    assert_eq!(app.owner_receipt, mcp.owner_receipt);
    assert_eq!(app.research_view, mcp.research_view);
}

#[tokio::test]
async fn concurrent_delivery_converges_on_one_receipt() {
    let owner = Arc::new(InMemoryResearchGoalOwnerV1::new(policy()));
    let mut tasks = Vec::new();

    for _ in 0..24 {
        let owner = owner.clone();
        tasks.push(tokio::spawn(async move {
            owner
                .submit(request(ProductEdgeChannel::App))
                .await
                .unwrap()
        }));
    }
    let mut receipts = Vec::new();

    for task in tasks {
        receipts.push(task.await.unwrap().owner_receipt.unwrap());
    }
    assert!(receipts.windows(2).all(|pair| pair[0] == pair[1]));
}

#[tokio::test]
async fn changed_semantics_under_one_identity_fail_closed() {
    let owner = InMemoryResearchGoalOwnerV1::new(policy());
    owner
        .submit(request(ProductEdgeChannel::App))
        .await
        .unwrap();
    let mut conflict = request(ProductEdgeChannel::App);
    conflict.goal.hypothesis.push_str(" changed");
    assert_eq!(
        owner.submit(conflict).await.unwrap_err(),
        ResearchGoalOwnerError::ConflictingReplay
    );
    let boundary = identity_conflict_result("research-request-01JZTEST0000000000000001");
    assert_eq!(boundary.resolution, ProductEdgeResolution::IdentityConflict);
    assert!(boundary.owner_receipt.is_none());
    assert!(boundary.research_view.is_none());
    assert_eq!(
        boundary.next_legal_action,
        ResearchNextLegalAction::ResolveSameRequestIdentity
    );
    let original = owner
        .resolve("research-request-01JZTEST0000000000000001", &context())
        .await
        .unwrap();
    assert_eq!(original.resolution, ProductEdgeResolution::Accepted);
    assert!(original.owner_receipt.is_some());
}

#[tokio::test]
async fn missing_receipt_remains_unknown_and_resolves_under_same_identity() {
    let owner = InMemoryResearchGoalOwnerV1::new(policy());
    let identity = "research-request-01JZTEST0000000000000099";
    let unknown = owner.resolve(identity, &context()).await.unwrap();
    assert_eq!(
        unknown.resolution,
        ProductEdgeResolution::SubmittedOrUnknown
    );
    assert!(unknown.owner_receipt.is_none());
    assert_eq!(
        unknown.next_legal_action,
        ResearchNextLegalAction::ResolveSameRequestIdentity
    );

    let accepted = owner
        .submit(request(ProductEdgeChannel::App))
        .await
        .unwrap();
    let resolved = owner
        .resolve(&accepted.request_identity, &context())
        .await
        .unwrap();
    assert_eq!(resolved.owner_receipt, accepted.owner_receipt);
}

#[tokio::test]
async fn incompatible_principal_is_rejected_before_owner_write() {
    let owner = InMemoryResearchGoalOwnerV1::new(policy());
    let mut unauthorized = request(ProductEdgeChannel::Mcp);
    unauthorized.context.effective_principal = "other".to_string();
    assert!(matches!(
        owner.submit(unauthorized).await,
        Err(ResearchGoalOwnerError::Unauthorized("effective principal"))
    ));
    let unresolved = owner
        .resolve("research-request-01JZTEST0000000000000001", &context())
        .await
        .unwrap();
    assert_eq!(
        unresolved.resolution,
        ProductEdgeResolution::SubmittedOrUnknown
    );
}

#[rstest]
fn owner_projection_becomes_stale_after_its_valid_through_cut() {
    let request = request(ProductEdgeChannel::App);
    let digest = semantic_digest(&request).unwrap();
    let commit = decide_commit(request, digest, 1_000);
    let result = result_from_commit_at(commit, 601_001);
    let view = result.research_view.unwrap();
    assert_eq!(view.availability, ResearchViewAvailability::Stale);
    assert_eq!(view.observed_at_epoch_ms, 1_000);
    assert_eq!(view.projection_at_epoch_ms, 601_001);
}
