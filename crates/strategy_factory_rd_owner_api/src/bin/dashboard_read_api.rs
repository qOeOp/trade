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
use vibe_backtest_owner_contracts::{CanonicalDigestV2, OpaqueIdentityV2};
use vibe_strategy_factory::{
    artifact_build::{
        ArtifactBuildError, ArtifactDirectoryCursorV1, ArtifactDirectoryOwnerPort,
        ArtifactReadbackOwnerPortV1, ArtifactSourceOwnerPort,
    },
    artifact_build_postgres::PostgresArtifactReadbackOwnerV1,
    develop_composer_operation_v2::{
        DevelopComposerOperationDispositionV2, DevelopComposerOperationResponseV2,
        DevelopComposerReadbackOwnerPortV2,
    },
    exploratory_replay::{
        ExploratoryReplayOwnerError, ExploratoryReplayReadResultV2,
        ExploratoryReplayRecoverySelectorV2, ExploratoryReplaySealedReadPortV2,
    },
    product_edge::{
        ResearchDirectoryCursorV1, ResearchDirectoryOwnerPort, ResearchReadbackOwnerPortV1,
    },
    product_edge_postgres::{
        PostgresExploratoryReplayReadbackOwnerV2, PostgresResearchReadbackOwnerV1,
    },
    source_intake::{
        PostgresSourceIntakeReadbackOwnerV1, SourceIntakeOwnerErrorV1,
        SourceIntakeReadbackOwnerPort,
    },
};

#[cfg(feature = "dashboard-composer-readback")]
use vibe_strategy_factory::source_research_composer_postgres_v2::PostgresDevelopComposerReadbackOwnerV2;

#[derive(Clone)]
struct ApiState {
    artifact_directory: Arc<dyn ArtifactDirectoryOwnerPort>,
    artifact_readback: Arc<dyn ArtifactReadbackOwnerPortV1>,
    artifact_source: Arc<dyn ArtifactSourceOwnerPort>,
    research_directory: Arc<dyn ResearchDirectoryOwnerPort>,
    research_readback: Arc<dyn ResearchReadbackOwnerPortV1>,
    source_intake_readback: Option<Arc<dyn SourceIntakeReadbackOwnerPort>>,
    composer_readback: Option<Arc<dyn DevelopComposerReadbackOwnerPortV2>>,
    exploratory_replay_readback: Arc<dyn ExploratoryReplayReadbackOwnerPortV2>,
    token_digest: [u8; 32],
}

#[async_trait::async_trait]
trait ExploratoryReplayReadbackOwnerPortV2: Send + Sync {
    async fn read_exploratory_replay(
        &self,
        selector: &ExploratoryReplayRecoverySelectorV2,
    ) -> Result<ExploratoryReplayReadResultV2, ExploratoryReplayOwnerError>;
}

