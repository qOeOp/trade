//! Authenticated locator-only transport for R&D iteration-analysis work requests.

use std::sync::Arc;

use axum::{
    Json, Router,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use serde_json::json;
use vibe_product_edge::{
    ProductEdgeAdmissionLocatorV1, ProductEdgeAdmissionRequestV1, ProductEdgeError,
    ProductEdgePostgresOwnerV1,
};
use vibe_strategy_factory::{
    iteration_analysis::{
        ITERATION_ANALYSIS_COMPLETION_MUTATION_EFFECT_V1,
        ITERATION_ANALYSIS_COMPLETION_OPERATION_V1, ITERATION_ANALYSIS_COMPLETION_SCHEMA_V1,
        IterationAnalysisCompletionOperationRequestV1, IterationAnalysisCompletionProposalV1,
        IterationAnalysisCompletionReadbackV1, IterationAnalysisCompletionResolutionLocatorV1,
        IterationAnalysisRequestErrorV1, IterationAnalysisRequestLocatorV1,
        IterationAnalysisRequestReadbackV1, IterationAnalysisResolutionLocatorV1,
    },
    iteration_analysis_postgres::{
        compose_iteration_analysis_completion_v1, compose_iteration_analysis_request_v1,
        resolve_iteration_analysis_completion_v1, resolve_iteration_analysis_request_v1,
    },
    iteration_decision::is_valid_iteration_decision_locator_v1,
    product_edge::RESEARCH_OWNER_V1,
    product_edge_postgres::PostgresResearchGoalOwnerV1,
};

use super::{authorized, insert_rejection_code};

#[async_trait::async_trait]
trait IterationAnalysisRequestPort: Send + Sync {
    async fn compose(
        &self,
        locator: IterationAnalysisRequestLocatorV1,
    ) -> Result<IterationAnalysisRequestReadbackV1, IterationAnalysisRequestErrorV1>;

    async fn resolve(
        &self,
        locator: IterationAnalysisResolutionLocatorV1,
    ) -> Result<Option<IterationAnalysisRequestReadbackV1>, IterationAnalysisRequestErrorV1>;

    async fn complete(
        &self,
        proposal: IterationAnalysisCompletionProposalV1,
    ) -> Result<IterationAnalysisCompletionReadbackV1, IterationAnalysisRequestErrorV1>;

    async fn resolve_completion(
        &self,
        locator: IterationAnalysisCompletionResolutionLocatorV1,
    ) -> Result<Option<IterationAnalysisCompletionReadbackV1>, IterationAnalysisRequestErrorV1>;
}

#[async_trait::async_trait]
impl IterationAnalysisRequestPort for PostgresResearchGoalOwnerV1 {
    async fn compose(
        &self,
        locator: IterationAnalysisRequestLocatorV1,
    ) -> Result<IterationAnalysisRequestReadbackV1, IterationAnalysisRequestErrorV1> {
        compose_iteration_analysis_request_v1(self, locator).await
    }

    async fn resolve(
        &self,
        locator: IterationAnalysisResolutionLocatorV1,
    ) -> Result<Option<IterationAnalysisRequestReadbackV1>, IterationAnalysisRequestErrorV1> {
        resolve_iteration_analysis_request_v1(self, locator).await
    }

    async fn complete(
        &self,
        proposal: IterationAnalysisCompletionProposalV1,
    ) -> Result<IterationAnalysisCompletionReadbackV1, IterationAnalysisRequestErrorV1> {
        compose_iteration_analysis_completion_v1(self, proposal).await
    }

    async fn resolve_completion(
        &self,
        locator: IterationAnalysisCompletionResolutionLocatorV1,
    ) -> Result<Option<IterationAnalysisCompletionReadbackV1>, IterationAnalysisRequestErrorV1>
    {
        resolve_iteration_analysis_completion_v1(self, locator).await
    }
}

#[async_trait::async_trait]
trait IterationAnalysisCompletionAdmissionPort: Send + Sync {
    async fn admit_completion(
        &self,
        request: &IterationAnalysisCompletionOperationRequestV1,
        request_proof_digest: &str,
    ) -> Result<ProductEdgeAdmissionLocatorV1, ProductEdgeError>;
}

#[async_trait::async_trait]
impl IterationAnalysisCompletionAdmissionPort for ProductEdgePostgresOwnerV1 {
    async fn admit_completion(
        &self,
        request: &IterationAnalysisCompletionOperationRequestV1,
        request_proof_digest: &str,
    ) -> Result<ProductEdgeAdmissionLocatorV1, ProductEdgeError> {
        self.admit_request(ProductEdgeAdmissionRequestV1 {
            request_identity: request.analysis_request_identity.clone(),
            typed_payload: serde_json::to_value(request)
                .map_err(|e| ProductEdgeError::Storage(e.to_string()))?,
            operation: ITERATION_ANALYSIS_COMPLETION_OPERATION_V1.to_string(),
            operation_schema: ITERATION_ANALYSIS_COMPLETION_SCHEMA_V1.to_string(),
            target_owner: RESEARCH_OWNER_V1.to_string(),
            requested_effects: vec![ITERATION_ANALYSIS_COMPLETION_MUTATION_EFFECT_V1.to_string()],
            request_proof_digest: request_proof_digest.to_string(),
            audit_correlation: format!(
                "rd-iteration-analysis:{}",
                request.analysis_request_identity
            ),
        })
        .await
        .map(|readback| readback.locator().clone())
    }
}

#[derive(Clone)]
struct IterationAnalysisApiState {
    admission: Arc<dyn IterationAnalysisCompletionAdmissionPort>,
    owner: Arc<dyn IterationAnalysisRequestPort>,
    token_digest: [u8; 32],
    request_proof_digest: String,
}

pub(super) fn router(
    product_edge: Arc<ProductEdgePostgresOwnerV1>,
    owner: Arc<PostgresResearchGoalOwnerV1>,
    token_digest: [u8; 32],
    request_proof_digest: String,
) -> Router {
    iteration_analysis_router(product_edge, owner, token_digest, request_proof_digest)
}

fn iteration_analysis_router(
    admission: Arc<dyn IterationAnalysisCompletionAdmissionPort>,
    owner: Arc<dyn IterationAnalysisRequestPort>,
    token_digest: [u8; 32],
    request_proof_digest: String,
) -> Router {
    Router::new()
        .route(
            "/v1/iteration-analysis-requests",
            post(compose_iteration_analysis),
        )
        .route(
            "/v1/iteration-analysis-requests/resolve",
            post(resolve_iteration_analysis),
        )
        .route(
            "/v1/iteration-analysis-results",
            post(complete_iteration_analysis),
        )
        .route(
            "/v1/iteration-analysis-results/resolve",
            post(resolve_iteration_analysis_completion),
        )
        .with_state(IterationAnalysisApiState {
            admission,
            owner,
            token_digest,
            request_proof_digest,
        })
}

async fn complete_iteration_analysis(
    State(state): State<IterationAnalysisApiState>,
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
    let operation: IterationAnalysisCompletionOperationRequestV1 =
        match serde_json::from_slice(&body) {
            Ok(operation) => operation,
            Err(_) => {
                return rejection(
                    StatusCode::BAD_REQUEST,
                    "MALFORMED_TYPED_REQUEST",
                    "unbound",
                );
            }
        };
    let result_identity = operation.result_identity.clone();
    if operation.validate().is_err() {
        return rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_ITERATION_ANALYSIS_COMPLETION_PROPOSAL",
            &result_identity,
        );
    }
    let admission = match state
        .admission
        .admit_completion(&operation, &state.request_proof_digest)
        .await
    {
        Ok(admission) => admission,
        Err(ProductEdgeError::ConflictingReplay) => {
            return rejection(
                StatusCode::CONFLICT,
                "CONFLICTING_PRODUCT_EDGE_REPLAY",
                &result_identity,
            );
        }
        Err(ProductEdgeError::InvalidProposal(_)) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "INVALID_PRODUCT_EDGE_ITERATION_ANALYSIS_ADMISSION",
                &result_identity,
            );
        }
        Err(ProductEdgeError::Unavailable(_) | ProductEdgeError::Storage(_)) => {
            return rejection(
                StatusCode::SERVICE_UNAVAILABLE,
                "PRODUCT_EDGE_ITERATION_ANALYSIS_ADMISSION_UNAVAILABLE",
                &result_identity,
            );
        }
    };
    let proposal = match operation.with_admission(admission) {
        Ok(proposal) => proposal,
        Err(_) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "INVALID_PRODUCT_EDGE_ITERATION_ANALYSIS_ADMISSION",
                &result_identity,
            );
        }
    };

    match state.owner.complete(proposal).await {
        Ok(readback) => (StatusCode::OK, Json(readback)).into_response(),
        Err(e) => owner_error(&e, &result_identity),
    }
}

