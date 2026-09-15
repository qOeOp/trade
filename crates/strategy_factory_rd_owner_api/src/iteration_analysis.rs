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
use vibe_strategy_factory::{
    iteration_analysis::{
        IterationAnalysisCompletionProposalV1, IterationAnalysisCompletionReadbackV1,
        IterationAnalysisCompletionResolutionLocatorV1, IterationAnalysisRequestErrorV1,
        IterationAnalysisRequestLocatorV1, IterationAnalysisRequestReadbackV1,
        IterationAnalysisResolutionLocatorV1,
    },
    iteration_analysis_postgres::{
        compose_iteration_analysis_completion_v1, compose_iteration_analysis_request_v1,
        resolve_iteration_analysis_completion_v1, resolve_iteration_analysis_request_v1,
    },
    iteration_decision::is_valid_iteration_decision_locator_v1,
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

#[derive(Clone)]
struct IterationAnalysisApiState {
    owner: Arc<dyn IterationAnalysisRequestPort>,
    token_digest: [u8; 32],
}

pub(super) fn router(owner: Arc<PostgresResearchGoalOwnerV1>, token_digest: [u8; 32]) -> Router {
    iteration_analysis_router(owner, token_digest)
}

fn iteration_analysis_router(
    owner: Arc<dyn IterationAnalysisRequestPort>,
    token_digest: [u8; 32],
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
            owner,
            token_digest,
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
    let proposal: IterationAnalysisCompletionProposalV1 = match serde_json::from_slice(&body) {
        Ok(proposal) => proposal,
        Err(_) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let result_identity = proposal.result_identity.clone();
    match state.owner.complete(proposal).await {
        Ok(readback) => (StatusCode::OK, Json(readback)).into_response(),
        Err(error) => owner_error(&error, &result_identity),
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
        Err(error) => owner_error(&error, &result_identity),
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
        Err(error) => owner_error(&error, &result_identity),
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
        Err(error) => owner_error(&error, &result_identity),
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

    use sha2::{Digest as _, Sha256};
    use tower::ServiceExt;

    use super::*;

    struct OwnerStub {
        compose_calls: AtomicUsize,
        resolve_calls: AtomicUsize,
        completion_calls: AtomicUsize,
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
            _proposal: IterationAnalysisCompletionProposalV1,
        ) -> Result<IterationAnalysisCompletionReadbackV1, IterationAnalysisRequestErrorV1>
        {
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

    fn send(
        uri: &str,
        body: serde_json::Value,
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

    #[test]
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

    #[test]
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
            compose_calls: AtomicUsize::new(0),
            resolve_calls: AtomicUsize::new(0),
            completion_calls: AtomicUsize::new(0),
        });
        let unauthorized = iteration_analysis_router(owner.clone(), digest)
            .oneshot(send("/v1/iteration-analysis-requests", locator(), None))
            .await
            .expect("response");
        assert_eq!(unauthorized.status(), StatusCode::FORBIDDEN);
        let unauthorized_completion = iteration_analysis_router(owner.clone(), digest)
            .oneshot(send("/v1/iteration-analysis-results", json!({}), None))
            .await
            .expect("response");
        assert_eq!(unauthorized_completion.status(), StatusCode::FORBIDDEN);
        let malformed = iteration_analysis_router(owner.clone(), digest)
            .oneshot(send(
                "/v1/iteration-analysis-requests",
                json!({"result_identity": "result-1"}),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("response");
        assert_eq!(malformed.status(), StatusCode::BAD_REQUEST);
        assert_eq!(owner.compose_calls.load(Ordering::SeqCst), 0);
        assert_eq!(owner.completion_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn resolve_is_read_only_and_cannot_first_create() {
        let token = "iteration-analysis-test";
        let digest: [u8; 32] = Sha256::digest(token.as_bytes()).into();
        let owner = Arc::new(OwnerStub {
            compose_calls: AtomicUsize::new(0),
            resolve_calls: AtomicUsize::new(0),
            completion_calls: AtomicUsize::new(0),
        });
        let response = iteration_analysis_router(owner.clone(), digest)
            .oneshot(send(
                "/v1/iteration-analysis-requests/resolve",
                locator(),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(owner.compose_calls.load(Ordering::SeqCst), 0);
        assert_eq!(owner.resolve_calls.load(Ordering::SeqCst), 1);
    }
}
