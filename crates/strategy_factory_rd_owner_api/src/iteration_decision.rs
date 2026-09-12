use std::sync::Arc;

use axum::{
    Json, Router,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use serde::Serialize;
use serde_json::json;
use vibe_backtest_owner_contracts::OpaqueIdentityV2;
use vibe_strategy_factory::{
    DecisionCompositionRequestV1, IterationDecisionPostgresErrorV1,
    iteration_decision::{
        IterationDecisionEvidenceCutV1, IterationDecisionOutcomeV1, IterationRepairCategoryV1,
        RepairInputIterationDecisionReadbackV1,
    },
    product_edge_postgres::PostgresResearchGoalOwnerV1,
};

use super::{authorized, insert_rejection_code};

#[async_trait::async_trait]
trait RepairInputDecisionActionPort: Send + Sync {
    async fn compose(
        &self,
        request: DecisionCompositionRequestV1,
    ) -> Result<RepairInputDecisionActionResponseV1, IterationDecisionPostgresErrorV1>;
}

#[async_trait::async_trait]
impl RepairInputDecisionActionPort for PostgresResearchGoalOwnerV1 {
    async fn compose(
        &self,
        request: DecisionCompositionRequestV1,
    ) -> Result<RepairInputDecisionActionResponseV1, IterationDecisionPostgresErrorV1> {
        self.compose_repair_input_iteration_decision_v1(request)
            .await
            .map(RepairInputDecisionActionResponseV1::from)
    }
}

#[derive(Clone)]
struct RepairInputDecisionApiState {
    owner: Arc<dyn RepairInputDecisionActionPort>,
    token_digest: [u8; 32],
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct RepairInputDecisionActionResponseV1 {
    schema_version: u16,
    decision_identity: String,
    decision_digest: String,
    evidence_cut: IterationDecisionEvidenceCutV1,
    outcome: IterationDecisionOutcomeV1,
    supported_defects: Vec<IterationRepairCategoryV1>,
    receipt_identity: String,
    result_identity: String,
    committed_at_epoch_ms: u64,
}

impl From<RepairInputIterationDecisionReadbackV1> for RepairInputDecisionActionResponseV1 {
    fn from(readback: RepairInputIterationDecisionReadbackV1) -> Self {
        let decision = readback.decision();
        let receipt = readback.receipt();
        Self {
            schema_version: 1,
            decision_identity: decision.decision_identity().to_string(),
            decision_digest: decision.decision_digest().to_string(),
            evidence_cut: decision.evidence_cut().clone(),
            outcome: decision.outcome().clone(),
            supported_defects: decision.supported_defects().to_vec(),
            receipt_identity: receipt.receipt_identity().to_string(),
            result_identity: receipt.result_identity().to_string(),
            committed_at_epoch_ms: receipt.committed_at_epoch_ms(),
        }
    }
}

pub(super) fn router(owner: Arc<PostgresResearchGoalOwnerV1>, token_digest: [u8; 32]) -> Router {
    action_router(owner, token_digest)
}

fn action_router(owner: Arc<dyn RepairInputDecisionActionPort>, token_digest: [u8; 32]) -> Router {
    Router::new()
        .route(
            "/v1/iteration-decisions/repair-inputs",
            post(compose_repair_input_decision),
        )
        .with_state(RepairInputDecisionApiState {
            owner,
            token_digest,
        })
}

async fn compose_repair_input_decision(
    State(state): State<RepairInputDecisionApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }
    let request: DecisionCompositionRequestV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let request_identity = request.request_identity.clone();
    if [
        request.trial_family_identity.as_str(),
        request.result_identity.as_str(),
        request.request_identity.as_str(),
        request.attempt_identity.as_str(),
    ]
    .into_iter()
    .any(|identity| OpaqueIdentityV2::try_from(identity.to_string()).is_err())
    {
        return rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_ITERATION_DECISION_LOCATORS",
            &request_identity,
        );
    }
    match state.owner.compose(request).await {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(error) => owner_error(&error, &request_identity),
    }
}

fn owner_error(error: &IterationDecisionPostgresErrorV1, request_identity: &str) -> Response {
    match error {
        IterationDecisionPostgresErrorV1::InvalidLocator => rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_ITERATION_DECISION_LOCATORS",
            request_identity,
        ),
        IterationDecisionPostgresErrorV1::NoDecision(_) => rejection(
            StatusCode::CONFLICT,
            "ITERATION_DECISION_NOT_AVAILABLE",
            request_identity,
        ),
        IterationDecisionPostgresErrorV1::InterpretationRequired => rejection(
            StatusCode::CONFLICT,
            "ITERATION_INTERPRETATION_REQUIRED",
            request_identity,
        ),
        IterationDecisionPostgresErrorV1::TrialFamily(_)
        | IterationDecisionPostgresErrorV1::Backtest(_)
        | IterationDecisionPostgresErrorV1::Decision(_)
        | IterationDecisionPostgresErrorV1::RepairAction(_)
        | IterationDecisionPostgresErrorV1::Storage(_) => rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "ITERATION_DECISION_OWNER_UNAVAILABLE",
            request_identity,
        ),
    }
}

