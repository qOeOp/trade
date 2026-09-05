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
    ProductEdgeAdmissionLocatorV1, ProductEdgeAdmissionRequestV1, ProductEdgeError,
    ProductEdgePostgresOwnerV1,
};
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use vibe_strategy_factory::product_edge::ResearchGoalOwnerPortV2;
use vibe_strategy_factory::{
    product_edge::{
        ProductEdgeChannel, RESEARCH_GOAL_OPERATION_V2, RESEARCH_GOAL_SCHEMA_V2, RESEARCH_OWNER_V1,
        ResearchGoalOwnerError, TrialFamilyProposalV1, UnsourcedResearchGoalV1,
        UnsourcedResearchProposalV1, identity_conflict_result_v2, unresolved_result_v2,
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
    execute_run(state, headers, body).await
}

async fn resolve(
    State(state): State<SourceIntakeResearchApiState>,
    Path(request_identity): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    {
        if !super::authorized(&headers, &state.token_digest) {
            return super::rejection_v2(
                StatusCode::FORBIDDEN,
                "UNAUTHORIZED_PRODUCT_EDGE",
                &request_identity,
            );
        }

        if !body.is_empty() {
            return super::rejection_v2(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                &request_identity,
            );
        }
        let admission = match state
            .product_edge
            .resolve_admission(&request_identity, &state.request_proof_digest)
            .await
        {
            Ok(Some(admission)) => admission,
            Ok(None) => {
                return (
                    StatusCode::ACCEPTED,
                    Json(unresolved_result_v2(&request_identity)),
                )
                    .into_response();
            }
            Err(e) => return product_edge_error(&e, &request_identity),
        };
        return match state
            .owner
            .resolve_v2(&request_identity, admission.locator())
            .await
        {
            Ok(result) => (StatusCode::OK, Json(result)).into_response(),
            Err(e) => source_research_owner_error(&e, &request_identity),
        };
    }

    #[cfg(not(feature = "sealed-source-intake-composer-acceptance"))]
    {
        let (request_identity, operation) =
            match parse_operation(&state, &headers, Some(&request_identity), &body) {
                Ok(parsed) => parsed,
                Err(response) => return *response,
            };
        let admission = match state
            .product_edge
            .resolve_admission(&request_identity, &state.request_proof_digest)
            .await
        {
            Ok(Some(admission)) => admission,
            Ok(None) => {
                return (
                    StatusCode::ACCEPTED,
                    Json(unresolved_result_v2(&request_identity)),
                )
                    .into_response();
            }
            Err(e) => return product_edge_error(&e, &request_identity),
        };
        let proposal = admitted_proposal(operation.proposal, admission.locator().clone());

        match state
            .owner
            .resolve_source_intake_research_v1(proposal, operation.ancestry, operation.policy_query)
            .await
        {
            Ok(Some(result)) => (StatusCode::OK, Json(result)).into_response(),
            Ok(None) => (
                StatusCode::ACCEPTED,
                Json(unresolved_result_v2(&request_identity)),
            )
                .into_response(),
            Err(e) => source_research_owner_error(&e, &request_identity),
        }
    }
}

async fn execute_run(
    state: SourceIntakeResearchApiState,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let (request_identity, operation) = match parse_operation(&state, &headers, None, &body) {
        Ok(parsed) => parsed,
        Err(response) => return *response,
    };

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
        Err(e) => return product_edge_error(&e, &request_identity),
    };
    let proposal = admitted_proposal(operation.proposal, admission.locator().clone());

    let response = match state
        .owner
        .submit_source_intake_research_v1(proposal, operation.ancestry, operation.policy_query)
        .await
    {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => source_research_owner_error(&e, &request_identity),
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

fn parse_operation(
    state: &SourceIntakeResearchApiState,
    headers: &HeaderMap,
    path_request_identity: Option<&str>,
    body: &[u8],
) -> Result<(String, SourceIntakeResearchOperationV1), Box<Response>> {
    if !super::authorized(headers, &state.token_digest) {
        return Err(Box::new(super::rejection_v2(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            path_request_identity.unwrap_or("unbound"),
        )));
    }

    let operation: SourceIntakeResearchOperationV1 =
        serde_json::from_slice(body).map_err(|_| {
            Box::new(super::rejection_v2(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                path_request_identity.unwrap_or("unbound"),
            ))
        })?;
    let request_identity = operation.proposal.request_identity.clone();
    if operation.ancestry.request_identity != operation.policy_query.request_identity
        || path_request_identity.is_some_and(|path| path != request_identity)
    {
        let mut response = (
            StatusCode::CONFLICT,
            Json(identity_conflict_result_v2(&request_identity)),
        )
            .into_response();
        super::insert_rejection_code(&mut response, "CONFLICTING_SEMANTICS_FOR_REQUEST_IDENTITY");
        return Err(Box::new(response));
    }

    Ok((request_identity, operation))
}

fn admitted_proposal(
    proposal: SourceIntakeResearchProposalV1,
    admission: ProductEdgeAdmissionLocatorV1,
) -> UnsourcedResearchProposalV1 {
    UnsourcedResearchProposalV1 {
        request_identity: proposal.request_identity,
        channel: proposal.channel,
        admission,
        goal: proposal.goal,
        trial_family_proposal: proposal.trial_family_proposal,
    }
}

fn source_research_owner_error(error: &ResearchGoalOwnerError, request_identity: &str) -> Response {
    let response = super::owner_error_v2(error, request_identity);
    #[cfg(feature = "sealed-source-intake-acceptance")]
    let mut response = response;
    #[cfg(feature = "sealed-source-intake-acceptance")]
    if let ResearchGoalOwnerError::Unauthorized(message) = error {
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
    use rstest::rstest;

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

    #[rstest]
    fn request_is_exact_and_rejects_caller_supplied_verified_evidence() {
        let source = include_str!("source_intake_research.rs");
        assert!(source.contains("submit_source_intake_research_v1("));
        assert!(source.contains("UnsourcedResearchProposalV1"));
        assert!(source.contains("SourceIntakeResearchAncestryProposalV1"));
        assert!(source.contains("SourceIntakePolicyEvidenceQueryV1"));
        assert!(!source.contains(&["verified", "_evidence:"].concat()));
        assert!(!source.contains(&["verified", "_policy:"].concat()));
    }

    #[rstest]
    fn resolve_cannot_enter_the_first_submission_path() {
        let source = include_str!("source_intake_research.rs");
        let production = source
            .split("#[cfg(test)]")
            .next()
            .expect("production module precedes tests");
        let resolve = production
            .split("async fn resolve(")
            .nth(1)
            .expect("resolve entrypoint exists")
            .split("async fn execute")
            .next()
            .expect("RUN entrypoint follows resolve");

        assert!(!resolve.contains("execute("));
        assert!(!resolve.contains("admit_request("));
        assert!(!resolve.contains("submit_source_intake_research_v1("));
        assert!(resolve.contains("resolve_admission("));
        assert!(resolve.contains("resolve_source_intake_research_v1("));
    }

    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    #[rstest]
    fn composite_resolve_is_identity_only_and_uses_canonical_owner_reread() {
        let source = include_str!("source_intake_research.rs");
        let production = source
            .split("#[cfg(test)]")
            .next()
            .expect("production module precedes tests");
        let resolve = production
            .split("async fn resolve(")
            .nth(1)
            .expect("resolve entrypoint exists")
            .split("async fn execute")
            .next()
            .expect("RUN entrypoint follows resolve");
        let composite = resolve
            .split("sealed-source-intake-composer-acceptance")
            .nth(1)
            .expect("composite resolve branch exists")
            .split("#[cfg(not")
            .next()
            .expect("composite branch ends before legacy branch");

        assert!(composite.contains("body.is_empty()"));
        assert!(composite.contains("resolve_admission("));
        assert!(composite.contains("resolve_v2("));
        assert!(!composite.contains("parse_operation("));
        assert!(!composite.contains("submit_source_intake_research_v1("));
        assert!(!composite.contains("resolve_source_intake_research_v1("));
    }

    #[rstest]
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
    #[rstest]
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

    #[rstest]
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
