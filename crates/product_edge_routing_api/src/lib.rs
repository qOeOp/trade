//! `GET /v1/operation-routing`: Product Edge's operation routing read port over HTTP.
//!
//! `docs/architecture/product-edge.md`, "Operation routing", is the contract. The service answers
//! for the one deployment it is configured for, reads in a read-only transaction, and writes
//! nothing; only `product-edge-authority-bootstrap route` commits routing bindings.

use std::{env, sync::Arc};

use async_trait::async_trait;
use axum::{
    Json, Router,
    extract::{Query, State, rejection::QueryRejection},
    http::{HeaderMap, StatusCode, header::AUTHORIZATION},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::net::TcpListener;
use vibe_product_edge::{
    ProductEdgeError, ProductEdgeOperationRoutingKeyV1, ProductEdgeOperationRoutingObservationV1,
    ProductEdgePostgresOperationRoutingReadPortV1,
};

pub const OPERATION_ROUTING_PATH_V1: &str = "/v1/operation-routing";
pub const OPERATION_ROUTING_ABSENT_V1: &str = "OPERATION_ROUTING_ABSENT";
pub const OPERATION_ROUTING_STALE_V1: &str = "OPERATION_ROUTING_STALE";
pub const OPERATION_ROUTING_QUERY_INVALID_V1: &str = "OPERATION_ROUTING_QUERY_INVALID";
pub const OPERATION_ROUTING_UNAUTHORIZED_V1: &str = "OPERATION_ROUTING_UNAUTHORIZED";
pub const OPERATION_ROUTING_UNAVAILABLE_V1: &str = "OPERATION_ROUTING_UNAVAILABLE";

/// The deployment environment the shipped binary reads.
#[derive(Debug, Clone)]
pub struct RoutingReadApiConfigV1 {
    pub database_url: String,
    pub deployment_identity: String,
    pub token: String,
    pub bind: String,
}

impl RoutingReadApiConfigV1 {
    /// Reads the process environment exactly as the shipped binary does.
    ///
    /// # Errors
    ///
    /// Returns an error when a required variable is missing or empty.
    pub fn from_environment() -> anyhow::Result<Self> {
        Self::from_lookup(|name| env::var(name).ok())
    }

    /// Reads the configuration from `lookup`, keyed by the deployment's environment names, so the
    /// ordered chain composes the service by this one rule.
    ///
    /// # Errors
    ///
    /// Returns an error when a required variable is missing or empty.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> anyhow::Result<Self> {
        let required = |name: &str| -> anyhow::Result<String> {
            let value = lookup(name).ok_or_else(|| {
                anyhow::anyhow!("required environment variable {name} is missing")
            })?;

            if value.trim().is_empty() {
                anyhow::bail!("required environment variable {name} is set but carries no value");
            }
            Ok(value)
        };
        Ok(Self {
            database_url: required("PRODUCT_EDGE_DATABASE_URL")?,
            deployment_identity: required("PRODUCT_EDGE_DEPLOYMENT_IDENTITY")?,
            token: required("PRODUCT_EDGE_ROUTING_READ_API_TOKEN")?,
            bind: lookup("PRODUCT_EDGE_ROUTING_READ_API_BIND")
                .unwrap_or_else(|| "127.0.0.1:8083".to_string()),
        })
    }
}

/// The Owner read the handler answers from; the Postgres read port in production.
#[async_trait]
pub trait OperationRoutingReadPortV1: Send + Sync {
    fn key(
        &self,
        operation: &str,
        version: u32,
        channel: &str,
    ) -> Result<ProductEdgeOperationRoutingKeyV1, ProductEdgeError>;

    async fn resolve(
        &self,
        key: &ProductEdgeOperationRoutingKeyV1,
    ) -> Result<ProductEdgeOperationRoutingObservationV1, ProductEdgeError>;
}

#[async_trait]
impl OperationRoutingReadPortV1 for ProductEdgePostgresOperationRoutingReadPortV1 {
    fn key(
        &self,
        operation: &str,
        version: u32,
        channel: &str,
    ) -> Result<ProductEdgeOperationRoutingKeyV1, ProductEdgeError> {
        Self::key(self, operation, version, channel)
    }

    async fn resolve(
        &self,
        key: &ProductEdgeOperationRoutingKeyV1,
    ) -> Result<ProductEdgeOperationRoutingObservationV1, ProductEdgeError> {
        Self::resolve(self, key).await
    }
}