fn rejection(status: StatusCode, code: &str, request_identity: &str) -> Response {
    let mut response = (
        status,
        Json(json!({
            "request_identity": request_identity,
            "error": code,
        })),
    )
        .into_response();
    insert_rejection_code(&mut response, code);
    response
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;
    use sha2::Digest as _;
    use tower::ServiceExt;
    use vibe_strategy_factory::iteration_decision::{
        IterationNoDecisionReasonV1, IterationRepairTargetV1,
    };

    struct DecisionOwnerStub {
        calls: AtomicUsize,
        response: Option<RepairInputDecisionActionResponseV1>,
    }

    #[async_trait::async_trait]
    impl RepairInputDecisionActionPort for DecisionOwnerStub {
        async fn compose(
            &self,
            _request: DecisionCompositionRequestV1,
        ) -> Result<RepairInputDecisionActionResponseV1, IterationDecisionPostgresErrorV1> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.response
                .clone()
                .ok_or(IterationDecisionPostgresErrorV1::NoDecision(
                    IterationNoDecisionReasonV1::UnknownOrNonterminalResult,
                ))
        }
    }

    fn request() -> serde_json::Value {
        json!({
            "trial_family_identity": "family-1",
            "result_identity": "result-1",
            "request_identity": "request-1",
            "attempt_identity": "attempt-1",
        })
    }

    fn response() -> RepairInputDecisionActionResponseV1 {
        let evidence_cut = IterationDecisionEvidenceCutV1 {
            decision_policy_identity: "policy-1".into(),
            decision_policy_version: 1,
            decision_policy_digest: [1; 32],
            decision_policy_binding_digest: [2; 32],
            trial_family_identity: "family-1".into(),
            census_frontier_identity: "census-1".into(),
            census_frontier_digest: format!("sha256:{}", "3".repeat(64)),
            attempt_frontier_identity: "attempt-frontier-1".into(),
            attempt_frontier_digest: format!("sha256:{}", "4".repeat(64)),
            candidate_set_frontier_identity: "candidate-frontier-1".into(),
            candidate_set_frontier_digest: format!("sha256:{}", "5".repeat(64)),
            request_identity: "request-1".into(),
            request_digest: format!("sha256:{}", "6".repeat(64)),
            result_identity: "result-1".into(),
            result_digest: format!("sha256:{}", "7".repeat(64)),
            attempt_identity: "attempt-1".into(),
        };
        RepairInputDecisionActionResponseV1 {
            schema_version: 1,
            decision_identity: "decision-1".into(),
            decision_digest: format!("sha256:{}", "8".repeat(64)),
            evidence_cut,
            outcome: IterationDecisionOutcomeV1::RepairInputs {
                category: IterationRepairCategoryV1::MarketData,
                target: IterationRepairTargetV1::MarketData,
            },
            supported_defects: vec![IterationRepairCategoryV1::MarketData],
            receipt_identity: "decision-receipt-1".into(),
            result_identity: "result-1".into(),
            committed_at_epoch_ms: 17,
        }
    }

    fn send(
        body: serde_json::Value,
        authorization: Option<&str>,
    ) -> axum::http::Request<axum::body::Body> {
        let mut request = axum::http::Request::builder()
            .method(axum::http::Method::POST)
            .uri("/v1/iteration-decisions/repair-inputs")
            .header(axum::http::header::CONTENT_TYPE, "application/json");
        if let Some(authorization) = authorization {
            request = request.header(axum::http::header::AUTHORIZATION, authorization);
        }
        request
            .body(axum::body::Body::from(body.to_string()))
            .expect("HTTP request")
    }

    #[test]
    fn request_accepts_only_the_four_owner_locators() {
        serde_json::from_value::<DecisionCompositionRequestV1>(request())
            .expect("exact decision request");
        let mut injected = request();
        injected["diagnosis"] = json!({ "category": "MARKET_DATA" });
        assert!(serde_json::from_value::<DecisionCompositionRequestV1>(injected).is_err());
    }

    #[tokio::test]
    async fn rejection_stops_before_owner_and_keeps_the_request_unresolved() {
        let token = "iteration-decision-test";
        let token_digest: [u8; 32] = sha2::Sha256::digest(token.as_bytes()).into();
        let owner = Arc::new(DecisionOwnerStub {
            calls: AtomicUsize::new(0),
            response: None,
        });
        let unauthorized = action_router(owner.clone(), token_digest)
            .oneshot(send(request(), None))
            .await
            .expect("router response");
        assert_eq!(unauthorized.status(), StatusCode::FORBIDDEN);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);

        let mut invalid = request();
        invalid["result_identity"] = json!(" invalid");
        let invalid = action_router(owner.clone(), token_digest)
            .oneshot(send(invalid, Some(&format!("Bearer {token}"))))
            .await
            .expect("router response");
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);

        let no_decision = action_router(owner.clone(), token_digest)
            .oneshot(send(request(), Some(&format!("Bearer {token}"))))
            .await
            .expect("router response");
        assert_eq!(no_decision.status(), StatusCode::CONFLICT);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn exact_retry_returns_the_same_typed_owner_response() {
        let token = "iteration-decision-success-test";
        let token_digest: [u8; 32] = sha2::Sha256::digest(token.as_bytes()).into();
        let expected = response();
        let owner = Arc::new(DecisionOwnerStub {
            calls: AtomicUsize::new(0),
            response: Some(expected.clone()),
        });
        let mut bodies = Vec::new();
        for _ in 0..2 {
            let response = action_router(owner.clone(), token_digest)
                .oneshot(send(request(), Some(&format!("Bearer {token}"))))
                .await
                .expect("router response");
            assert_eq!(response.status(), StatusCode::OK);
            bodies.push(
                axum::body::to_bytes(response.into_body(), usize::MAX)
                    .await
                    .expect("typed response bytes"),
            );
        }
        assert_eq!(owner.calls.load(Ordering::SeqCst), 2);
        assert_eq!(bodies[0], bodies[1]);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&bodies[0]).expect("typed response JSON"),
            serde_json::to_value(expected).expect("expected response JSON"),
        );
    }
}