async fn resolve_iteration_analysis_completion(
    State(state): State<IterationAnalysisApiState>,
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
    let locator: IterationAnalysisCompletionResolutionLocatorV1 =
        match serde_json::from_slice(&body) {
            Ok(locator) => locator,
            Err(_) => {
                return rejection(
                    StatusCode::BAD_REQUEST,
                    "MALFORMED_TYPED_REQUEST",
                    "unbound",
                );
            }
        };
    let result_identity = locator.result_identity.clone();
    match state.owner.resolve_completion(locator).await {
        Ok(Some(readback)) => (StatusCode::OK, Json(readback)).into_response(),
        Ok(None) => rejection(
            StatusCode::NOT_FOUND,
            "ITERATION_ANALYSIS_RESULT_NOT_FOUND",
            &result_identity,
        ),
        Err(e) => owner_error(&e, &result_identity),
    }
}

async fn compose_iteration_analysis(
    State(state): State<IterationAnalysisApiState>,
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
    let locator: IterationAnalysisRequestLocatorV1 = match serde_json::from_slice(&body) {
        Ok(locator) => locator,
        Err(_) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let result_identity = locator.result_identity.clone();
    if !valid_locator(
        &locator.trial_family_identity,
        &locator.result_identity,
        &locator.request_identity,
        &locator.attempt_identity,
    ) {
        return rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_ITERATION_ANALYSIS_LOCATORS",
            &result_identity,
        );
    }

    match state.owner.compose(locator).await {
        Ok(readback) => (StatusCode::OK, Json(readback)).into_response(),
        Err(e) => owner_error(&e, &result_identity),
    }
}

