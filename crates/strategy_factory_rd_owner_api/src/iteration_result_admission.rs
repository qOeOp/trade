//! Authenticated locator-only transport for R&D iteration result admission.
//!
//! The caller supplies only the operation request. Every admitted fact is derived by the R&D Owner
//! inside its own serializable transaction from the locked canonical Backtest Result, the sealed
//! TrialFamily budget and the census frontier; this adapter neither mints nor inspects that custody.

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
    iteration_result_admission::{
        IterationResultAdmissionErrorV1, IterationResultAdmissionLocatorV1,
        IterationResultAdmissionOperationRequestV1, IterationResultAdmissionReadbackV1,
    },
    product_edge_postgres::PostgresResearchGoalOwnerV1,
};

use super::{authorized, insert_rejection_code};

#[async_trait::async_trait]
trait IterationResultAdmissionPort: Send + Sync {
    async fn admit(
        &self,
        request: IterationResultAdmissionOperationRequestV1,
    ) -> Result<IterationResultAdmissionReadbackV1, IterationResultAdmissionErrorV1>;

    async fn resolve(
        &self,
        locator: IterationResultAdmissionLocatorV1,
    ) -> Result<Option<IterationResultAdmissionReadbackV1>, IterationResultAdmissionErrorV1>;
}

#[async_trait::async_trait]
impl IterationResultAdmissionPort for PostgresResearchGoalOwnerV1 {
    async fn admit(
        &self,
        request: IterationResultAdmissionOperationRequestV1,
    ) -> Result<IterationResultAdmissionReadbackV1, IterationResultAdmissionErrorV1> {
        self.admit_iteration_result_v1(&request).await
    }

    async fn resolve(
        &self,
        locator: IterationResultAdmissionLocatorV1,
    ) -> Result<Option<IterationResultAdmissionReadbackV1>, IterationResultAdmissionErrorV1> {
        self.resolve_iteration_result_admission_v1(&locator).await
    }
}

#[derive(Clone)]
struct IterationResultAdmissionApiState {
    owner: Arc<dyn IterationResultAdmissionPort>,
    token_digest: [u8; 32],
}

pub(super) fn router(owner: Arc<PostgresResearchGoalOwnerV1>, token_digest: [u8; 32]) -> Router {
    iteration_result_admission_router(owner, token_digest)
}

fn iteration_result_admission_router(
    owner: Arc<dyn IterationResultAdmissionPort>,
    token_digest: [u8; 32],
) -> Router {
    Router::new()
        .route(
            "/v1/iteration-result-admissions",
            post(admit_iteration_result),
        )
        .route(
            "/v1/iteration-result-admissions/resolve",
            post(resolve_iteration_result_admission),
        )
        .with_state(IterationResultAdmissionApiState {
            owner,
            token_digest,
        })
}

async fn admit_iteration_result(
    State(state): State<IterationResultAdmissionApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(StatusCode::FORBIDDEN, "UNAUTHORIZED_PRODUCT_EDGE", "unbound");
    }
    let request: IterationResultAdmissionOperationRequestV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return rejection(StatusCode::BAD_REQUEST, "MALFORMED_TYPED_REQUEST", "unbound");
        }
    };
    let result_identity = request.locator.result_identity.clone();

    match state.owner.admit(request).await {
        Ok(readback) => (StatusCode::OK, Json(readback)).into_response(),
        Err(e) => owner_error(&e, &result_identity),
    }
}

async fn resolve_iteration_result_admission(
    State(state): State<IterationResultAdmissionApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(StatusCode::FORBIDDEN, "UNAUTHORIZED_PRODUCT_EDGE", "unbound");
    }
    let locator: IterationResultAdmissionLocatorV1 = match serde_json::from_slice(&body) {
        Ok(locator) => locator,
        Err(_) => {
            return rejection(StatusCode::BAD_REQUEST, "MALFORMED_TYPED_REQUEST", "unbound");
        }
    };
    let result_identity = locator.result_identity.clone();

    match state.owner.resolve(locator).await {
        Ok(Some(readback)) => (StatusCode::OK, Json(readback)).into_response(),
        Ok(None) => rejection(
            StatusCode::NOT_FOUND,
            "ITERATION_RESULT_ADMISSION_NOT_FOUND",
            &result_identity,
        ),
        Err(e) => owner_error(&e, &result_identity),
    }
}

