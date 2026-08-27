use std::sync::Arc;

use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use serde::{Deserialize, Serialize};
use vibe_product_edge::{
    ProductEdgeAdmissionRequestV1, ProductEdgeError, ProductEdgePostgresOwnerV1,
};
use vibe_strategy_factory::{
    product_edge::{
        ProductEdgeChannel, RESEARCH_GOAL_OPERATION_V2, RESEARCH_GOAL_SCHEMA_V2, RESEARCH_OWNER_V1,
        TrialFamilyProposalV1, UnsourcedResearchGoalV1, UnsourcedResearchProposalV1,
        identity_conflict_result_v2,
    },
    product_edge_postgres::PostgresResearchGoalOwnerV1,
    source_intake::{SourceIntakePolicyEvidenceQueryV1, SourceIntakeResearchAncestryProposalV1},
};

const MAX_REQUEST_BYTES: usize = 256 * 1024;

#[derive(Clone)]
struct SourceIntakeResearchApiState {
    owner: Arc<PostgresResearchGoalOwnerV1>,
    token_digest: [u8; 32],
    product_edge: Arc<ProductEdgePostgresOwnerV1>,
    request_proof_digest: String,
    allow_acceptance_faults: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SourceIntakeResearchOperationV1 {
    pub proposal: SourceIntakeResearchProposalV1,
    pub ancestry: SourceIntakeResearchAncestryProposalV1,
    pub policy_query: SourceIntakePolicyEvidenceQueryV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SourceIntakeResearchProposalV1 {
    pub request_identity: String,
    pub channel: ProductEdgeChannel,
    pub goal: UnsourcedResearchGoalV1,
    pub trial_family_proposal: TrialFamilyProposalV1,
}

pub(super) fn router(
    product_edge: Arc<ProductEdgePostgresOwnerV1>,
    owner: Arc<PostgresResearchGoalOwnerV1>,
    token_digest: [u8; 32],
    request_proof_digest: String,
    allow_acceptance_faults: bool,
) -> Router {
    Router::new()
        .route("/v1/source-intake-research", post(run))
        .route(
            "/v1/source-intake-research/{request_identity}/resolve",
            post(resolve),
        )
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .with_state(SourceIntakeResearchApiState {
            owner,
            token_digest,
            product_edge,
            request_proof_digest,
            allow_acceptance_faults,
        })
}

async fn run(
    State(state): State<SourceIntakeResearchApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    execute(state, headers, None, body).await
}

async fn resolve(
    State(state): State<SourceIntakeResearchApiState>,
    Path(request_identity): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    execute(state, headers, Some(request_identity), body).await
}

async fn execute(
    state: SourceIntakeResearchApiState,
    headers: HeaderMap,
    path_request_identity: Option<String>,
    body: Bytes,
) -> Response {
    if !super::authorized(&headers, &state.token_digest) {
        return super::rejection_v2(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            path_request_identity.as_deref().unwrap_or("unbound"),
        );
    }

    let operation: SourceIntakeResearchOperationV1 = match serde_json::from_slice(&body) {
        Ok(operation) => operation,
        Err(_) => {
            return super::rejection_v2(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                path_request_identity.as_deref().unwrap_or("unbound"),
            );
        }
    };
    let request_identity = operation.proposal.request_identity.clone();
    if operation.ancestry.request_identity != operation.policy_query.request_identity
        || path_request_identity
            .as_deref()
            .is_some_and(|path| path != request_identity)
    {
        let mut response = (
            StatusCode::CONFLICT,
            Json(identity_conflict_result_v2(&request_identity)),
        )
            .into_response();
        super::insert_rejection_code(&mut response, "CONFLICTING_SEMANTICS_FOR_REQUEST_IDENTITY");
        return response;
    }

    let admission = match state
        .product_edge
        .admit_request(ProductEdgeAdmissionRequestV1 {
            request_identity: request_identity.clone(),
            typed_payload: match serde_json::to_value(&operation.proposal) {
                Ok(value) => value,
                Err(_) => {
                    return super::rejection_v2(
                        StatusCode::BAD_REQUEST,
                        "MALFORMED_TYPED_REQUEST",
                        &request_identity,
                    );
                }
            },
            operation: RESEARCH_GOAL_OPERATION_V2.into(),
            operation_schema: RESEARCH_GOAL_SCHEMA_V2.into(),
            target_owner: RESEARCH_OWNER_V1.into(),
            requested_effects: vec!["R_AND_D_RESEARCH_MUTATION_V1".into()],
            request_proof_digest: state.request_proof_digest.clone(),
            audit_correlation: format!("rd-workbench:{request_identity}"),
        })
        .await
    {
        Ok(admission) => admission,
        Err(error) => return product_edge_error(&error, &request_identity),
    };
    let proposal = UnsourcedResearchProposalV1 {
        request_identity: operation.proposal.request_identity,
        channel: operation.proposal.channel,
        admission: admission.locator().clone(),
        goal: operation.proposal.goal,
        trial_family_proposal: operation.proposal.trial_family_proposal,
    };

    let response = match state
        .owner
        .submit_source_intake_research_v1(proposal, operation.ancestry, operation.policy_query)
        .await
    {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(error) => source_research_owner_error(&error, &request_identity),
    };
    if state.allow_acceptance_faults {
        let delay = headers
            .get("x-rd-acceptance-delay-after-commit-ms")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0)
            .min(30_000);
        if delay > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
        }
    }
    response
}

