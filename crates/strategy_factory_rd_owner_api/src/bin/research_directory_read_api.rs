use std::{env, sync::Arc};

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::net::TcpListener;
use vibe_strategy_factory::{
    product_edge::{
        ResearchDirectoryCursorV1, ResearchDirectoryOwnerPort, ResearchReadbackOwnerPortV1,
    },
    product_edge_postgres::PostgresResearchReadbackOwnerV1,
};

#[derive(Clone)]
struct ApiState {
    directory_owner: Arc<dyn ResearchDirectoryOwnerPort>,
    readback_owner: Arc<dyn ResearchReadbackOwnerPortV1>,
    token_digest: [u8; 32],
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ResearchDirectoryQueryV1 {
    limit: Option<u32>,
    after_committed_at_epoch_ms: Option<u64>,
    after_request_identity: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_target(false)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();
    let owner = Arc::new(
        PostgresResearchReadbackOwnerV1::connect(&required_env(
            "RD_RESEARCH_OWNER_READ_DATABASE_URL",
        )?)
        .await?,
    );
    let token = required_env("RD_RESEARCH_OWNER_READ_API_TOKEN")?;
    let state = ApiState {
        directory_owner: owner.clone(),
        readback_owner: owner,
        token_digest: Sha256::digest(token.as_bytes()).into(),
    };
    let address =
        env::var("RD_RESEARCH_OWNER_READ_LISTEN").unwrap_or_else(|_| "0.0.0.0:8083".to_string());
    let listener = TcpListener::bind(&address).await?;
    tracing::info!(%address, "Research directory read API ready");
    axum::serve(listener, router(state)).await?;
    Ok(())
}

fn router(state: ApiState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/v1/research-goals/directory", get(read_research_directory))
        .route(
            "/v2/research-goals/{request_identity}/readback",
            get(read_research_v2),
        )
        .with_state(state)
}

async fn health() -> StatusCode {
    StatusCode::OK
}

async fn read_research_directory(
    State(state): State<ApiState>,
    Query(query): Query<ResearchDirectoryQueryV1>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }

    if query.limit.is_some_and(|limit| !(1..=20).contains(&limit)) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let after = match (
        query.after_committed_at_epoch_ms,
        query.after_request_identity,
    ) {
        (None, None) => None,
        (Some(committed_at_epoch_ms), Some(request_identity))
            if (16..=128).contains(&request_identity.len())
                && request_identity.bytes().all(|byte| {
                    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.')
                }) =>
        {
            Some(ResearchDirectoryCursorV1 {
                committed_at_epoch_ms,
                request_identity,
            })
        }
        _ => return StatusCode::BAD_REQUEST.into_response(),
    };

    match state
        .directory_owner
        .list_research(after.as_ref(), query.limit.unwrap_or(20))
        .await
    {
        Ok(readback) => (StatusCode::OK, Json(readback)).into_response(),
        Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

async fn read_research_v2(
    State(state): State<ApiState>,
    Path(request_identity): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }

    if !(1..=192).contains(&request_identity.len())
        || !request_identity.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.' | b'/')
        })
    {
        return StatusCode::BAD_REQUEST.into_response();
    }

    match state
        .readback_owner
        .read_research_v2(&request_identity)
        .await
    {
        Ok(readback) => (StatusCode::OK, Json(readback)).into_response(),
        Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

fn authorized(headers: &HeaderMap, expected_digest: &[u8; 32]) -> bool {
    let Some(value) = headers
        .get(axum::http::header::AUTHORIZATION)
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

fn required_env(name: &str) -> anyhow::Result<String> {
    env::var(name).map_err(|_| anyhow::anyhow!("required environment variable {name} is missing"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use axum::http::{HeaderValue, header::AUTHORIZATION};
    use std::sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    };
    use vibe_strategy_factory::product_edge::{
        ResearchDirectoryCompletenessV1, ResearchDirectoryReadbackV1, ResearchGoalOwnerError,
        ResearchGoalOwnerResultV2,
    };

    #[derive(Default)]
    struct RecordingOwner {
        calls: AtomicUsize,
        request: Mutex<Option<(Option<ResearchDirectoryCursorV1>, u32)>>,
    }

    #[async_trait]
    impl ResearchDirectoryOwnerPort for RecordingOwner {
        async fn list_research(
            &self,
            after: Option<&ResearchDirectoryCursorV1>,
            limit: u32,
        ) -> Result<ResearchDirectoryReadbackV1, ResearchGoalOwnerError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            *self.request.lock().expect("request lock") = Some((after.cloned(), limit));
            Ok(ResearchDirectoryReadbackV1 {
                schema_version: 1,
                observed_at_epoch_ms: 1,
                completeness: ResearchDirectoryCompletenessV1::Complete,
                omitted_count: 0,
                next_cursor: None,
                items: Vec::new(),
            })
        }
    }

    #[async_trait]
    impl ResearchReadbackOwnerPortV1 for RecordingOwner {
        async fn read_research_v2(
            &self,
            _request_identity: &str,
        ) -> Result<ResearchGoalOwnerResultV2, ResearchGoalOwnerError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Err(ResearchGoalOwnerError::Storage("test stop".into()))
        }
    }

    fn state(owner: Arc<RecordingOwner>) -> ApiState {
        ApiState {
            directory_owner: owner.clone(),
            readback_owner: owner,
            token_digest: Sha256::digest(b"test-token").into(),
        }
    }

    fn headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, HeaderValue::from_static("Bearer test-token"));
        headers
    }

    #[tokio::test]
    async fn unauthorized_request_makes_zero_owner_calls() {
        let owner = Arc::new(RecordingOwner::default());
        let response = read_research_directory(
            State(state(owner.clone())),
            Query(ResearchDirectoryQueryV1 {
                limit: None,
                after_committed_at_epoch_ms: None,
                after_request_identity: None,
            }),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn authenticated_request_forwards_one_exact_cursor() {
        let owner = Arc::new(RecordingOwner::default());
        let response = read_research_directory(
            State(state(owner.clone())),
            Query(ResearchDirectoryQueryV1 {
                limit: Some(7),
                after_committed_at_epoch_ms: Some(42),
                after_request_identity: Some("research-request-42".to_string()),
            }),
            headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            *owner.request.lock().expect("request lock"),
            Some((
                Some(ResearchDirectoryCursorV1 {
                    committed_at_epoch_ms: 42,
                    request_identity: "research-request-42".to_string(),
                }),
                7
            ))
        );
    }

    #[tokio::test]
    async fn partial_cursor_fails_before_owner_dispatch() {
        let owner = Arc::new(RecordingOwner::default());
        let response = read_research_directory(
            State(state(owner.clone())),
            Query(ResearchDirectoryQueryV1 {
                limit: None,
                after_committed_at_epoch_ms: Some(42),
                after_request_identity: None,
            }),
            headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn invalid_exact_identity_fails_before_owner_dispatch() {
        let owner = Arc::new(RecordingOwner::default());
        let response = read_research_v2(
            State(state(owner.clone())),
            Path("invalid identity".to_string()),
            headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);
    }
}
