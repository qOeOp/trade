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
use vibe_backtest_owner_contracts::{CanonicalDigestV2, OpaqueIdentityV2};
use vibe_data::owner::{
    instrument_master_v2_postgres::InstrumentMasterV2PostgresOwner,
    native_replay_scheduling_v1::NativeReplaySchedulingResolverV1,
    shared_time_evidence::SharedTimeEvidenceResolver,
};
use vibe_strategy_factory::{
    MarketDataRepairCompositionRequestV1, MarketDataRepairPostgresErrorV1,
    develop_composer_postgres_v2::DevelopComposerSealedReadPortV2,
    iteration_decision::{
        IterationRepairCategoryV1, IterationRepairTargetV1, is_valid_iteration_decision_locator_v1,
    },
    market_data_repair_request::{
        MarketDataRepairRequestErrorV1, MarketDataRepairRequestReadbackV1,
    },
    product_edge_postgres::PostgresResearchGoalOwnerV1,
};

use super::{authorized, insert_rejection_code};

#[async_trait::async_trait]
trait MarketDataRepairRequestActionPort: Send + Sync {
    async fn compose(
        &self,
        request: MarketDataRepairCompositionRequestV1,
    ) -> Result<MarketDataRepairRequestActionResponseV1, MarketDataRepairPostgresErrorV1>;
}

struct MarketDataRepairRequestServiceV1 {
    owner: Arc<PostgresResearchGoalOwnerV1>,
    composer: Arc<dyn DevelopComposerSealedReadPortV2>,
    instrument_master: Arc<InstrumentMasterV2PostgresOwner>,
    market_data: Arc<dyn NativeReplaySchedulingResolverV1>,
    shared_time: Arc<dyn SharedTimeEvidenceResolver>,
}

#[async_trait::async_trait]
impl MarketDataRepairRequestActionPort for MarketDataRepairRequestServiceV1 {
    async fn compose(
        &self,
        request: MarketDataRepairCompositionRequestV1,
    ) -> Result<MarketDataRepairRequestActionResponseV1, MarketDataRepairPostgresErrorV1> {
        let readback = self
            .owner
            .compose_market_data_repair_request_v1(
                request,
                self.composer.as_ref(),
                &self.instrument_master,
                self.market_data.as_ref(),
                self.shared_time.as_ref(),
            )
            .await?;
        MarketDataRepairRequestActionResponseV1::try_from(readback)
    }
}

#[derive(Clone)]
struct MarketDataRepairRequestApiStateV1 {
    service: Option<Arc<dyn MarketDataRepairRequestActionPort>>,
    token_digest: [u8; 32],
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct MarketDataRepairRequestActionResponseV1 {
    schema_version: u16,
    request_identity: String,
    request_digest: String,
    correlation_identity: [u8; 32],
    action_request_identity: String,
    action_request_digest: String,
    decision_identity: String,
    decision_digest: String,
    result_identity: String,
    category: IterationRepairCategoryV1,
    target: IterationRepairTargetV1,
    receipt_identity: String,
    receipt_digest: String,
    committed_at_epoch_ms: u64,
    canonical_request_bytes: Vec<u8>,
}

impl TryFrom<MarketDataRepairRequestReadbackV1> for MarketDataRepairRequestActionResponseV1 {
    type Error = MarketDataRepairPostgresErrorV1;