#[async_trait::async_trait]
impl ExploratoryReplayReadbackOwnerPortV2 for PostgresExploratoryReplayReadbackOwnerV2 {
    async fn read_exploratory_replay(
        &self,
        selector: &ExploratoryReplayRecoverySelectorV2,
    ) -> Result<ExploratoryReplayReadResultV2, ExploratoryReplayOwnerError> {
        ExploratoryReplaySealedReadPortV2::resolve_sealed_exploratory_replay_request_v2(
            self, selector,
        )
        .await
    }
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

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExploratoryReplayReadbackQueryV2 {
    request_identity: String,
    meaning_digest: String,
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
    let exploratory_replay = Arc::new(
        PostgresExploratoryReplayReadbackOwnerV2::connect(&database_url)
            .await
            .context("Exploratory Replay Dashboard readback adapter unavailable")?,
    );
    let source_intake_readback = source_intake_readback(&database_url).await;
    let composer_readback = composer_readback(&database_url).await;
    let token = required_env("RD_DASHBOARD_OWNER_READ_API_TOKEN")?;
    let state = ApiState {
        artifact_directory: artifact.clone(),
        artifact_readback: artifact.clone(),
        artifact_source: artifact,
        research_directory: research.clone(),
        research_readback: research,
        source_intake_readback,
        composer_readback,
        exploratory_replay_readback: exploratory_replay,
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
        .route(
            "/v1/artifact-builds/{build_request_identity}/attempts/{attempt_identity}/readback",
            get(read_artifact),
        )
        .route("/v1/research-goals/directory", get(read_research_directory))
        .route(
            "/v2/research-goals/{request_identity}/readback",
            get(read_research_v2),
        )
        .route(
            "/v1/source-intakes/{request_identity}/readback",
            get(read_source_intake),
        )
        .route(
            "/v2/develop-composer/runs/{request_identity}/readback",
            get(read_develop_composer),
        )
        .route(
            "/v2/exploratory-replay-requests/readback",
            get(read_exploratory_replay),
        )
        .with_state(state)
}

#[cfg(feature = "dashboard-composer-readback")]
async fn composer_readback(
    owner_database_url: &str,
) -> Option<Arc<dyn DevelopComposerReadbackOwnerPortV2>> {
    match PostgresDevelopComposerReadbackOwnerV2::connect(owner_database_url).await {
        Ok(readback) => Some(Arc::new(readback)),
        Err(_) => {
            tracing::warn!("Develop Composer Dashboard readback adapter unavailable");
            None
        }
    }
}

#[cfg(not(feature = "dashboard-composer-readback"))]
async fn composer_readback(
    _owner_database_url: &str,
) -> Option<Arc<dyn DevelopComposerReadbackOwnerPortV2>> {
    tracing::warn!("Develop Composer Dashboard readback capability unavailable");
    None
}

async fn source_intake_readback(
    owner_database_url: &str,
) -> Option<Arc<dyn SourceIntakeReadbackOwnerPort>> {
    let product_edge_database_url =
        env::var("RD_DASHBOARD_SOURCE_INTAKE_PRODUCT_EDGE_DATABASE_URL")
            .ok()
            .filter(|value| !value.is_empty());
    let request_proof = env::var("RD_DASHBOARD_SOURCE_INTAKE_REQUEST_PROOF")
        .ok()
        .filter(|value| !value.is_empty());
    let (Some(product_edge_database_url), Some(request_proof)) =
        (product_edge_database_url, request_proof)
    else {
        tracing::warn!("Source Intake Dashboard readback configuration unavailable");
        return None;
    };
    let request_proof_digest = format!("sha256:{}", hex_digest(&Sha256::digest(request_proof)));

    match PostgresSourceIntakeReadbackOwnerV1::connect(
        owner_database_url,
        &product_edge_database_url,
        request_proof_digest,
    )
    .await
    {
        Ok(readback) => Some(Arc::new(readback)),
        Err(_) => {
            tracing::warn!("Source Intake Dashboard readback adapter unavailable");
            None
        }
    }
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

async fn read_artifact(
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
        .artifact_readback
        .read_artifact(&build_request_identity, &attempt_identity)
        .await
    {
        Ok(readback) => (StatusCode::OK, Json(readback)).into_response(),
        Err(ArtifactBuildError::ConflictingReplay) => StatusCode::CONFLICT.into_response(),
        Err(ArtifactBuildError::Candidate(_)) => StatusCode::BAD_REQUEST.into_response(),
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

#[derive(Debug, serde::Serialize)]
struct SourceIntakeUnknownV1<'a> {
    request_identity: &'a str,
    resolution: &'static str,
    next_legal_action: &'static str,
}

async fn read_source_intake(
    State(state): State<ApiState>,
    Path(request_identity): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return source_intake_unknown(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            &request_identity,
        );
    }

    if !valid_identity(&request_identity) {
        return source_intake_unknown(
            StatusCode::BAD_REQUEST,
            "MALFORMED_TYPED_REQUEST",
            &request_identity,
        );
    }
    let Some(owner) = &state.source_intake_readback else {
        return source_intake_unknown(
            StatusCode::SERVICE_UNAVAILABLE,
            "OWNER_OUTCOME_UNKNOWN",
            &request_identity,
        );
    };

    match owner.read_source_intake(&request_identity).await {
        Ok(Some(terminal)) => (StatusCode::OK, Json(terminal)).into_response(),
        Ok(None)
        | Err(
            SourceIntakeOwnerErrorV1::PolicyUnavailable | SourceIntakeOwnerErrorV1::ResponseLost,
        ) => source_intake_unknown(
            StatusCode::ACCEPTED,
            "OWNER_OUTCOME_UNKNOWN",
            &request_identity,
        ),
        Err(SourceIntakeOwnerErrorV1::Conflict) => source_intake_unknown(
            StatusCode::CONFLICT,
            "CONFLICTING_SEMANTICS_FOR_REQUEST_IDENTITY",
            &request_identity,
        ),
        Err(SourceIntakeOwnerErrorV1::Invalid) => source_intake_unknown(
            StatusCode::BAD_REQUEST,
            "MALFORMED_TYPED_REQUEST",
            &request_identity,
        ),
        Err(SourceIntakeOwnerErrorV1::Unavailable) => source_intake_unknown(
            StatusCode::SERVICE_UNAVAILABLE,
            "OWNER_OUTCOME_UNKNOWN",
            &request_identity,
        ),
    }
}

fn source_intake_unknown(status: StatusCode, code: &str, request_identity: &str) -> Response {
    let mut response = (
        status,
        Json(SourceIntakeUnknownV1 {
            request_identity,
            resolution: "SUBMITTED_OR_UNKNOWN",
            next_legal_action: "RESOLVE_SAME_REQUEST",
        }),
    )
        .into_response();

    if let Ok(value) = code.parse() {
        response.headers_mut().insert("x-rd-rejection-code", value);
    }
    response
}

async fn read_develop_composer(
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
    let Some(owner) = &state.composer_readback else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };

    match owner.read_develop_composer(&request_identity).await {
        Ok(response) => composer_operation_response(response),
        Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

fn composer_operation_response(response: DevelopComposerOperationResponseV2) -> Response {
    let status = match response.disposition {
        DevelopComposerOperationDispositionV2::Success => StatusCode::OK,
        DevelopComposerOperationDispositionV2::Conflict => StatusCode::CONFLICT,
        DevelopComposerOperationDispositionV2::Unsupported
        | DevelopComposerOperationDispositionV2::NeedsResearchRefinement => {
            StatusCode::UNPROCESSABLE_ENTITY
        }
        DevelopComposerOperationDispositionV2::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
        DevelopComposerOperationDispositionV2::SubmittedOrUnknown => StatusCode::ACCEPTED,
    };
    (status, Json(response)).into_response()
}

async fn read_exploratory_replay(
    State(state): State<ApiState>,
    Query(query): Query<ExploratoryReplayReadbackQueryV2>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }

    if OpaqueIdentityV2::try_from(query.request_identity.clone()).is_err()
        || CanonicalDigestV2::try_from(query.meaning_digest.clone()).is_err()
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let selector = ExploratoryReplayRecoverySelectorV2 {
        request_identity: query.request_identity,
        meaning_digest: query.meaning_digest,
    };

    match state
        .exploratory_replay_readback
        .read_exploratory_replay(&selector)
        .await
    {
        Ok(readback) => (StatusCode::OK, Json(readback)).into_response(),
        Err(ExploratoryReplayOwnerError::ConflictingReplay) => StatusCode::CONFLICT.into_response(),
        Err(ExploratoryReplayOwnerError::InvalidProposal(_)) => {
            StatusCode::BAD_REQUEST.into_response()
        }
        Err(ExploratoryReplayOwnerError::Unavailable(_)) => {
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
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

fn hex_digest(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(char::from(HEX[usize::from(byte >> 4)]));
        output.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    output
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
            ArtifactBuildResultV1, ArtifactDirectoryCompletenessV1, ArtifactDirectoryReadbackV1,
            ArtifactSourceReadbackV1,
        },
        develop_composer_operation_v2::{
            DevelopComposerOperationDispositionV2, DevelopComposerOperationResponseV2,
            DevelopComposerReadbackOwnerErrorV2, DevelopComposerReadbackOwnerPortV2,
        },
        exploratory_replay::{
            ExploratoryReplayOwnerError, ExploratoryReplayReadResultV2,
            ExploratoryReplayRecoverySelectorV2,
        },
        product_edge::{
            ResearchDirectoryCompletenessV1, ResearchDirectoryReadbackV1, ResearchGoalOwnerError,
            ResearchGoalOwnerResultV2,
        },
        source_intake::{
            SourceIntakeOwnerErrorV1, SourceIntakeReadbackOwnerPort, SourceIntakeTerminalAtomV1,
        },
    };

    use super::*;

    #[derive(Default)]
    struct RecordingArtifact {
        directory_calls: AtomicUsize,
        readback_calls: AtomicUsize,
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

    #[async_trait]
    impl ArtifactReadbackOwnerPortV1 for RecordingArtifact {
        async fn read_artifact(
            &self,
            build_request_identity: &str,
            attempt_identity: &str,
        ) -> Result<ArtifactBuildResultV1, ArtifactBuildError> {
            self.readback_calls.fetch_add(1, Ordering::SeqCst);
            Ok(ArtifactBuildResultV1::submitted_or_unknown(
                build_request_identity,
                attempt_identity,
            ))
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

    #[derive(Default)]
    struct RecordingSourceIntake {
        readback_calls: AtomicUsize,
    }

    #[derive(Default)]
    struct RecordingComposer {
        readback_calls: AtomicUsize,
    }

    #[derive(Default)]
    struct RecordingReplay {
        readback_calls: AtomicUsize,
    }

    #[async_trait]
    impl ExploratoryReplayReadbackOwnerPortV2 for RecordingReplay {
        async fn read_exploratory_replay(
            &self,
            _selector: &ExploratoryReplayRecoverySelectorV2,
        ) -> Result<ExploratoryReplayReadResultV2, ExploratoryReplayOwnerError> {
            self.readback_calls.fetch_add(1, Ordering::SeqCst);
            Err(ExploratoryReplayOwnerError::Unavailable(
                "test stop".to_owned(),
            ))
        }
    }

    #[async_trait]
    impl DevelopComposerReadbackOwnerPortV2 for RecordingComposer {
        async fn read_develop_composer(
            &self,
            request_identity: &str,
        ) -> Result<DevelopComposerOperationResponseV2, DevelopComposerReadbackOwnerErrorV2>
        {
            self.readback_calls.fetch_add(1, Ordering::SeqCst);
            Ok(DevelopComposerOperationResponseV2 {
                schema_version: 2,
                request_identity: request_identity.to_owned(),
                disposition: DevelopComposerOperationDispositionV2::Unavailable,
                receipt_identity: None,
                artifact: None,
                coordinate: Some("operation".to_owned()),
                reason: Some("terminal is unavailable".to_owned()),
            })
        }
    }

    #[async_trait]
    impl SourceIntakeReadbackOwnerPort for RecordingSourceIntake {
        async fn read_source_intake(
            &self,
            _request_identity: &str,
        ) -> Result<Option<SourceIntakeTerminalAtomV1>, SourceIntakeOwnerErrorV1> {
            self.readback_calls.fetch_add(1, Ordering::SeqCst);
            Ok(None)
        }
    }

    fn state(
        artifact: Arc<RecordingArtifact>,
        research: Arc<RecordingResearch>,
        source_intake: Arc<RecordingSourceIntake>,
    ) -> ApiState {
        ApiState {
            artifact_directory: artifact.clone(),
            artifact_readback: artifact.clone(),
            artifact_source: artifact,
            research_directory: research.clone(),
            research_readback: research,
            source_intake_readback: Some(source_intake),
            composer_readback: Some(Arc::new(RecordingComposer::default())),
            exploratory_replay_readback: Arc::new(RecordingReplay::default()),
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
        let source_intake = Arc::new(RecordingSourceIntake::default());
        let api = state(artifact.clone(), research.clone(), source_intake.clone());
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
            State(api.clone()),
            Path("research-request-v2-test".to_string()),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let response = read_artifact(
            State(api.clone()),
            Path(("build-1".to_owned(), "attempt-1".to_owned())),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let response = read_source_intake(
            State(api),
            Path("source-request-test".to_string()),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(artifact.directory_calls.load(Ordering::SeqCst), 0);
        assert_eq!(artifact.readback_calls.load(Ordering::SeqCst), 0);
        assert_eq!(research.readback_calls.load(Ordering::SeqCst), 0);
        assert_eq!(source_intake.readback_calls.load(Ordering::SeqCst), 0);
        let response = read_develop_composer(
            State(state(
                Arc::new(RecordingArtifact::default()),
                Arc::new(RecordingResearch::default()),
                Arc::new(RecordingSourceIntake::default()),
            )),
            Path("composer-request-1".to_owned()),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let replay = Arc::new(RecordingReplay::default());
        let mut api = state(
            Arc::new(RecordingArtifact::default()),
            Arc::new(RecordingResearch::default()),
            Arc::new(RecordingSourceIntake::default()),
        );
        api.exploratory_replay_readback = replay.clone();
        let response = read_exploratory_replay(
            State(api),
            Query(ExploratoryReplayReadbackQueryV2 {
                request_identity: "replay-request-1".to_owned(),
                meaning_digest: format!("sha256:{}", "a".repeat(64)),
            }),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(replay.readback_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn artifact_directory_forwards_one_exact_cursor() {
        let artifact = Arc::new(RecordingArtifact::default());
        let response = read_artifact_directory(
            State(state(
                artifact.clone(),
                Arc::new(RecordingResearch::default()),
                Arc::new(RecordingSourceIntake::default()),
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
        let source_intake = Arc::new(RecordingSourceIntake::default());
        let api = state(artifact.clone(), research.clone(), source_intake.clone());
        let response = read_artifact_source(
            State(api.clone()),
            Path(("invalid identity".to_string(), "attempt-1".to_string())),
            headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let response = read_artifact(
            State(api.clone()),
            Path(("invalid identity".to_owned(), "attempt-1".to_owned())),
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
            State(api.clone()),
            Query(ResearchDirectoryQueryV1 {
                limit: Some(20),
                after_committed_at_epoch_ms: Some(42),
                after_request_identity: Some("short".to_string()),
            }),
            headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let response =
            read_source_intake(State(api), Path("bad identity".to_string()), headers()).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(artifact.directory_calls.load(Ordering::SeqCst), 0);
        assert_eq!(artifact.readback_calls.load(Ordering::SeqCst), 0);
        assert_eq!(artifact.source_calls.load(Ordering::SeqCst), 0);
        assert_eq!(research.directory_calls.load(Ordering::SeqCst), 0);
        assert_eq!(source_intake.readback_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn valid_artifact_source_dispatches_once_and_preserves_missing() {
        let artifact = Arc::new(RecordingArtifact::default());
        let response = read_artifact_source(
            State(state(
                artifact.clone(),
                Arc::new(RecordingResearch::default()),
                Arc::new(RecordingSourceIntake::default()),
            )),
            Path(("build-1".to_string(), "attempt-1".to_string())),
            headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(artifact.source_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn valid_artifact_readback_dispatches_once_and_preserves_unknown() {
        let artifact = Arc::new(RecordingArtifact::default());
        let response = read_artifact(
            State(state(
                artifact.clone(),
                Arc::new(RecordingResearch::default()),
                Arc::new(RecordingSourceIntake::default()),
            )),
            Path(("build-1".to_owned(), "attempt-1".to_owned())),
            headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(artifact.readback_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn valid_source_intake_readback_dispatches_once_and_preserves_unknown() {
        let source_intake = Arc::new(RecordingSourceIntake::default());
        let response = read_source_intake(
            State(state(
                Arc::new(RecordingArtifact::default()),
                Arc::new(RecordingResearch::default()),
                source_intake.clone(),
            )),
            Path("source-request-1".to_string()),
            headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        assert_eq!(
            response.headers().get("x-rd-rejection-code"),
            Some(&HeaderValue::from_static("OWNER_OUTCOME_UNKNOWN")),
        );
        assert_eq!(source_intake.readback_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn missing_source_intake_adapter_fails_closed() {
        let artifact = Arc::new(RecordingArtifact::default());
        let research = Arc::new(RecordingResearch::default());
        let mut api = state(
            artifact,
            research,
            Arc::new(RecordingSourceIntake::default()),
        );
        api.source_intake_readback = None;
        let response =
            read_source_intake(State(api), Path("source-request-1".to_string()), headers()).await;
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn valid_composer_readback_dispatches_once_and_preserves_terminal_status() {
        let composer = Arc::new(RecordingComposer::default());
        let mut api = state(
            Arc::new(RecordingArtifact::default()),
            Arc::new(RecordingResearch::default()),
            Arc::new(RecordingSourceIntake::default()),
        );
        api.composer_readback = Some(composer.clone());
        let response =
            read_develop_composer(State(api), Path("composer-request-1".to_owned()), headers())
                .await;
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(composer.readback_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn missing_composer_adapter_fails_closed() {
        let mut api = state(
            Arc::new(RecordingArtifact::default()),
            Arc::new(RecordingResearch::default()),
            Arc::new(RecordingSourceIntake::default()),
        );
        api.composer_readback = None;
        let response =
            read_develop_composer(State(api), Path("composer-request-1".to_owned()), headers())
                .await;
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn replay_readback_validates_selector_and_dispatches_once() {
        let replay = Arc::new(RecordingReplay::default());
        let mut api = state(
            Arc::new(RecordingArtifact::default()),
            Arc::new(RecordingResearch::default()),
            Arc::new(RecordingSourceIntake::default()),
        );
        api.exploratory_replay_readback = replay.clone();

        let invalid = read_exploratory_replay(
            State(api.clone()),
            Query(ExploratoryReplayReadbackQueryV2 {
                request_identity: " replay-request-1".to_owned(),
                meaning_digest: format!("sha256:{}", "a".repeat(64)),
            }),
            headers(),
        )
        .await;
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
        assert_eq!(replay.readback_calls.load(Ordering::SeqCst), 0);

        let unavailable = read_exploratory_replay(
            State(api),
            Query(ExploratoryReplayReadbackQueryV2 {
                request_identity: "replay-request-1".to_owned(),
                meaning_digest: format!("sha256:{}", "a".repeat(64)),
            }),
            headers(),
        )
        .await;
        assert_eq!(unavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(replay.readback_calls.load(Ordering::SeqCst), 1);
    }
}