async fn resolve_iteration_analysis(
    State(state): State<IterationAnalysisApiState>,
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
    let locator: IterationAnalysisResolutionLocatorV1 = match serde_json::from_slice(&body) {
        Ok(locator) => locator,
        Err(_) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let result_identity = locator.result_identity.clone();
    if !valid_locator(
        &locator.trial_family_identity,
        &locator.result_identity,
        &locator.request_identity,
        &locator.attempt_identity,
    ) {
        return rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_ITERATION_ANALYSIS_LOCATORS",
            &result_identity,
        );
    }

    match state.owner.resolve(locator).await {
        Ok(Some(readback)) => (StatusCode::OK, Json(readback)).into_response(),
        Ok(None) => rejection(
            StatusCode::NOT_FOUND,
            "ITERATION_ANALYSIS_REQUEST_NOT_FOUND",
            &result_identity,
        ),
        Err(e) => owner_error(&e, &result_identity),
    }
}

fn valid_locator(family: &str, result: &str, request: &str, attempt: &str) -> bool {
    [family, result, request, attempt]
        .into_iter()
        .all(is_valid_iteration_decision_locator_v1)
}

fn owner_error(error: &IterationAnalysisRequestErrorV1, result_identity: &str) -> Response {
    let (status, code) = match error {
        IterationAnalysisRequestErrorV1::InvalidLocator => (
            StatusCode::BAD_REQUEST,
            "INVALID_ITERATION_ANALYSIS_LOCATORS",
        ),
        IterationAnalysisRequestErrorV1::NotApplicable => {
            (StatusCode::CONFLICT, "ITERATION_ANALYSIS_NOT_APPLICABLE")
        }
        IterationAnalysisRequestErrorV1::Conflict => {
            (StatusCode::CONFLICT, "ITERATION_ANALYSIS_CONFLICT")
        }
        IterationAnalysisRequestErrorV1::Unavailable(_) => {
            (StatusCode::CONFLICT, "ITERATION_ANALYSIS_INPUT_UNAVAILABLE")
        }
        IterationAnalysisRequestErrorV1::Storage(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "ITERATION_ANALYSIS_OWNER_UNAVAILABLE",
        ),
    };
    rejection(status, code, result_identity)
}

