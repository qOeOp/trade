use std::{env, sync::Arc};

use axum::{
    Json, Router,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::net::TcpListener;
use vibe_strategy_factory::{
    artifact_build::{ArtifactBuildError, ArtifactDirectoryCursorV1, ArtifactDirectoryOwnerPort},
    artifact_build_postgres::PostgresArtifactDirectoryOwnerV1,
};

#[derive(Clone)]
struct ApiState {
    owner: Arc<dyn ArtifactDirectoryOwnerPort>,
    token_digest: [u8; 32],
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ArtifactDirectoryQueryV1 {
    limit: Option<u32>,
    after_prepared_at_epoch_ms: Option<u64>,
    after_build_request_identity: Option<String>,
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
        PostgresArtifactDirectoryOwnerV1::connect(&required_env(
            "RD_ARTIFACT_OWNER_READ_DATABASE_URL",
        )?)
        .await?,
    );
    let token = required_env("RD_ARTIFACT_OWNER_READ_API_TOKEN")?;
    let state = ApiState {
        owner,
        token_digest: Sha256::digest(token.as_bytes()).into(),
    };
    let address =
        env::var("RD_ARTIFACT_OWNER_READ_LISTEN").unwrap_or_else(|_| "0.0.0.0:8082".to_string());
    let listener = TcpListener::bind(&address).await?;
    tracing::info!(%address, "Artifact directory read API ready");
    axum::serve(listener, router(state)).await?;
    Ok(())
}

fn router(state: ApiState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route(
            "/v1/artifact-builds/directory",
            get(read_artifact_directory),
        )
        .with_state(state)
}

async fn health() -> StatusCode {
    StatusCode::OK
}

async fn read_artifact_directory(
    State(state): State<ApiState>,
    Query(query): Query<ArtifactDirectoryQueryV1>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let after = match (
        query.after_prepared_at_epoch_ms,
        query.after_build_request_identity,
    ) {
        (None, None) => None,
        (Some(prepared_at_epoch_ms), Some(build_request_identity)) => {
            Some(ArtifactDirectoryCursorV1 {
                prepared_at_epoch_ms,
                build_request_identity,
            })
        }
        _ => return StatusCode::BAD_REQUEST.into_response(),
    };

    match state
        .owner
        .list_artifacts(after.as_ref(), query.limit.unwrap_or(20))
        .await
    {
        Ok(readback) => (StatusCode::OK, Json(readback)).into_response(),
        Err(ArtifactBuildError::Candidate(_)) => StatusCode::BAD_REQUEST.into_response(),
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
    use std::sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    };

    use async_trait::async_trait;
    use axum::http::{HeaderValue, header::AUTHORIZATION};
    use vibe_strategy_factory::artifact_build::{
        ArtifactDirectoryCompletenessV1, ArtifactDirectoryReadbackV1,
    };

    use super::*;

    #[derive(Default)]
    struct RecordingOwner {
        calls: AtomicUsize,
        request: Mutex<Option<(Option<ArtifactDirectoryCursorV1>, u32)>>,
    }

    #[async_trait]
    impl ArtifactDirectoryOwnerPort for RecordingOwner {
        async fn list_artifacts(
            &self,
            after: Option<&ArtifactDirectoryCursorV1>,
            limit: u32,
        ) -> Result<ArtifactDirectoryReadbackV1, ArtifactBuildError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            *self.request.lock().expect("request lock") = Some((after.cloned(), limit));
            Ok(ArtifactDirectoryReadbackV1 {
                schema_version: 1,
                observed_at_epoch_ms: 1,
                completeness: ArtifactDirectoryCompletenessV1::Complete,
                omitted_count: 0,
                next_cursor: None,
                items: Vec::new(),
            })
        }
    }

    fn state(owner: Arc<RecordingOwner>) -> ApiState {
        ApiState {
            owner,
            token_digest: Sha256::digest(b"test-token").into(),
        }
    }

    fn authorized_headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, HeaderValue::from_static("Bearer test-token"));
        headers
    }

    #[tokio::test]
    async fn unauthorized_request_makes_zero_owner_calls() {
        let owner = Arc::new(RecordingOwner::default());
        let response = read_artifact_directory(
            State(state(owner.clone())),
            Query(ArtifactDirectoryQueryV1 {
                limit: None,
                after_prepared_at_epoch_ms: None,
                after_build_request_identity: None,
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
        let response = read_artifact_directory(
            State(state(owner.clone())),
            Query(ArtifactDirectoryQueryV1 {
                limit: Some(7),
                after_prepared_at_epoch_ms: Some(42),
                after_build_request_identity: Some("artifact-build-request-42".to_string()),
            }),
            authorized_headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 1);
        let request = owner.request.lock().expect("request lock").clone();
        assert_eq!(
            request,
            Some((
                Some(ArtifactDirectoryCursorV1 {
                    prepared_at_epoch_ms: 42,
                    build_request_identity: "artifact-build-request-42".to_string(),
                }),
                7,
            )),
        );
    }

    #[tokio::test]
    async fn partial_cursor_fails_before_owner_dispatch() {
        let owner = Arc::new(RecordingOwner::default());
        let response = read_artifact_directory(
            State(state(owner.clone())),
            Query(ArtifactDirectoryQueryV1 {
                limit: None,
                after_prepared_at_epoch_ms: Some(42),
                after_build_request_identity: None,
            }),
            authorized_headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);
    }
}
