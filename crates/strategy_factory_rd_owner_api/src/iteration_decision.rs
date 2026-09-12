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
use vibe_strategy_factory::{
    DecisionCompositionRequestV1, IterationDecisionPostgresErrorV1,
    RepairActionCompositionRequestV1,
    iteration_decision::{
        IterationDecisionEvidenceCutV1, IterationDecisionOutcomeV1, IterationRepairCategoryV1,
        RepairInputIterationDecisionReadbackV1, is_valid_iteration_decision_locator_v1,
    },
    product_edge_postgres::PostgresResearchGoalOwnerV1,
    repair_action::RepairActionRequestReadbackV1,
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

#[async_trait::async_trait]
trait RepairActionRequestActionPort: Send + Sync {
    async fn compose_repair_action(
        &self,
        request: RepairActionCompositionRequestV1,
    ) -> Result<RepairActionRequestActionResponseV1, IterationDecisionPostgresErrorV1>;
}

#[async_trait::async_trait]
impl RepairActionRequestActionPort for PostgresResearchGoalOwnerV1 {
    async fn compose_repair_action(
        &self,
        request: RepairActionCompositionRequestV1,
    ) -> Result<RepairActionRequestActionResponseV1, IterationDecisionPostgresErrorV1> {
        self.compose_repair_action_request_v1(request)
            .await
            .map(RepairActionRequestActionResponseV1::from)
    }
}

#[derive(Clone)]
struct RepairInputDecisionApiState {
    owner: Arc<dyn RepairInputDecisionActionPort>,
    token_digest: [u8; 32],
}

#[derive(Clone)]
struct RepairActionRequestApiState {
    owner: Arc<dyn RepairActionRequestActionPort>,
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

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct RepairActionRequestActionResponseV1 {
    schema_version: u16,
    action_request_identity: String,
    action_request_digest: String,
    decision_identity: String,
    decision_digest: String,
    result_identity: String,
    category: IterationRepairCategoryV1,
    target: vibe_strategy_factory::iteration_decision::IterationRepairTargetV1,
    receipt_identity: String,
    receipt_digest: String,
    committed_at_epoch_ms: u64,
}

impl From<RepairActionRequestReadbackV1> for RepairActionRequestActionResponseV1 {
    fn from(readback: RepairActionRequestReadbackV1) -> Self {
        let request = readback.request();
        let receipt = readback.receipt();
        Self {
            schema_version: 1,
            action_request_identity: request.action_request_identity().to_string(),
            action_request_digest: request.action_request_digest().to_string(),
            decision_identity: request.decision_identity().to_string(),
            decision_digest: request.decision_digest().to_string(),
            result_identity: request.result_identity().to_string(),
            category: request.category(),
            target: request.target(),
            receipt_identity: receipt.receipt_identity().to_string(),
            receipt_digest: receipt.receipt_digest().to_string(),
            committed_at_epoch_ms: receipt.committed_at_epoch_ms(),
        }
    }
}

pub(super) fn router(owner: Arc<PostgresResearchGoalOwnerV1>, token_digest: [u8; 32]) -> Router {
    action_router(owner.clone(), token_digest).merge(repair_action_router(owner, token_digest))
}

fn repair_action_router(
    owner: Arc<dyn RepairActionRequestActionPort>,
    token_digest: [u8; 32],
) -> Router {
    Router::new()
        .route(
            "/v1/repair-action-requests",
            post(compose_repair_action_request),
        )
        .with_state(RepairActionRequestApiState {
            owner,
            token_digest,
        })
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
    .any(|identity| !is_valid_iteration_decision_locator_v1(identity))
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

async fn compose_repair_action_request(
    State(state): State<RepairActionRequestApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return repair_action_rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }
    let request: RepairActionCompositionRequestV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return repair_action_rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let decision_identity = request.decision_identity.clone();
    if !is_valid_iteration_decision_locator_v1(&request.decision_identity)
        || !is_valid_iteration_decision_locator_v1(&request.result_identity)
    {
        return repair_action_rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_REPAIR_ACTION_REQUEST_LOCATORS",
            &decision_identity,
        );
    }
    match state.owner.compose_repair_action(request).await {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(error) => repair_action_owner_error(&error, &decision_identity),
    }
}

fn owner_error(error: &IterationDecisionPostgresErrorV1, request_identity: &str) -> Response {
    owner_error_with(
        error,
        request_identity,
        "INVALID_ITERATION_DECISION_LOCATORS",
        rejection,
    )
}

fn repair_action_owner_error(
    error: &IterationDecisionPostgresErrorV1,
    decision_identity: &str,
) -> Response {
    owner_error_with(
        error,
        decision_identity,
        "INVALID_REPAIR_ACTION_REQUEST_LOCATORS",
        repair_action_rejection,
    )
}

fn owner_error_with(
    error: &IterationDecisionPostgresErrorV1,
    correlation_identity: &str,
    invalid_locator_code: &str,
    reject: fn(StatusCode, &str, &str) -> Response,
) -> Response {
    match error {
        IterationDecisionPostgresErrorV1::InvalidLocator => reject(
            StatusCode::BAD_REQUEST,
            invalid_locator_code,
            correlation_identity,
        ),
        IterationDecisionPostgresErrorV1::NoDecision(_) => reject(
            StatusCode::CONFLICT,
            "ITERATION_DECISION_NOT_AVAILABLE",
            correlation_identity,
        ),
        IterationDecisionPostgresErrorV1::InterpretationRequired => reject(
            StatusCode::CONFLICT,
            "ITERATION_INTERPRETATION_REQUIRED",
            correlation_identity,
        ),
        IterationDecisionPostgresErrorV1::TrialFamily(_)
        | IterationDecisionPostgresErrorV1::Backtest(_)
        | IterationDecisionPostgresErrorV1::Decision(_)
        | IterationDecisionPostgresErrorV1::RepairAction(_)
        | IterationDecisionPostgresErrorV1::Storage(_) => reject(
            StatusCode::SERVICE_UNAVAILABLE,
            "ITERATION_DECISION_OWNER_UNAVAILABLE",
            correlation_identity,
        ),
    }
}

fn rejection(status: StatusCode, code: &str, request_identity: &str) -> Response {
    correlated_rejection(status, code, "request_identity", request_identity)
}

fn repair_action_rejection(status: StatusCode, code: &str, decision_identity: &str) -> Response {
    correlated_rejection(status, code, "decision_identity", decision_identity)
}

fn correlated_rejection(
    status: StatusCode,
    code: &str,
    identity_field: &str,
    identity: &str,
) -> Response {
    let mut body = serde_json::Map::new();
    body.insert(identity_field.to_string(), json!(identity));
    body.insert("error".to_string(), json!(code));
    let mut response = (status, Json(serde_json::Value::Object(body))).into_response();
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

    struct RepairActionOwnerStub {
        calls: AtomicUsize,
        response: Option<RepairActionRequestActionResponseV1>,
    }

    #[async_trait::async_trait]
    impl RepairActionRequestActionPort for RepairActionOwnerStub {
        async fn compose_repair_action(
            &self,
            _request: RepairActionCompositionRequestV1,
        ) -> Result<RepairActionRequestActionResponseV1, IterationDecisionPostgresErrorV1> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.response.clone().ok_or_else(|| {
                IterationDecisionPostgresErrorV1::Storage("test owner unavailable".into())
            })
        }
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

    fn repair_action_request() -> serde_json::Value {
        json!({
            "decision_identity": "decision-1",
            "result_identity": "result-1",
        })
    }

    fn repair_action_response() -> RepairActionRequestActionResponseV1 {
        RepairActionRequestActionResponseV1 {
            schema_version: 1,
            action_request_identity: "repair-action-1".into(),
            action_request_digest: format!("sha256:{}", "a".repeat(64)),
            decision_identity: "decision-1".into(),
            decision_digest: format!("sha256:{}", "b".repeat(64)),
            result_identity: "result-1".into(),
            category: IterationRepairCategoryV1::MarketData,
            target: IterationRepairTargetV1::MarketData,
            receipt_identity: "repair-action-receipt-1".into(),
            receipt_digest: format!("sha256:{}", "c".repeat(64)),
            committed_at_epoch_ms: 19,
        }
    }

    fn send(
        body: serde_json::Value,
        authorization: Option<&str>,
    ) -> axum::http::Request<axum::body::Body> {
        send_to("/v1/iteration-decisions/repair-inputs", body, authorization)
    }

    fn send_to(
        uri: &str,
        body: serde_json::Value,
        authorization: Option<&str>,
    ) -> axum::http::Request<axum::body::Body> {
        let mut request = axum::http::Request::builder()
            .method(axum::http::Method::POST)
            .uri(uri)
            .header(axum::http::header::CONTENT_TYPE, "application/json");
        if let Some(authorization) = authorization {
            request = request.header(axum::http::header::AUTHORIZATION, authorization);
        }
        request
            .body(axum::body::Body::from(body.to_string()))
            .expect("HTTP request")
    }

    async fn response_json(response: Response) -> serde_json::Value {
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response bytes");
        serde_json::from_slice(&body).expect("response JSON")
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
        for invalid_identity in ["a", "result/1"] {
            invalid["result_identity"] = json!(invalid_identity);
            let response = action_router(owner.clone(), token_digest)
                .oneshot(send(invalid.clone(), Some(&format!("Bearer {token}"))))
                .await
                .expect("router response");
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
            assert_eq!(owner.calls.load(Ordering::SeqCst), 0);
        }

        let no_decision = action_router(owner.clone(), token_digest)
            .oneshot(send(request(), Some(&format!("Bearer {token}"))))
            .await
            .expect("router response");
        assert_eq!(no_decision.status(), StatusCode::CONFLICT);
        assert_eq!(
            response_json(no_decision).await,
            json!({
                "request_identity": "request-1",
                "error": "ITERATION_DECISION_NOT_AVAILABLE",
            })
        );
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

    #[test]
    fn repair_action_request_accepts_only_decision_and_result_locators() {
        serde_json::from_value::<RepairActionCompositionRequestV1>(repair_action_request())
            .expect("exact repair action request");
        let mut injected = repair_action_request();
        injected["execution"] = json!({ "provider": "caller-controlled" });
        assert!(serde_json::from_value::<RepairActionCompositionRequestV1>(injected).is_err());
    }

    #[tokio::test]
    async fn repair_action_rejections_stop_before_owner() {
        let token = "repair-action-test";
        let token_digest: [u8; 32] = sha2::Sha256::digest(token.as_bytes()).into();
        let owner = Arc::new(RepairActionOwnerStub {
            calls: AtomicUsize::new(0),
            response: None,
        });
        let unauthorized = repair_action_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/repair-action-requests",
                repair_action_request(),
                None,
            ))
            .await
            .expect("router response");
        assert_eq!(unauthorized.status(), StatusCode::FORBIDDEN);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);

        let mut invalid = repair_action_request();
        invalid["decision_identity"] = json!("decision/1");
        let invalid = repair_action_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/repair-action-requests",
                invalid,
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            response_json(invalid).await,
            json!({
                "decision_identity": "decision/1",
                "error": "INVALID_REPAIR_ACTION_REQUEST_LOCATORS",
            })
        );
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);

        let unavailable = repair_action_router(owner.clone(), token_digest)
            .oneshot(send_to(
                "/v1/repair-action-requests",
                repair_action_request(),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(unavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response_json(unavailable).await,
            json!({
                "decision_identity": "decision-1",
                "error": "ITERATION_DECISION_OWNER_UNAVAILABLE",
            })
        );
        assert_eq!(owner.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn repair_action_exact_retry_returns_the_same_typed_owner_response() {
        let token = "repair-action-success-test";
        let token_digest: [u8; 32] = sha2::Sha256::digest(token.as_bytes()).into();
        let expected = repair_action_response();
        let owner = Arc::new(RepairActionOwnerStub {
            calls: AtomicUsize::new(0),
            response: Some(expected.clone()),
        });
        let mut bodies = Vec::new();
        for _ in 0..2 {
            let response = repair_action_router(owner.clone(), token_digest)
                .oneshot(send_to(
                    "/v1/repair-action-requests",
                    repair_action_request(),
                    Some(&format!("Bearer {token}")),
                ))
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