fn owner_error(error: &IterationResultAdmissionErrorV1, result_identity: &str) -> Response {
    let (status, code) = match error {
        IterationResultAdmissionErrorV1::InvalidLocator => (
            StatusCode::BAD_REQUEST,
            "INVALID_ITERATION_RESULT_ADMISSION_LOCATORS",
        ),
        IterationResultAdmissionErrorV1::NotApplicable => (
            StatusCode::CONFLICT,
            "ITERATION_RESULT_ADMISSION_NOT_APPLICABLE",
        ),
        IterationResultAdmissionErrorV1::IdentityMismatch => (
            StatusCode::CONFLICT,
            "ITERATION_RESULT_ADMISSION_IDENTITY_MISMATCH",
        ),
        IterationResultAdmissionErrorV1::BudgetExceeded => (
            StatusCode::CONFLICT,
            "ITERATION_RESULT_ADMISSION_TRIAL_BUDGET_EXCEEDED",
        ),
        IterationResultAdmissionErrorV1::Conflict => {
            (StatusCode::CONFLICT, "ITERATION_RESULT_ADMISSION_CONFLICT")
        }
        IterationResultAdmissionErrorV1::Unavailable(_) => (
            StatusCode::CONFLICT,
            "ITERATION_RESULT_ADMISSION_INPUT_UNAVAILABLE",
        ),
        IterationResultAdmissionErrorV1::Storage(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "ITERATION_RESULT_ADMISSION_OWNER_UNAVAILABLE",
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
        admit_calls: AtomicUsize,
        resolve_calls: AtomicUsize,
    }

    #[async_trait::async_trait]
    impl IterationResultAdmissionPort for OwnerStub {
        async fn admit(
            &self,
            _request: IterationResultAdmissionOperationRequestV1,
        ) -> Result<IterationResultAdmissionReadbackV1, IterationResultAdmissionErrorV1> {
            self.admit_calls.fetch_add(1, Ordering::SeqCst);
            Err(IterationResultAdmissionErrorV1::NotApplicable)
        }

        async fn resolve(
            &self,
            _locator: IterationResultAdmissionLocatorV1,
        ) -> Result<Option<IterationResultAdmissionReadbackV1>, IterationResultAdmissionErrorV1>
        {
            self.resolve_calls.fetch_add(1, Ordering::SeqCst);
            Ok(None)
        }
    }

    fn digest() -> String {
        format!("sha256:{}", "a".repeat(64))
    }

    fn locator() -> serde_json::Value {
        json!({
            "trial_family_identity": "trial-family-1",
            "result_identity": "result-1",
            "request_identity": "request-1",
            "attempt_identity": "attempt-1",
        })
    }

    fn admission_request() -> serde_json::Value {
        json!({
            "locator": locator(),
            "result_digest": digest(),
            "request_meaning_digest": digest(),
            "proposals": {
                "generation_rule_identity": "generation-rule-1",
                "generation_rule_digest": digest(),
                "expected_cardinality": 1,
                "proposals": [{
                    "candidate_identity": "candidate-1",
                    "candidate_digest": digest(),
                    "experiment": {
                        "mode": "SINGLE_DIMENSION",
                        "changed_dimension": "ENTRY_RULE",
                    },
                }],
            },
        })
    }

    fn test_router(owner: Arc<OwnerStub>, token_digest: [u8; 32]) -> Router {
        iteration_result_admission_router(owner, token_digest)
    }

    /// The Owner API digests the credential after the `Bearer ` prefix, never the whole header.
    fn bearer(token: &str) -> String {
        format!("Bearer {token}")
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

    #[rstest]
    fn transport_accepts_only_caller_mintable_request_fields() {
        serde_json::from_value::<IterationResultAdmissionOperationRequestV1>(admission_request())
            .expect("exact admission request");
        serde_json::from_value::<IterationResultAdmissionLocatorV1>(locator()).expect("exact locator");

        // The caller cannot smuggle Owner-derived custody through either typed body.
        let mut projected = admission_request();
        projected["backtest"] = json!({"outcome": "completed"});
        assert!(
            serde_json::from_value::<IterationResultAdmissionOperationRequestV1>(projected).is_err()
        );

        let mut minted = admission_request();
        minted["admission_identity"] = json!("rd-iteration-result-admission-v1-forged");
        assert!(
            serde_json::from_value::<IterationResultAdmissionOperationRequestV1>(minted).is_err()
        );

        let mut injected = locator();
        injected["admission_digest"] = json!(digest());
        assert!(serde_json::from_value::<IterationResultAdmissionLocatorV1>(injected).is_err());
    }

    #[rstest]
    fn typed_storage_failure_is_a_retryable_owner_outage() {
        let response = owner_error(
            &IterationResultAdmissionErrorV1::Storage("database".to_string()),
            "result-1",
        );
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response.headers().get("x-rd-rejection-code"),
            Some(&axum::http::HeaderValue::from_static(
                "ITERATION_RESULT_ADMISSION_OWNER_UNAVAILABLE"
            ))
        );
    }

    #[rstest]
    #[case(IterationResultAdmissionErrorV1::InvalidLocator, StatusCode::BAD_REQUEST)]
    #[case(IterationResultAdmissionErrorV1::NotApplicable, StatusCode::CONFLICT)]
    #[case(IterationResultAdmissionErrorV1::IdentityMismatch, StatusCode::CONFLICT)]
    #[case(IterationResultAdmissionErrorV1::BudgetExceeded, StatusCode::CONFLICT)]
    #[case(IterationResultAdmissionErrorV1::Conflict, StatusCode::CONFLICT)]
    fn every_owner_refusal_keeps_its_own_correlated_rejection(
        #[case] error: IterationResultAdmissionErrorV1,
        #[case] expected: StatusCode,
    ) {
        let response = owner_error(&error, "result-1");
        assert_eq!(response.status(), expected);
        assert!(response.headers().contains_key("x-rd-rejection-code"));
    }

    #[tokio::test]
    async fn authorization_and_malformed_requests_stop_before_owner() {
        let token = "iteration-result-admission-test";
        let token_digest: [u8; 32] = Sha256::digest(token.as_bytes()).into();
        let authorization = bearer(token);
        let owner = Arc::new(OwnerStub {
            admit_calls: AtomicUsize::new(0),
            resolve_calls: AtomicUsize::new(0),
        });

        let unauthorized = test_router(owner.clone(), token_digest)
            .oneshot(send(
                "/v1/iteration-result-admissions",
                admission_request(),
                None,
            ))
            .await
            .expect("response");
        assert_eq!(unauthorized.status(), StatusCode::FORBIDDEN);

        let unauthorized_resolve = test_router(owner.clone(), token_digest)
            .oneshot(send(
                "/v1/iteration-result-admissions/resolve",
                locator(),
                None,
            ))
            .await
            .expect("response");
        assert_eq!(unauthorized_resolve.status(), StatusCode::FORBIDDEN);

        let malformed = test_router(owner.clone(), token_digest)
            .oneshot(send(
                "/v1/iteration-result-admissions",
                json!({}),
                Some(authorization.as_str()),
            ))
            .await
            .expect("response");
        assert_eq!(malformed.status(), StatusCode::BAD_REQUEST);

        assert_eq!(owner.admit_calls.load(Ordering::SeqCst), 0);
        assert_eq!(owner.resolve_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn an_absent_admission_is_not_found_and_is_never_created_by_the_lookup() {
        let token = "iteration-result-admission-test";
        let token_digest: [u8; 32] = Sha256::digest(token.as_bytes()).into();
        let authorization = bearer(token);
        let owner = Arc::new(OwnerStub {
            admit_calls: AtomicUsize::new(0),
            resolve_calls: AtomicUsize::new(0),
        });

        let response = test_router(owner.clone(), token_digest)
            .oneshot(send(
                "/v1/iteration-result-admissions/resolve",
                locator(),
                Some(authorization.as_str()),
            ))
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(owner.resolve_calls.load(Ordering::SeqCst), 1);
        assert_eq!(owner.admit_calls.load(Ordering::SeqCst), 0);
    }
}