    fn try_from(readback: MarketDataRepairRequestReadbackV1) -> Result<Self, Self::Error> {
        let request = readback.request();
        let receipt = readback.receipt();
        Ok(Self {
            schema_version: 1,
            request_identity: request.request_identity().to_string(),
            request_digest: request.request_digest().to_string(),
            correlation_identity: *request.correlation_identity().as_bytes(),
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
            canonical_request_bytes: request.to_canonical_bytes()?,
        })
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn production_router(
    owner: Arc<PostgresResearchGoalOwnerV1>,
    composer: Arc<dyn DevelopComposerSealedReadPortV2>,
    instrument_master: Arc<InstrumentMasterV2PostgresOwner>,
    market_data: Option<Arc<dyn NativeReplaySchedulingResolverV1>>,
    shared_time: Option<Arc<dyn SharedTimeEvidenceResolver>>,
    token_digest: [u8; 32],
) -> Router {
    let service = market_data
        .zip(shared_time)
        .map(|(market_data, shared_time)| {
            Arc::new(MarketDataRepairRequestServiceV1 {
                owner,
                composer,
                instrument_master,
                market_data,
                shared_time,
            }) as Arc<dyn MarketDataRepairRequestActionPort>
        });
    router(service, token_digest)
}

fn router(
    service: Option<Arc<dyn MarketDataRepairRequestActionPort>>,
    token_digest: [u8; 32],
) -> Router {
    Router::new()
        .route(
            "/v1/market-data-repair-requests",
            post(compose_market_data_repair_request),
        )
        .with_state(MarketDataRepairRequestApiStateV1 {
            service,
            token_digest,
        })
}

async fn compose_market_data_repair_request(
    State(state): State<MarketDataRepairRequestApiStateV1>,
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
    let request: MarketDataRepairCompositionRequestV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let action_request_identity = request.action_request_identity.clone();
    if !valid_request(&request) {
        return rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_MARKET_DATA_REPAIR_REQUEST_LOCATORS",
            &action_request_identity,
        );
    }
    let Some(service) = state.service else {
        return rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_DATA_REPAIR_REQUEST_OWNER_UNAVAILABLE",
            &action_request_identity,
        );
    };
    match service.compose(request).await {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(error) => owner_error(&error, &action_request_identity),
    }
}

fn valid_request(request: &MarketDataRepairCompositionRequestV1) -> bool {
    [
        request.action_request_identity.as_str(),
        request.decision_identity.as_str(),
        request.result_identity.as_str(),
        request.attempt_identity.as_str(),
    ]
    .into_iter()
    .all(is_valid_iteration_decision_locator_v1)
        && OpaqueIdentityV2::try_from(request.replay.request_identity.clone()).is_ok()
        && CanonicalDigestV2::try_from(request.replay.meaning_digest.clone()).is_ok()
        && OpaqueIdentityV2::try_from(request.replay.receipt_identity.clone()).is_ok()
        && CanonicalDigestV2::try_from(request.replay.seal_digest.clone()).is_ok()
        && request.shared_time_head.head_identity().as_bytes() != &[0; 32]
        && request.shared_time_head.head_digest().as_bytes() != &[0; 32]
}

fn owner_error(error: &MarketDataRepairPostgresErrorV1, action_identity: &str) -> Response {
    match error {
        MarketDataRepairPostgresErrorV1::InvalidLocator => rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_MARKET_DATA_REPAIR_REQUEST_LOCATORS",
            action_identity,
        ),
        MarketDataRepairPostgresErrorV1::Request(
            MarketDataRepairRequestErrorV1::WrongRepairTarget
            | MarketDataRepairRequestErrorV1::CustodyMismatch
            | MarketDataRepairRequestErrorV1::DefectProofUnavailable
            | MarketDataRepairRequestErrorV1::MarketDataSourceMismatch,
        ) => rejection(
            StatusCode::CONFLICT,
            "MARKET_DATA_REPAIR_REQUEST_NOT_ADMITTED",
            action_identity,
        ),
        MarketDataRepairPostgresErrorV1::Request(
            MarketDataRepairRequestErrorV1::TimeEvidenceUnavailable,
        ) => rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "SHARED_TIME_EVIDENCE_UNAVAILABLE",
            action_identity,
        ),
        MarketDataRepairPostgresErrorV1::Request(MarketDataRepairRequestErrorV1::Encoding(_))
        | MarketDataRepairPostgresErrorV1::Unavailable(_) => rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_DATA_REPAIR_REQUEST_OWNER_UNAVAILABLE",
            action_identity,
        ),
    }
}