fn source_research_owner_error(
    error: &vibe_strategy_factory::product_edge::ResearchGoalOwnerError,
    request_identity: &str,
) -> Response {
    let mut response = super::owner_error_v2(error, request_identity);
    #[cfg(feature = "sealed-source-intake-acceptance")]
    if let vibe_strategy_factory::product_edge::ResearchGoalOwnerError::Unauthorized(message) =
        error
    {
        let stage = match *message {
            "Source Intake policy locator mismatch" => Some("POLICY_LOCATOR"),
            "Source Intake policy Owner unavailable" => Some("POLICY_OWNER_BINDING"),
            "Source Intake current policy unavailable" => Some("POLICY_CURRENT"),
            "Source Intake ancestry peek unavailable" => Some("ANCESTRY_PEEK"),
            "Source Intake ancestry unavailable" => Some("ANCESTRY_LOCK"),
            "Source Intake ancestry changed" => Some("ANCESTRY_CHANGED"),
            "Product Edge admission unavailable" => Some("PRODUCT_EDGE_DOWNSTREAM_RESOLVE"),
            "canonical Product Edge admission mismatch" => Some("CANONICAL_ADMISSION_VERIFY"),
            "canonical Product Edge research authority mismatch" => {
                Some("CANONICAL_RESEARCH_AUTHORITY_VERIFY")
            }
            "canonical source-bound Product Edge admission mismatch" => {
                Some("SOURCE_BOUND_ADMISSION_VERIFY")
            }
            "Product Edge admission lineage changed before final R&D custody" => {
                Some("FINAL_ADMISSION_LINEAGE")
            }
            _ => None,
        };
        if let Some(stage) = stage
            && let Ok(value) = stage.parse()
        {
            response
                .headers_mut()
                .insert("x-rd-sealed-acceptance-stage", value);
        }
    }
    response
}