#[derive(Clone)]
pub struct RoutingApiStateV1 {
    port: Arc<dyn OperationRoutingReadPortV1>,
    token_digest: [u8; 32],
}

impl RoutingApiStateV1 {
    /// Keeps only the token's digest, so a comparison never touches the token itself.
    pub fn new(port: Arc<dyn OperationRoutingReadPortV1>, token: &str) -> Self {
        Self {
            port,
            token_digest: Sha256::digest(token.as_bytes()).into(),
        }
    }
}

/// Serves the read port on the configured address until the process stops.
///
/// # Errors
///
/// Returns an error when the store cannot be connected or the address cannot be bound.
pub async fn serve(config: RoutingReadApiConfigV1) -> anyhow::Result<()> {
    let listener = TcpListener::bind(&config.bind).await?;
    serve_on(listener, config).await
}

/// Serves the read port on `listener`, which the caller has already bound, until the process
/// stops. `config.bind` is not read: the listener is the address. The ordered chain binds an
/// ephemeral port itself and serves the production composition here, so no port is chosen and
/// then raced for.
///
/// # Errors
///
/// Returns an error when the store cannot be connected or the listener fails.
pub async fn serve_on(listener: TcpListener, config: RoutingReadApiConfigV1) -> anyhow::Result<()> {
    let port = ProductEdgePostgresOperationRoutingReadPortV1::connect(
        &config.database_url,
        config.deployment_identity.clone(),
    )
    .await?;
    tracing::info!(address = %listener.local_addr()?, "Product Edge operation routing read API ready");
    axum::serve(
        listener,
        router(RoutingApiStateV1::new(Arc::new(port), &config.token)),
    )
    .await?;
    Ok(())
}

pub fn router(state: RoutingApiStateV1) -> Router {
    Router::new()
        .route(OPERATION_ROUTING_PATH_V1, get(read_operation_routing))
        .with_state(state)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OperationRoutingQueryV1 {
    operation: String,
    version: String,
    channel: String,
}

/// Authorizes, validates the key, then answers from one read-only Owner read.
pub async fn read_operation_routing(
    State(state): State<RoutingApiStateV1>,
    headers: HeaderMap,
    query: Result<Query<OperationRoutingQueryV1>, QueryRejection>,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return refusal(StatusCode::UNAUTHORIZED, OPERATION_ROUTING_UNAUTHORIZED_V1);
    }
    let Ok(Query(query)) = query else {
        return refusal(StatusCode::BAD_REQUEST, OPERATION_ROUTING_QUERY_INVALID_V1);
    };
    // A canonical decimal only: no sign, no leading zero, no whitespace.
    let version = match query.version.parse::<u32>() {
        Ok(version) if version.to_string() == query.version => version,
        _ => return refusal(StatusCode::BAD_REQUEST, OPERATION_ROUTING_QUERY_INVALID_V1),
    };
    let Ok(key) = state.port.key(&query.operation, version, &query.channel) else {
        return refusal(StatusCode::BAD_REQUEST, OPERATION_ROUTING_QUERY_INVALID_V1);
    };

    match state.port.resolve(&key).await {
        Ok(ProductEdgeOperationRoutingObservationV1::Absent) => {
            refusal(StatusCode::NOT_FOUND, OPERATION_ROUTING_ABSENT_V1)
        }
        Ok(ProductEdgeOperationRoutingObservationV1::Stale) => {
            refusal(StatusCode::CONFLICT, OPERATION_ROUTING_STALE_V1)
        }
        Ok(answer) => match answer.response_body() {
            Some(body) => (StatusCode::OK, Json(body)).into_response(),
            None => refusal(
                StatusCode::SERVICE_UNAVAILABLE,
                OPERATION_ROUTING_UNAVAILABLE_V1,
            ),
        },
        Err(e) => {
            tracing::warn!(error = %e, operation = %key.operation, "operation routing read refused");
            refusal(
                StatusCode::SERVICE_UNAVAILABLE,
                OPERATION_ROUTING_UNAVAILABLE_V1,
            )
        }
    }
}

fn refusal(status: StatusCode, code: &'static str) -> Response {
    (
        status,
        Json(serde_json::json!({ "schema_version": 1, "refusal": code })),
    )
        .into_response()
}

