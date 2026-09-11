use std::{env, sync::Arc};

use anyhow::Context;
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
    artifact_build::{
        ArtifactBuildError, ArtifactDirectoryCursorV1, ArtifactDirectoryOwnerPort,
        ArtifactSourceOwnerPort,
    },
    artifact_build_postgres::PostgresArtifactReadbackOwnerV1,
    product_edge::{
        ResearchDirectoryCursorV1, ResearchDirectoryOwnerPort, ResearchReadbackOwnerPortV1,
    },
    product_edge_postgres::PostgresResearchReadbackOwnerV1,
};

#[derive(Clone)]
struct ApiState {
    artifact_directory: Arc<dyn ArtifactDirectoryOwnerPort>,
    artifact_source: Arc<dyn ArtifactSourceOwnerPort>,
    research_directory: Arc<dyn ResearchDirectoryOwnerPort>,
    research_readback: Arc<dyn ResearchReadbackOwnerPortV1>,
    token_digest: [u8; 32],
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ArtifactDirectoryQueryV1 {
    limit: Option<u32>,
    after_prepared_at_epoch_ms: Option<u64>,
    after_build_request_identity: Option<String>,
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

    let database_url = required_env("RD_DASHBOARD_OWNER_READ_DATABASE_URL")?;
    let artifact = Arc::new(
        PostgresArtifactReadbackOwnerV1::connect(&database_url)
            .await
            .context("Artifact Dashboard readback adapter unavailable")?,
    );
    let research = Arc::new(
        PostgresResearchReadbackOwnerV1::connect(&database_url)
            .await
            .context("Research Dashboard readback adapter unavailable")?,
    );
    let token = required_env("RD_DASHBOARD_OWNER_READ_API_TOKEN")?;
    let state = ApiState {
        artifact_directory: artifact.clone(),
        artifact_source: artifact,
        research_directory: research.clone(),
        research_readback: research,
        token_digest: Sha256::digest(token.as_bytes()).into(),
    };
    let address =
        env::var("RD_DASHBOARD_OWNER_READ_BIND").unwrap_or_else(|_| "0.0.0.0:8082".to_string());
    let listener = TcpListener::bind(&address).await?;
    tracing::info!(%address, "R&D Dashboard read API ready");
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
        .route(
            "/v1/artifact-builds/{build_request_identity}/attempts/{attempt_identity}/source",
            get(read_artifact_source),
        )
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

async fn read_artifact_directory(
    State(state): State<ApiState>,
    Query(query): Query<ArtifactDirectoryQueryV1>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if query.limit.is_some_and(|limit| !(1..=20).contains(&limit)) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let after = match (
        query.after_prepared_at_epoch_ms,
        query.after_build_request_identity,
    ) {
        (None, None) => None,
        (Some(prepared_at_epoch_ms), Some(build_request_identity))
            if valid_identity(&build_request_identity) =>
        {
            Some(ArtifactDirectoryCursorV1 {
                prepared_at_epoch_ms,
                build_request_identity,
            })
        }
        _ => return StatusCode::BAD_REQUEST.into_response(),
    };

    match state
        .artifact_directory
        .list_artifacts(after.as_ref(), query.limit.unwrap_or(20))
        .await
    {
        Ok(readback) => (StatusCode::OK, Json(readback)).into_response(),
        Err(ArtifactBuildError::Candidate(_)) => StatusCode::BAD_REQUEST.into_response(),
        Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

async fn read_artifact_source(
    State(state): State<ApiState>,
    Path((build_request_identity, attempt_identity)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if !valid_identity(&build_request_identity) || !valid_identity(&attempt_identity) {
        return StatusCode::BAD_REQUEST.into_response();
    }

    match state
        .artifact_source
        .read_source(&build_request_identity, &attempt_identity)
        .await
    {
        Ok(Some(readback)) => (StatusCode::OK, Json(readback)).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
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
            if valid_research_request_identity(&request_identity) =>
        {
            Some(ResearchDirectoryCursorV1 {
                committed_at_epoch_ms,
                request_identity,
            })
        }
        _ => return StatusCode::BAD_REQUEST.into_response(),
    };

    match state
        .research_directory
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
    if !valid_identity(&request_identity) {
        return StatusCode::BAD_REQUEST.into_response();
    }

    match state
        .research_readback
        .read_research_v2(&request_identity)
        .await
    {
        Ok(readback) => (StatusCode::OK, Json(readback)).into_response(),
        Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

fn valid_identity(value: &str) -> bool {
    (1..=192).contains(&value.len())
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.' | b'/')
        })
}

fn valid_research_request_identity(value: &str) -> bool {
    (16..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
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
    use vibe_strategy_factory::{
        artifact_build::{
            ArtifactDirectoryCompletenessV1, ArtifactDirectoryReadbackV1, ArtifactSourceReadbackV1,
        },
        product_edge::{
            ResearchDirectoryCompletenessV1, ResearchDirectoryReadbackV1, ResearchGoalOwnerError,
            ResearchGoalOwnerResultV2,
        },
    };

    use super::*;

    #[derive(Default)]
    struct RecordingArtifact {
        directory_calls: AtomicUsize,
        source_calls: AtomicUsize,
        request: Mutex<Option<(Option<ArtifactDirectoryCursorV1>, u32)>>,
    }

    #[async_trait]
    impl ArtifactDirectoryOwnerPort for RecordingArtifact {
        async fn list_artifacts(
            &self,
            after: Option<&ArtifactDirectoryCursorV1>,
            limit: u32,
        ) -> Result<ArtifactDirectoryReadbackV1, ArtifactBuildError> {
            self.directory_calls.fetch_add(1, Ordering::SeqCst);
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

    #[async_trait]
    impl ArtifactSourceOwnerPort for RecordingArtifact {
        async fn read_source(
            &self,
            _build_request_identity: &str,
            _attempt_identity: &str,
        ) -> Result<Option<ArtifactSourceReadbackV1>, ArtifactBuildError> {
            self.source_calls.fetch_add(1, Ordering::SeqCst);
            Ok(None)
        }
    }

    #[derive(Default)]
    struct RecordingResearch {
        directory_calls: AtomicUsize,
        readback_calls: AtomicUsize,
    }

    #[async_trait]
    impl ResearchDirectoryOwnerPort for RecordingResearch {
        async fn list_research(
            &self,
            _after: Option<&ResearchDirectoryCursorV1>,
            _limit: u32,
        ) -> Result<ResearchDirectoryReadbackV1, ResearchGoalOwnerError> {
            self.directory_calls.fetch_add(1, Ordering::SeqCst);
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
    impl ResearchReadbackOwnerPortV1 for RecordingResearch {
        async fn read_research_v2(
            &self,
            _request_identity: &str,
        ) -> Result<ResearchGoalOwnerResultV2, ResearchGoalOwnerError> {
            self.readback_calls.fetch_add(1, Ordering::SeqCst);
            Err(ResearchGoalOwnerError::Storage("test stop".into()))
        }
    }

    fn state(artifact: Arc<RecordingArtifact>, research: Arc<RecordingResearch>) -> ApiState {
        ApiState {
            artifact_directory: artifact.clone(),
            artifact_source: artifact,
            research_directory: research.clone(),
            research_readback: research,
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
        let artifact = Arc::new(RecordingArtifact::default());
        let research = Arc::new(RecordingResearch::default());
        let api = state(artifact.clone(), research.clone());
        let response = read_artifact_directory(
            State(api.clone()),
            Query(ArtifactDirectoryQueryV1 {
                limit: None,
                after_prepared_at_epoch_ms: None,
                after_build_request_identity: None,
            }),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let response = read_research_v2(
            State(api),
            Path("research-request-v2-test".to_string()),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(artifact.directory_calls.load(Ordering::SeqCst), 0);
        assert_eq!(research.readback_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn artifact_directory_forwards_one_exact_cursor() {
        let artifact = Arc::new(RecordingArtifact::default());
        let response = read_artifact_directory(
            State(state(
                artifact.clone(),
                Arc::new(RecordingResearch::default()),
            )),
            Query(ArtifactDirectoryQueryV1 {
                limit: Some(7),
                after_prepared_at_epoch_ms: Some(42),
                after_build_request_identity: Some("artifact-build-request-42".to_string()),
            }),
            headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            artifact.request.lock().expect("request lock").clone(),
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
    async fn invalid_requests_fail_before_owner_dispatch() {
        let artifact = Arc::new(RecordingArtifact::default());
        let research = Arc::new(RecordingResearch::default());
        let api = state(artifact.clone(), research.clone());
        let response = read_artifact_source(
            State(api.clone()),
            Path(("invalid identity".to_string(), "attempt-1".to_string())),
            headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let response = read_research_directory(
            State(api.clone()),
            Query(ResearchDirectoryQueryV1 {
                limit: None,
                after_committed_at_epoch_ms: Some(42),
                after_request_identity: None,
            }),
            headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let response = read_artifact_directory(
            State(api.clone()),
            Query(ArtifactDirectoryQueryV1 {
                limit: Some(21),
                after_prepared_at_epoch_ms: None,
                after_build_request_identity: None,
            }),
            headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let response = read_research_directory(
            State(api),
            Query(ResearchDirectoryQueryV1 {
                limit: Some(20),
                after_committed_at_epoch_ms: Some(42),
                after_request_identity: Some("short".to_string()),
            }),
            headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(artifact.directory_calls.load(Ordering::SeqCst), 0);
        assert_eq!(artifact.source_calls.load(Ordering::SeqCst), 0);
        assert_eq!(research.directory_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn valid_artifact_source_dispatches_once_and_preserves_missing() {
        let artifact = Arc::new(RecordingArtifact::default());
        let response = read_artifact_source(
            State(state(
                artifact.clone(),
                Arc::new(RecordingResearch::default()),
            )),
            Path(("build-1".to_string(), "attempt-1".to_string())),
            headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(artifact.source_calls.load(Ordering::SeqCst), 1);
    }
}