fn product_edge_error(error: &ProductEdgeError, request_identity: &str) -> Response {
    let status = match error {
        ProductEdgeError::ConflictingReplay => StatusCode::CONFLICT,
        ProductEdgeError::InvalidProposal(_) => StatusCode::BAD_REQUEST,
        ProductEdgeError::Unavailable | ProductEdgeError::Storage(_) => {
            StatusCode::SERVICE_UNAVAILABLE
        }
    };
    super::rejection_v2(
        status,
        "PRODUCT_EDGE_ADMISSION_UNAVAILABLE",
        request_identity,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use vibe_strategy_factory::product_edge::ResearchGoalOwnerError;

    fn operation_fixture() -> SourceIntakeResearchOperationV1 {
        serde_json::from_value(serde_json::json!({
            "proposal": {
                "request_identity": "research-request-1",
                "channel": "WINDMILL_PRODUCT_EDGE",
                "goal": {
                    "hypothesis": "hypothesis",
                    "mechanism": "mechanism",
                    "falsification_question": "falsifier",
                    "expected_observation": "observation",
                    "required_data": ["data"],
                    "cost_assumption": "cost",
                    "capacity_assumption": "capacity"
                },
                "trial_family_proposal": {
                    "trial_budget": 1,
                    "stop_rule": "stop",
                    "pit_rule_identity": "pit",
                    "cost_model_identity": "cost-model",
                    "slippage_model_identity": "slippage-model",
                    "capacity_model_identity": "capacity-model",
                    "independence_rationale": "genesis"
                }
            },
            "ancestry": {
                "request_identity": "source-request-1",
                "attempt_identity": "source-attempt-1",
                "terminal_receipt_identity": "source-receipt-1"
            },
            "policy_query": {
                "request_identity": "source-request-1",
                "gateway": "WINDMILL_PRODUCT_EDGE",
                "admission": {
                    "request_identity": "source-request-1",
                    "admission_identity": "source-admission-1",
                    "admission_digest": concat!("sha256:", "1111111111111111111111111111111111111111111111111111111111111111")
                },
                "operation_manifest_identity": "source-manifest-1",
                "operation_manifest_digest": concat!("sha256:", "2222222222222222222222222222222222222222222222222222222222222222"),
                "connector_policy_locator": "connector",
                "network_policy_locator": "network",
                "rights_policy_locator": "rights",
                "retention_policy_locator": "retention",
                "dns_observation_locator": "dns",
                "shared_time_head": {
                    "head_identity": [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
                    "head_digest": [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]
                },
                "shared_time_successor": null
            }
        }))
        .expect("fixture is the exact caller-safe operation")
    }

    #[test]
    fn request_is_exact_and_rejects_caller_supplied_verified_evidence() {
        let source = include_str!("source_intake_research.rs");
        assert!(source.contains("submit_source_intake_research_v1("));
        assert!(source.contains("UnsourcedResearchProposalV1"));
        assert!(source.contains("SourceIntakeResearchAncestryProposalV1"));
        assert!(source.contains("SourceIntakePolicyEvidenceQueryV1"));
        assert!(!source.contains(&["verified", "_evidence:"].concat()));
        assert!(!source.contains(&["verified", "_policy:"].concat()));
    }

    #[test]
    fn conflicting_replay_uses_the_existing_canonical_v2_projection() {
        let response = super::super::owner_error_v2(
            &ResearchGoalOwnerError::ConflictingReplay,
            "research-request-1",
        );
        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert_eq!(
            response.headers()["x-rd-rejection-code"],
            "CONFLICTING_SEMANTICS_FOR_REQUEST_IDENTITY"
        );
    }

    #[cfg(feature = "sealed-source-intake-acceptance")]
    #[test]
    fn sealed_diagnostic_maps_only_known_static_unauthorized_stages() {
        for (message, expected) in [
            (
                "Product Edge admission unavailable",
                Some("PRODUCT_EDGE_DOWNSTREAM_RESOLVE"),
            ),
            (
                "canonical source-bound Product Edge admission mismatch",
                Some("SOURCE_BOUND_ADMISSION_VERIFY"),
            ),
            (
                "Product Edge admission lineage changed before final R&D custody",
                Some("FINAL_ADMISSION_LINEAGE"),
            ),
            (
                "Source Intake ancestry peek unavailable",
                Some("ANCESTRY_PEEK"),
            ),
            ("unknown authorization failure", None),
        ] {
            let response = source_research_owner_error(
                &ResearchGoalOwnerError::Unauthorized(message),
                "research-request-1",
            );
            assert_eq!(
                response
                    .headers()
                    .get("x-rd-sealed-acceptance-stage")
                    .and_then(|value| value.to_str().ok()),
                expected
            );
        }
    }

    #[test]
    fn admitted_payload_is_exactly_the_unsourced_proposal_contract() {
        let operation = operation_fixture();
        assert_eq!(
            serde_json::to_value(&operation.proposal).expect("proposal serializes"),
            serde_json::json!({
                "request_identity": operation.proposal.request_identity,
                "channel": operation.proposal.channel,
                "goal": operation.proposal.goal,
                "trial_family_proposal": operation.proposal.trial_family_proposal,
            })
        );
    }
}