fn rejection(status: StatusCode, code: &str, action_identity: &str) -> Response {
    let mut response = (
        status,
        Json(json!({
            "action_request_identity": action_identity,
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

    struct Stub {
        calls: AtomicUsize,
        response: Option<MarketDataRepairRequestActionResponseV1>,
    }

    #[async_trait::async_trait]
    impl MarketDataRepairRequestActionPort for Stub {
        async fn compose(
            &self,
            _request: MarketDataRepairCompositionRequestV1,
        ) -> Result<MarketDataRepairRequestActionResponseV1, MarketDataRepairPostgresErrorV1>
        {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.response.clone().ok_or_else(|| {
                MarketDataRepairPostgresErrorV1::Unavailable("test owner unavailable".into())
            })
        }
    }

    fn request() -> serde_json::Value {
        json!({
            "action_request_identity": "repair-action-1",
            "decision_identity": "decision-1",
            "result_identity": "result-1",
            "attempt_identity": "attempt-1",
            "replay": {
                "request_identity": "replay-request-1",
                "meaning_digest": format!("sha256:{}", "a".repeat(64)),
                "receipt_identity": "replay-receipt-1",
                "seal_digest": format!("sha256:{}", "b".repeat(64)),
            },
            "shared_time_head": {
                "head_identity": vec![1; 32],
                "head_digest": vec![2; 32],
            },
        })
    }

    fn expected() -> MarketDataRepairRequestActionResponseV1 {
        MarketDataRepairRequestActionResponseV1 {
            schema_version: 1,
            request_identity: "market-data-repair-1".into(),
            request_digest: format!("sha256:{}", "c".repeat(64)),
            correlation_identity: [3; 32],
            action_request_identity: "repair-action-1".into(),
            action_request_digest: format!("sha256:{}", "d".repeat(64)),
            decision_identity: "decision-1".into(),
            decision_digest: format!("sha256:{}", "e".repeat(64)),
            result_identity: "result-1".into(),
            category: IterationRepairCategoryV1::MarketData,
            target: IterationRepairTargetV1::MarketData,
            receipt_identity: "market-data-repair-receipt-1".into(),
            receipt_digest: format!("sha256:{}", "f".repeat(64)),
            committed_at_epoch_ms: 23,
            canonical_request_bytes: br#"{"request_identity":"market-data-repair-1"}"#.to_vec(),
        }
    }

    fn send(body: serde_json::Value, token: Option<&str>) -> axum::http::Request<axum::body::Body> {
        let mut request = axum::http::Request::builder()
            .method(axum::http::Method::POST)
            .uri("/v1/market-data-repair-requests")
            .header(axum::http::header::CONTENT_TYPE, "application/json");
        if let Some(token) = token {
            request = request.header(axum::http::header::AUTHORIZATION, token);
        }
        request
            .body(axum::body::Body::from(body.to_string()))
            .unwrap()
    }

    #[test]
    fn request_accepts_only_owner_locators() {
        serde_json::from_value::<MarketDataRepairCompositionRequestV1>(request()).unwrap();
        let mut injected = request();
        injected["execution"] = json!({"provider": "caller-selected"});
        assert!(serde_json::from_value::<MarketDataRepairCompositionRequestV1>(injected).is_err());
        let mut nested = request();
        nested["shared_time_head"]["execution"] = json!({"provider": "caller-selected"});
        assert!(serde_json::from_value::<MarketDataRepairCompositionRequestV1>(nested).is_err());
    }

    #[tokio::test]
    async fn rejected_requests_stop_before_owner() {
        let token = "market-data-repair-test";
        let token_digest: [u8; 32] = sha2::Sha256::digest(token.as_bytes()).into();
        let service = Arc::new(Stub {
            calls: AtomicUsize::new(0),
            response: None,
        });
        let unauthorized = router(Some(service.clone()), token_digest)
            .oneshot(send(request(), None))
            .await
            .unwrap();
        assert_eq!(unauthorized.status(), StatusCode::FORBIDDEN);
        let mut invalid = request();
        invalid["attempt_identity"] = json!("x");
        let invalid = router(Some(service.clone()), token_digest)
            .oneshot(send(invalid, Some(&format!("Bearer {token}"))))
            .await
            .unwrap();
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
        let mut nested = request();
        nested["shared_time_head"]["execution"] = json!({"provider": "caller-selected"});
        let nested = router(Some(service.clone()), token_digest)
            .oneshot(send(nested, Some(&format!("Bearer {token}"))))
            .await
            .unwrap();
        assert_eq!(nested.status(), StatusCode::BAD_REQUEST);
        assert_eq!(service.calls.load(Ordering::SeqCst), 0);

        let unavailable = router(None, token_digest)
            .oneshot(send(request(), Some(&format!("Bearer {token}"))))
            .await
            .unwrap();
        assert_eq!(unavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn exact_retry_returns_byte_identical_typed_owner_response() {
        let token = "market-data-repair-success-test";
        let token_digest: [u8; 32] = sha2::Sha256::digest(token.as_bytes()).into();
        let expected = expected();
        let service = Arc::new(Stub {
            calls: AtomicUsize::new(0),
            response: Some(expected.clone()),
        });
        let mut bodies = Vec::new();
        for _ in 0..2 {
            let response = router(Some(service.clone()), token_digest)
                .oneshot(send(request(), Some(&format!("Bearer {token}"))))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            bodies.push(
                axum::body::to_bytes(response.into_body(), usize::MAX)
                    .await
                    .unwrap(),
            );
        }
        assert_eq!(service.calls.load(Ordering::SeqCst), 2);
        assert_eq!(bodies[0], bodies[1]);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&bodies[0]).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
    }
}