fn authorized(headers: &HeaderMap, expected_digest: &[u8; 32]) -> bool {
    let Some(value) = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
    else {
        return false;
    };
    let actual: [u8; 32] = Sha256::digest(value.as_bytes()).into();
    actual
        .iter()
        .zip(expected_digest)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

#[cfg(test)]
mod postgres_tests;

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use axum::{body::Body, http::Request};
    use rstest::rstest;
    use tower::ServiceExt;
    use vibe_product_edge::{
        ProductEdgeOperationDispatcherV1, ProductEdgeOperationRoutingBindingContentV1,
        ProductEdgeUnavailableReasonV1,
    };

    use super::*;

    const TOKEN: &str = "routing-read-token";
    const QUERY: &str =
        "operation=research_goal.submit_or_resolve.v2&version=2&channel=WINDMILL_PRODUCT_EDGE";

    enum Answer {
        Active,
        ZeroActive,
        Absent,
        Stale,
        Unavailable,
    }

    struct FakePort {
        answer: Answer,
        resolved: Mutex<Vec<ProductEdgeOperationRoutingKeyV1>>,
    }

    fn key() -> ProductEdgeOperationRoutingKeyV1 {
        ProductEdgeOperationRoutingKeyV1 {
            deployment_identity: "deployment-a".into(),
            operation: "research_goal.submit_or_resolve.v2".into(),
            version: 2,
            channel: "WINDMILL_PRODUCT_EDGE".into(),
        }
    }

    #[async_trait]
    impl OperationRoutingReadPortV1 for FakePort {
        fn key(
            &self,
            operation: &str,
            version: u32,
            channel: &str,
        ) -> Result<ProductEdgeOperationRoutingKeyV1, ProductEdgeError> {
            let key = ProductEdgeOperationRoutingKeyV1 {
                operation: operation.into(),
                version,
                channel: channel.into(),
                ..key()
            };
            key.validate()?;
            Ok(key)
        }

        async fn resolve(
            &self,
            key: &ProductEdgeOperationRoutingKeyV1,
        ) -> Result<ProductEdgeOperationRoutingObservationV1, ProductEdgeError> {
            self.resolved.lock().unwrap().push(key.clone());
            Ok(match self.answer {
                Answer::Active => ProductEdgeOperationRoutingObservationV1::Active {
                    binding: ProductEdgeOperationRoutingBindingContentV1 {
                        schema_version: 1,
                        key: key.clone(),
                        generation: 1,
                        predecessor_binding_identity: None,
                        deployment_binding_identity: "binding".into(),
                        deployment_binding_digest: format!("sha256:{}", "1".repeat(64)),
                        manifest_identity: "manifest".into(),
                        manifest_digest: format!("sha256:{}", "2".repeat(64)),
                        dispatcher: ProductEdgeOperationDispatcherV1::TradeDashboard,
                        committed_at_epoch_ms: 5,
                    }
                    .seal()?,
                    observed_at_epoch_ms: 7,
                },
                Answer::ZeroActive => ProductEdgeOperationRoutingObservationV1::ZeroActive {
                    key: key.clone(),
                    generation: 2,
                    history_head_identity: "head".into(),
                    observed_at_epoch_ms: 7,
                },
                Answer::Absent => ProductEdgeOperationRoutingObservationV1::Absent,
                Answer::Stale => ProductEdgeOperationRoutingObservationV1::Stale,
                Answer::Unavailable => {
                    return Err(ProductEdgeError::unavailable(
                        ProductEdgeUnavailableReasonV1::Missing,
                    ));
                }
            })
        }
    }

    async fn call(
        answer: Answer,
        query: &str,
        authorization: Option<&str>,
    ) -> (StatusCode, serde_json::Value, usize) {
        let port = Arc::new(FakePort {
            answer,
            resolved: Mutex::new(Vec::new()),
        });
        let app = router(RoutingApiStateV1::new(port.clone(), TOKEN));
        let mut request = Request::get(format!("{OPERATION_ROUTING_PATH_V1}?{query}"));
        if let Some(authorization) = authorization {
            request = request.header(AUTHORIZATION, authorization);
        }
        let response = app
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 1 << 16)
            .await
            .unwrap();
        let resolved = port.resolved.lock().unwrap().len();
        (status, serde_json::from_slice(&bytes).unwrap(), resolved)
    }

    #[rstest]
    #[case::active(Answer::Active, StatusCode::OK, "ACTIVE")]
    #[case::zero_active(Answer::ZeroActive, StatusCode::OK, "ZERO_ACTIVE")]
    #[tokio::test]
    async fn an_answer_is_the_observation_body(
        #[case] answer: Answer,
        #[case] expected_status: StatusCode,
        #[case] expected_state: &str,
    ) {
        let bearer = format!("Bearer {TOKEN}");
        let (status, body, resolved) = call(answer, QUERY, Some(&bearer)).await;
        assert_eq!(status, expected_status);
        assert_eq!(body["state"], expected_state);
        assert_eq!(resolved, 1);
    }

    #[rstest]
    #[case::absent(Answer::Absent, StatusCode::NOT_FOUND, OPERATION_ROUTING_ABSENT_V1)]
    #[case::stale(Answer::Stale, StatusCode::CONFLICT, OPERATION_ROUTING_STALE_V1)]
    #[case::store(
        Answer::Unavailable,
        StatusCode::SERVICE_UNAVAILABLE,
        OPERATION_ROUTING_UNAVAILABLE_V1
    )]
    #[tokio::test]
    async fn every_other_owner_answer_is_a_named_refusal(
        #[case] answer: Answer,
        #[case] expected_status: StatusCode,
        #[case] expected_refusal: &str,
    ) {
        let bearer = format!("Bearer {TOKEN}");
        let (status, body, resolved) = call(answer, QUERY, Some(&bearer)).await;
        assert_eq!(status, expected_status);
        assert_eq!(body["refusal"], expected_refusal);
        assert_eq!(resolved, 1);
    }

    #[rstest]
    #[case::missing(None)]
    #[case::wrong(Some("Bearer not-the-token"))]
    #[case::not_bearer(Some("routing-read-token"))]
    #[tokio::test]
    async fn a_request_without_the_token_reads_nothing(#[case] authorization: Option<&str>) {
        let (status, body, resolved) = call(Answer::Active, QUERY, authorization).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body["refusal"], OPERATION_ROUTING_UNAUTHORIZED_V1);
        assert_eq!(resolved, 0);
    }

    #[rstest]
    #[case::version_not_the_suffix(
        "operation=research_goal.submit_or_resolve.v2&version=3&channel=WINDMILL_PRODUCT_EDGE"
    )]
    #[case::version_not_canonical(
        "operation=research_goal.submit_or_resolve.v2&version=02&channel=WINDMILL_PRODUCT_EDGE"
    )]
    #[case::version_not_a_number(
        "operation=research_goal.submit_or_resolve.v2&version=two&channel=WINDMILL_PRODUCT_EDGE"
    )]
    #[case::channel_not_a_token(
        "operation=research_goal.submit_or_resolve.v2&version=2&channel=windmill"
    )]
    #[case::missing_channel("operation=research_goal.submit_or_resolve.v2&version=2")]
    #[case::unknown_parameter(
        "operation=research_goal.submit_or_resolve.v2&version=2&channel=WINDMILL_PRODUCT_EDGE&deployment=b"
    )]
    #[tokio::test]
    async fn a_query_that_names_no_key_reads_nothing(#[case] query: &str) {
        let bearer = format!("Bearer {TOKEN}");
        let (status, body, resolved) = call(Answer::Active, query, Some(&bearer)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["refusal"], OPERATION_ROUTING_QUERY_INVALID_V1);
        assert_eq!(resolved, 0);
    }

    #[rstest]
    fn the_configuration_requires_every_deployment_value() {
        let full = |name: &str| match name {
            "PRODUCT_EDGE_DATABASE_URL" => Some("postgres://edge".to_string()),
            "PRODUCT_EDGE_DEPLOYMENT_IDENTITY" => Some("deployment-a".to_string()),
            "PRODUCT_EDGE_ROUTING_READ_API_TOKEN" => Some(TOKEN.to_string()),
            _ => None,
        };
        assert_eq!(
            RoutingReadApiConfigV1::from_lookup(full).unwrap().bind,
            "127.0.0.1:8083"
        );

        for missing in [
            "PRODUCT_EDGE_DATABASE_URL",
            "PRODUCT_EDGE_DEPLOYMENT_IDENTITY",
            "PRODUCT_EDGE_ROUTING_READ_API_TOKEN",
        ] {
            assert!(
                RoutingReadApiConfigV1::from_lookup(|name| {
                    (name != missing).then(|| full(name)).flatten()
                })
                .is_err(),
                "{missing}"
            );
        }
    }
}