fn rejection(status: StatusCode, code: &str, result_identity: &str) -> Response {
    let mut response = (
        status,
        Json(json!({
            "error": code,
            "result_identity": result_identity,
        })),
    )
        .into_response();
    insert_rejection_code(&mut response, code);
    response
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use rstest::rstest;
    use sha2::{Digest as _, Sha256};
    use tower::ServiceExt;

    use super::*;

    struct OwnerStub {
        admission_calls: AtomicUsize,
        compose_calls: AtomicUsize,
        resolve_calls: AtomicUsize,
        completion_calls: AtomicUsize,
    }

    #[async_trait::async_trait]
    impl IterationAnalysisCompletionAdmissionPort for OwnerStub {
        async fn admit_completion(
            &self,
            request: &IterationAnalysisCompletionOperationRequestV1,
            _request_proof_digest: &str,
        ) -> Result<ProductEdgeAdmissionLocatorV1, ProductEdgeError> {
            self.admission_calls.fetch_add(1, Ordering::SeqCst);
            Ok(ProductEdgeAdmissionLocatorV1 {
                request_identity: request.analysis_request_identity.clone(),
                admission_identity: "iteration-analysis-admission-1".to_string(),
                admission_digest: format!("sha256:{}", "b".repeat(64)),
            })
        }
    }

    #[async_trait::async_trait]
    impl IterationAnalysisRequestPort for OwnerStub {
        async fn compose(
            &self,
            _locator: IterationAnalysisRequestLocatorV1,
        ) -> Result<IterationAnalysisRequestReadbackV1, IterationAnalysisRequestErrorV1> {
            self.compose_calls.fetch_add(1, Ordering::SeqCst);
            Err(IterationAnalysisRequestErrorV1::NotApplicable)
        }

        async fn resolve(
            &self,
            _locator: IterationAnalysisResolutionLocatorV1,
        ) -> Result<Option<IterationAnalysisRequestReadbackV1>, IterationAnalysisRequestErrorV1>
        {
            self.resolve_calls.fetch_add(1, Ordering::SeqCst);
            Ok(None)
        }

        async fn complete(
            &self,
            proposal: IterationAnalysisCompletionProposalV1,
        ) -> Result<IterationAnalysisCompletionReadbackV1, IterationAnalysisRequestErrorV1>
        {
            assert_eq!(
                proposal.admission.request_identity,
                proposal.analysis_request_identity
            );
            self.completion_calls.fetch_add(1, Ordering::SeqCst);
            Err(IterationAnalysisRequestErrorV1::NotApplicable)
        }

        async fn resolve_completion(
            &self,
            _locator: IterationAnalysisCompletionResolutionLocatorV1,
        ) -> Result<Option<IterationAnalysisCompletionReadbackV1>, IterationAnalysisRequestErrorV1>
        {
            self.completion_calls.fetch_add(1, Ordering::SeqCst);
            Ok(None)
        }
    }

    fn locator() -> serde_json::Value {
        json!({
            "trial_family_identity": "trial-family-1",
            "result_identity": "result-1",
            "request_identity": "request-1",
            "attempt_identity": "attempt-1",
        })
    }

    fn completion_operation() -> serde_json::Value {
        let digest = format!("sha256:{}", "a".repeat(64));
        let finding = json!({
            "conclusion": "ESTABLISHED",
            "evidence": [{"identity": "evidence-1", "digest": digest}],
        });
        json!({
            "analysis_request_identity": "analysis-request-1",
            "analysis_request_digest": digest,
            "result_identity": "result-1",
            "mechanism_validity": finding,
            "economic_viability": finding,
            "robustness": finding,
            "information_value": finding,
            "candidate_evaluations": {
                "frontier_identity": "frontier-1",
                "frontier_digest": digest,
                "generation_rule_identity": "generation-rule-1",
                "generation_rule_digest": digest,
                "expected_cardinality": 0,
                "threshold": {"identity": "threshold-1", "digest": digest},
                "candidates": [],
            },
        })
    }

    fn test_router(owner: Arc<OwnerStub>, token_digest: [u8; 32]) -> Router {
        iteration_analysis_router(
            owner.clone(),
            owner,
            token_digest,
            format!("sha256:{}", "c".repeat(64)),
        )
    }

    fn send(
        uri: &str,
        body: &serde_json::Value,
        token: Option<&str>,
    ) -> axum::http::Request<axum::body::Body> {
        let mut request = axum::http::Request::builder()
            .method(axum::http::Method::POST)
            .uri(uri)
            .header(axum::http::header::CONTENT_TYPE, "application/json");
        if let Some(token) = token {
            request = request.header(axum::http::header::AUTHORIZATION, token);
        }
        request
            .body(axum::body::Body::from(body.to_string()))
            .expect("HTTP request")
    }

    #[rstest]
    fn transport_accepts_only_owner_locators() {
        serde_json::from_value::<IterationAnalysisRequestLocatorV1>(locator())
            .expect("exact locator");
        let mut injected = locator();
        injected["diagnosis"] = json!({"category": "ECONOMIC"});
        assert!(serde_json::from_value::<IterationAnalysisRequestLocatorV1>(injected).is_err());

        let mut projected = locator();
        projected["backtest_projection"] = json!({
            "outcome": "completed",
            "return_statistics": {"Sharpe Ratio (252 days)": "3ff0000000000000"}
        });
        assert!(serde_json::from_value::<IterationAnalysisRequestLocatorV1>(projected).is_err());
    }

    #[rstest]
    fn typed_storage_failure_is_a_retryable_owner_outage() {
        let response = owner_error(
            &IterationAnalysisRequestErrorV1::Storage("database".to_string()),
            "result-1",
        );
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response.headers().get("x-rd-rejection-code"),
            Some(&axum::http::HeaderValue::from_static(
                "ITERATION_ANALYSIS_OWNER_UNAVAILABLE"
            ))
        );
    }

    #[tokio::test]
    async fn authorization_and_malformed_requests_stop_before_owner() {
        let token = "iteration-analysis-test";
        let digest: [u8; 32] = Sha256::digest(token.as_bytes()).into();
        let owner = Arc::new(OwnerStub {
            admission_calls: AtomicUsize::new(0),
            compose_calls: AtomicUsize::new(0),
            resolve_calls: AtomicUsize::new(0),
            completion_calls: AtomicUsize::new(0),
        });
        let unauthorized = test_router(owner.clone(), digest)
            .oneshot(send("/v1/iteration-analysis-requests", &locator(), None))
            .await
            .expect("response");
        assert_eq!(unauthorized.status(), StatusCode::FORBIDDEN);
        let unauthorized_completion = test_router(owner.clone(), digest)
            .oneshot(send("/v1/iteration-analysis-results", &json!({}), None))
            .await
            .expect("response");
        assert_eq!(unauthorized_completion.status(), StatusCode::FORBIDDEN);
        let malformed = test_router(owner.clone(), digest)
            .oneshot(send(
                "/v1/iteration-analysis-requests",
                &json!({"result_identity": "result-1"}),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("response");
        assert_eq!(malformed.status(), StatusCode::BAD_REQUEST);
        let malformed_completion = test_router(owner.clone(), digest)
            .oneshot(send(
                "/v1/iteration-analysis-results",
                &json!({"result_identity": "result-1"}),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("response");
        assert_eq!(malformed_completion.status(), StatusCode::BAD_REQUEST);
        assert_eq!(owner.admission_calls.load(Ordering::SeqCst), 0);
        assert_eq!(owner.compose_calls.load(Ordering::SeqCst), 0);
        assert_eq!(owner.completion_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn completion_is_admitted_before_owner_and_caller_cannot_choose_action() {
        let token = "iteration-analysis-completion-test";
        let digest: [u8; 32] = Sha256::digest(token.as_bytes()).into();
        let owner = Arc::new(OwnerStub {
            admission_calls: AtomicUsize::new(0),
            compose_calls: AtomicUsize::new(0),
            resolve_calls: AtomicUsize::new(0),
            completion_calls: AtomicUsize::new(0),
        });
        let response = test_router(owner.clone(), digest)
            .oneshot(send(
                "/v1/iteration-analysis-results",
                &completion_operation(),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert_eq!(owner.admission_calls.load(Ordering::SeqCst), 1);
        assert_eq!(owner.completion_calls.load(Ordering::SeqCst), 1);

        let mut injected = completion_operation();
        injected["next_action"] = json!("CREATE_SUCCESSOR_INTENT");
        let rejected = test_router(owner.clone(), digest)
            .oneshot(send(
                "/v1/iteration-analysis-results",
                &injected,
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("response");
        assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
        assert_eq!(owner.admission_calls.load(Ordering::SeqCst), 1);
        assert_eq!(owner.completion_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn resolve_is_read_only_and_cannot_first_create() {
        let token = "iteration-analysis-test";
        let digest: [u8; 32] = Sha256::digest(token.as_bytes()).into();
        let owner = Arc::new(OwnerStub {
            admission_calls: AtomicUsize::new(0),
            compose_calls: AtomicUsize::new(0),
            resolve_calls: AtomicUsize::new(0),
            completion_calls: AtomicUsize::new(0),
        });
        let response = test_router(owner.clone(), digest)
            .oneshot(send(
                "/v1/iteration-analysis-requests/resolve",
                &locator(),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(owner.compose_calls.load(Ordering::SeqCst), 0);
        assert_eq!(owner.resolve_calls.load(Ordering::SeqCst), 1);
    }
}
