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
    BacktestResultCustodyErrorV2, ExploratoryReplayResultLocatorV2,
    artifact_build::{
        ArtifactBuildError, ArtifactBuildResultV1, ArtifactDirectoryCursorV1,
        ArtifactDirectoryOwnerPort, ArtifactDirectoryReadbackV1, ArtifactReadbackOwnerPortV1,
        ArtifactSourceOwnerPort, ArtifactSourceReadbackV1,
    },
    artifact_build_postgres::PostgresArtifactReadbackOwnerV1,
    dashboard_read::{
        ComposedFormationCatalogOwnerV1, DashboardReadErrorV1, FormationCatalogOwnerPortV1,
        FormationCatalogReadbackV1, IterationTimelineOwnerPortV1, IterationTimelineReadbackV1,
        PostgresIterationTimelineOwnerV1, ResearchQuestionDirectoryOwnerPortV1,
        ResearchQuestionDirectoryReadbackV1,
    },
    develop_composer_operation_v2::{
        DevelopComposerOperationDispositionV2, DevelopComposerOperationResponseV2,
        DevelopComposerReadbackOwnerPortV2,
    },
    exploratory_replay::{
        ExploratoryReplayHistoricalRejectionReadPortV1, ExploratoryReplayOwnerError,
        ExploratoryReplayReadResultV2, ExploratoryReplayRecoverySelectorV2,
        ExploratoryReplaySealedReadPortV2, HistoricalExploratoryReplayRejectionReadbackV1,
        HistoricalExploratoryReplayRejectionSelectorV1,
    },
    product_edge::{
        ResearchDirectoryCursorV1, ResearchDirectoryOwnerPort, ResearchReadbackOwnerPortV1,
    },
    product_edge_postgres::{
        PostgresExploratoryReplayReadbackOwnerV2, PostgresResearchReadbackOwnerV1,
    },
    rd_historical_custody::{
        HistoricalCustodyErrorV1, HistoricalCustodyOwnerPortV1, HistoricalCustodyQuarantineV1,
    },
    rd_historical_custody_postgres::PostgresHistoricalCustodyOwnerV1,
    source_intake::{
        PostgresSourceIntakeReadbackOwnerV1, SourceIntakeOwnerErrorV1,
        SourceIntakeReadbackOwnerPort,
    },
};

use vibe_strategy_factory::source_research_composer_postgres_v2::PostgresDevelopComposerReadbackOwnerV2;

#[derive(Clone)]
pub struct ApiState {
    pub artifact_directory: Arc<dyn ArtifactDirectoryOwnerPort>,
    pub artifact_readback: Arc<dyn ArtifactReadbackOwnerPortV1>,
    pub artifact_source: Arc<dyn ArtifactSourceOwnerPort>,
    pub research_directory: Arc<dyn ResearchDirectoryOwnerPort>,
    pub research_readback: Arc<dyn ResearchReadbackOwnerPortV1>,
    pub research_questions: Arc<dyn ResearchQuestionDirectoryOwnerPortV1>,
    pub formation_catalog: Arc<dyn FormationCatalogOwnerPortV1>,
    pub iteration_timeline: Arc<dyn IterationTimelineOwnerPortV1>,
    pub source_intake_readback: Option<Arc<dyn SourceIntakeReadbackOwnerPort>>,
    pub composer_readback: Option<Arc<dyn DevelopComposerReadbackOwnerPortV2>>,
    pub exploratory_replay_readback: Arc<dyn ExploratoryReplayReadbackOwnerPortV2>,
    pub exploratory_replay_result_readback: Arc<dyn ExploratoryReplayResultReadbackOwnerPortV2>,
    pub exploratory_replay_historical_rejection_readback:
        Arc<dyn ExploratoryReplayHistoricalRejectionOwnerPortV1>,
    pub historical_custody: Arc<dyn HistoricalCustodyOwnerPortV1>,
    pub token_digest: [u8; 32],
}

#[async_trait::async_trait]
pub trait ExploratoryReplayReadbackOwnerPortV2: Send + Sync {
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

#[async_trait::async_trait]
pub trait ExploratoryReplayResultReadbackOwnerPortV2: Send + Sync {
    async fn read_exploratory_replay_result(
        &self,
        result_identity: &str,
        request_identity: &str,
        attempt_identity: &str,
    ) -> Result<Option<Vec<u8>>, BacktestResultCustodyErrorV2>;
}

#[async_trait::async_trait]
pub trait ExploratoryReplayHistoricalRejectionOwnerPortV1: Send + Sync {
    async fn read_historical_rejection(
        &self,
        selector: &HistoricalExploratoryReplayRejectionSelectorV1,
    ) -> Result<Option<HistoricalExploratoryReplayRejectionReadbackV1>, ExploratoryReplayOwnerError>;
}

#[async_trait::async_trait]
impl ExploratoryReplayHistoricalRejectionOwnerPortV1 for PostgresExploratoryReplayReadbackOwnerV2 {
    async fn read_historical_rejection(
        &self,
        selector: &HistoricalExploratoryReplayRejectionSelectorV1,
    ) -> Result<Option<HistoricalExploratoryReplayRejectionReadbackV1>, ExploratoryReplayOwnerError>
    {
        self.read_historical_exploratory_replay_rejection_v1(selector)
            .await
    }
}

#[async_trait::async_trait]
impl ExploratoryReplayResultReadbackOwnerPortV2 for PostgresExploratoryReplayReadbackOwnerV2 {
    async fn read_exploratory_replay_result(
        &self,
        result_identity: &str,
        request_identity: &str,
        attempt_identity: &str,
    ) -> Result<Option<Vec<u8>>, BacktestResultCustodyErrorV2> {
        self.resolve_exploratory_replay_result_v2(ExploratoryReplayResultLocatorV2 {
            result_identity,
            request_identity,
            attempt_identity,
        })
        .await
        .map(|result| result.map(|locked| locked.result_canonical_bytes().to_vec()))
    }
}

#[derive(Clone)]
pub struct UnavailableHistoricalCustodyV1;

#[async_trait::async_trait]
impl HistoricalCustodyOwnerPortV1 for UnavailableHistoricalCustodyV1 {
    async fn read_historical_custodies(
        &self,
    ) -> Result<HistoricalCustodyQuarantineV1, HistoricalCustodyErrorV1> {
        Err(HistoricalCustodyErrorV1::Storage(
            "Historical custody Dashboard readback capability unavailable".to_owned(),
        ))
    }
}

pub struct UnavailableArtifactReadbackV1;

fn artifact_unavailable() -> ArtifactBuildError {
    ArtifactBuildError::Storage("Artifact Dashboard readback capability unavailable".to_owned())
}

#[async_trait::async_trait]
impl ArtifactDirectoryOwnerPort for UnavailableArtifactReadbackV1 {
    async fn list_artifacts(
        &self,
        _after: Option<&ArtifactDirectoryCursorV1>,
        _limit: u32,
    ) -> Result<ArtifactDirectoryReadbackV1, ArtifactBuildError> {
        Err(artifact_unavailable())
    }
}

#[async_trait::async_trait]
impl ArtifactReadbackOwnerPortV1 for UnavailableArtifactReadbackV1 {
    async fn read_artifact(
        &self,
        _build_request_identity: &str,
        _attempt_identity: &str,
    ) -> Result<ArtifactBuildResultV1, ArtifactBuildError> {
        Err(artifact_unavailable())
    }
}

#[async_trait::async_trait]
impl ArtifactSourceOwnerPort for UnavailableArtifactReadbackV1 {
    async fn read_source(
        &self,
        _build_request_identity: &str,
        _attempt_identity: &str,
    ) -> Result<Option<ArtifactSourceReadbackV1>, ArtifactBuildError> {
        Err(artifact_unavailable())
    }
}

#[derive(Clone)]
pub struct UnavailableExploratoryReplayReadbackV2;

#[derive(Clone)]
pub struct UnavailableDashboardJourneyReadbackV1;

#[async_trait::async_trait]
impl FormationCatalogOwnerPortV1 for UnavailableDashboardJourneyReadbackV1 {
    async fn read_formation_catalog(
        &self,
    ) -> Result<FormationCatalogReadbackV1, DashboardReadErrorV1> {
        Err(DashboardReadErrorV1::Unavailable(
            "Formation Catalog Dashboard capability unavailable".to_owned(),
        ))
    }
}

#[async_trait::async_trait]
impl IterationTimelineOwnerPortV1 for UnavailableDashboardJourneyReadbackV1 {
    async fn read_iteration_timeline(
        &self,
        _trial_family_identity: &str,
    ) -> Result<IterationTimelineReadbackV1, DashboardReadErrorV1> {
        Err(DashboardReadErrorV1::Unavailable(
            "Iteration Timeline Dashboard capability unavailable".to_owned(),
        ))
    }
}

#[async_trait::async_trait]
impl ResearchQuestionDirectoryOwnerPortV1 for UnavailableDashboardJourneyReadbackV1 {
    async fn read_research_question_directory(
        &self,
    ) -> Result<ResearchQuestionDirectoryReadbackV1, DashboardReadErrorV1> {
        Err(DashboardReadErrorV1::Unavailable(
            "Research question directory Dashboard capability unavailable".to_owned(),
        ))
    }
}

#[async_trait::async_trait]
impl ExploratoryReplayReadbackOwnerPortV2 for UnavailableExploratoryReplayReadbackV2 {
    async fn read_exploratory_replay(
        &self,
        _selector: &ExploratoryReplayRecoverySelectorV2,
    ) -> Result<ExploratoryReplayReadResultV2, ExploratoryReplayOwnerError> {
        Err(ExploratoryReplayOwnerError::Unavailable(
            "Exploratory Replay Dashboard readback capability unavailable".to_owned(),
        ))
    }
}

#[async_trait::async_trait]
impl ExploratoryReplayResultReadbackOwnerPortV2 for UnavailableExploratoryReplayReadbackV2 {
    async fn read_exploratory_replay_result(
        &self,
        _result_identity: &str,
        _request_identity: &str,
        _attempt_identity: &str,
    ) -> Result<Option<Vec<u8>>, BacktestResultCustodyErrorV2> {
        Err(BacktestResultCustodyErrorV2::Unavailable)
    }
}

#[async_trait::async_trait]
impl ExploratoryReplayHistoricalRejectionOwnerPortV1 for UnavailableExploratoryReplayReadbackV2 {
    async fn read_historical_rejection(
        &self,
        _selector: &HistoricalExploratoryReplayRejectionSelectorV1,
    ) -> Result<Option<HistoricalExploratoryReplayRejectionReadbackV1>, ExploratoryReplayOwnerError>
    {
        Err(ExploratoryReplayOwnerError::Unavailable(
            "Historical Replay rejection Dashboard readback capability unavailable".to_owned(),
        ))
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactDirectoryQueryV1 {
    pub limit: Option<u32>,
    pub after_prepared_at_epoch_ms: Option<u64>,
    pub after_build_request_identity: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchDirectoryQueryV1 {
    pub limit: Option<u32>,
    pub after_committed_at_epoch_ms: Option<u64>,
    pub after_request_identity: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExploratoryReplayReadbackQueryV2 {
    pub request_identity: String,
    pub meaning_digest: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExploratoryReplayHistoricalRejectionQueryV1 {
    pub request_identity: String,
    pub attempt_identity: String,
    pub semantic_digest: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExploratoryReplayResultPathV2 {
    pub result_identity: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExploratoryReplayResultQueryV2 {
    pub request_identity: String,
    pub attempt_identity: String,
}

/// Source Intake readback binding for the Dashboard read API.
#[derive(Clone)]
pub struct SourceIntakeReadConfigV1 {
    pub product_edge_database_url: String,
    pub request_proof: String,
}

/// Everything the Dashboard read API needs to compose its Owner read ports and listen.
#[derive(Clone)]
pub struct DashboardReadApiConfigV1 {
    pub owner_database_url: String,
    pub token: String,
    pub source_intake: Option<SourceIntakeReadConfigV1>,
    pub bind: String,
}

impl DashboardReadApiConfigV1 {
    /// Reads the deployment environment exactly as the shipped binary does.
    ///
    /// # Errors
    ///
    /// Returns an error when the Owner database URL or the bearer token is missing.
    pub fn from_environment() -> anyhow::Result<Self> {
        let product_edge_database_url =
            env::var("RD_DASHBOARD_SOURCE_INTAKE_PRODUCT_EDGE_DATABASE_URL")
                .ok()
                .filter(|value| !value.is_empty());
        let request_proof = env::var("RD_DASHBOARD_SOURCE_INTAKE_REQUEST_PROOF")
            .ok()
            .filter(|value| !value.is_empty());
        let source_intake = match (product_edge_database_url, request_proof) {
            (Some(product_edge_database_url), Some(request_proof)) => {
                Some(SourceIntakeReadConfigV1 {
                    product_edge_database_url,
                    request_proof,
                })
            }
            _ => None,
        };
        Ok(Self {
            owner_database_url: crate::required_env("RD_DASHBOARD_OWNER_READ_DATABASE_URL")?,
            token: crate::required_env("RD_DASHBOARD_OWNER_READ_API_TOKEN")?,
            source_intake,
            bind: env::var("RD_DASHBOARD_OWNER_READ_BIND")
                .unwrap_or_else(|_| "0.0.0.0:8082".to_string()),
        })
    }
}

/// Composes the production Owner read ports behind the Dashboard read API.
///
/// Every capability that cannot bind stays explicitly unavailable instead of failing the
/// whole API, except the Research readback adapter, which every journey read depends on.
///
/// # Errors
///
/// Returns an error when the Research readback adapter cannot connect.
pub async fn compose_state(config: &DashboardReadApiConfigV1) -> anyhow::Result<ApiState> {
    let database_url = config.owner_database_url.as_str();
    let (artifact_directory, artifact_readback, artifact_source): (
        Arc<dyn ArtifactDirectoryOwnerPort>,
        Arc<dyn ArtifactReadbackOwnerPortV1>,
        Arc<dyn ArtifactSourceOwnerPort>,
    ) = match PostgresArtifactReadbackOwnerV1::connect(database_url).await {
        Ok(readback) => {
            let readback = Arc::new(readback);
            (readback.clone(), readback.clone(), readback)
        }
        Err(_) => {
            tracing::warn!("Artifact Dashboard readback capability unavailable");
            let readback = Arc::new(UnavailableArtifactReadbackV1);
            (readback.clone(), readback.clone(), readback)
        }
    };
    let research = Arc::new(
        PostgresResearchReadbackOwnerV1::connect(database_url)
            .await
            .context("Research Dashboard readback adapter unavailable")?,
    );
    let formation_catalog: Arc<dyn FormationCatalogOwnerPortV1> =
        Arc::new(ComposedFormationCatalogOwnerV1::new(
            research.clone(),
            research.clone(),
            artifact_directory.clone(),
            artifact_readback.clone(),
        ));
    let iteration_timeline: Arc<dyn IterationTimelineOwnerPortV1> =
        match PostgresIterationTimelineOwnerV1::connect(database_url).await {
            Ok(readback) => Arc::new(readback),
            Err(_) => {
                tracing::warn!("Iteration Timeline Dashboard readback capability unavailable");
                Arc::new(UnavailableDashboardJourneyReadbackV1)
            }
        };
    let (exploratory_replay, exploratory_replay_result, exploratory_replay_historical_rejection): (
        Arc<dyn ExploratoryReplayReadbackOwnerPortV2>,
        Arc<dyn ExploratoryReplayResultReadbackOwnerPortV2>,
        Arc<dyn ExploratoryReplayHistoricalRejectionOwnerPortV1>,
    ) = match PostgresExploratoryReplayReadbackOwnerV2::connect(database_url).await {
        Ok(readback) => {
            let readback = Arc::new(readback);
            (readback.clone(), readback.clone(), readback)
        }
        Err(_) => {
            tracing::warn!("Exploratory Replay Dashboard readback capability unavailable");
            let readback = Arc::new(UnavailableExploratoryReplayReadbackV2);
            (readback.clone(), readback.clone(), readback)
        }
    };
    let historical_custody: Arc<dyn HistoricalCustodyOwnerPortV1> =
        match PostgresHistoricalCustodyOwnerV1::connect_read_only(database_url).await {
            Ok(readback) => Arc::new(readback),
            Err(_) => {
                tracing::warn!("Historical custody Dashboard readback capability unavailable");
                Arc::new(UnavailableHistoricalCustodyV1)
            }
        };
    let source_intake_readback =
        source_intake_readback(database_url, config.source_intake.as_ref()).await;
    let composer_readback = composer_readback(database_url).await;
    Ok(ApiState {
        artifact_directory,
        artifact_readback,
        artifact_source,
        research_directory: research.clone(),
        research_readback: research.clone(),
        research_questions: research,
        formation_catalog,
        iteration_timeline,
        source_intake_readback,
        composer_readback,
        exploratory_replay_readback: exploratory_replay,
        exploratory_replay_result_readback: exploratory_replay_result,
        exploratory_replay_historical_rejection_readback: exploratory_replay_historical_rejection,
        historical_custody,
        token_digest: Sha256::digest(config.token.as_bytes()).into(),
    })
}

/// Binds the configured listener and serves the composed read API until the process ends.
///
/// # Errors
///
/// Returns an error when composition fails or the listener cannot bind or serve.
pub async fn serve(config: DashboardReadApiConfigV1) -> anyhow::Result<()> {
    let state = compose_state(&config).await?;
    let listener = TcpListener::bind(&config.bind).await?;
    tracing::info!(address = %config.bind, "R&D Dashboard read API ready");
    axum::serve(listener, router(state)).await?;
    Ok(())
}

pub fn router(state: ApiState) -> Router {
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
            "/v1/research-goals/question-directory",
            get(read_research_question_directory),
        )
        .route("/v1/formation-catalog", get(read_formation_catalog))
        .route("/v1/historical-custodies", get(read_historical_custodies))
        .route(
            "/v1/trial-families/{trial_family_identity}/iterations",
            get(read_iteration_timeline),
        )
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
        .route(
            "/v2/exploratory-replay-results/{result_identity}",
            get(read_exploratory_replay_result),
        )
        .route(
            "/v1/exploratory-replay-rejections/readback",
            get(read_exploratory_replay_historical_rejection),
        )
        .with_state(state)
}

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

async fn source_intake_readback(
    owner_database_url: &str,
    config: Option<&SourceIntakeReadConfigV1>,
) -> Option<Arc<dyn SourceIntakeReadbackOwnerPort>> {
    let Some(config) = config else {
        tracing::warn!("Source Intake Dashboard readback configuration unavailable");
        return None;
    };
    let request_proof_digest = format!(
        "sha256:{}",
        hex_digest(&Sha256::digest(&config.request_proof))
    );

    match PostgresSourceIntakeReadbackOwnerV1::connect(
        owner_database_url,
        &config.product_edge_database_url,
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

pub async fn health() -> StatusCode {
    StatusCode::OK
}

pub async fn read_artifact_directory(
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
        Err(e) => {
            tracing::warn!(%e, "Artifact directory Dashboard read unavailable");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

pub async fn read_artifact_source(
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
        Err(e) => {
            tracing::warn!(%e, "Artifact source Dashboard read unavailable");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

pub async fn read_artifact(
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
        Err(e) => {
            tracing::warn!(%e, "Artifact readback Dashboard read unavailable");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

pub async fn read_research_directory(
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
        Err(e) => {
            tracing::warn!(%e, "Research Dashboard directory read unavailable");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

pub async fn read_research_question_directory(
    State(state): State<ApiState>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }

    match state
        .research_questions
        .read_research_question_directory()
        .await
    {
        Ok(readback) => (StatusCode::OK, Json(readback)).into_response(),
        Err(e) => {
            tracing::warn!(%e, "Research question directory read unavailable");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

pub async fn read_research_v2(
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
        Err(e) => {
            tracing::warn!(%e, "Research Dashboard point read unavailable");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

pub async fn read_formation_catalog(State(state): State<ApiState>, headers: HeaderMap) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }

    match state.formation_catalog.read_formation_catalog().await {
        Ok(readback) => (StatusCode::OK, Json(readback)).into_response(),
        Err(e) => {
            tracing::warn!(%e, "Formation Catalog Dashboard read unavailable");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

/// Reads the historical custody quarantine through the Dashboard's own read-only port.
///
/// The Dashboard's other reads already arrive here. This one used to reach the write API instead,
/// because it was the only route that did not exist on this side - and the deployed composition
/// leaves the override that would have pointed it elsewhere empty, so a read-only surface held a
/// write API credential to answer it.
pub async fn read_historical_custodies(
    State(state): State<ApiState>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }

    match state.historical_custody.read_historical_custodies().await {
        Ok(readback) => (StatusCode::OK, Json(readback)).into_response(),
        Err(e) => {
            tracing::warn!(%e, "Historical custody Dashboard read unavailable");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

pub async fn read_iteration_timeline(
    State(state): State<ApiState>,
    Path(trial_family_identity): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }

    if !valid_identity(&trial_family_identity) {
        return StatusCode::BAD_REQUEST.into_response();
    }

    match state
        .iteration_timeline
        .read_iteration_timeline(&trial_family_identity)
        .await
    {
        Ok(readback) => (StatusCode::OK, Json(readback)).into_response(),
        Err(DashboardReadErrorV1::NotFound) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::warn!(%e, "Iteration Timeline Dashboard read unavailable");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

#[derive(Debug, serde::Serialize)]
struct SourceIntakeUnknownV1<'a> {
    request_identity: &'a str,
    resolution: &'static str,
    next_legal_action: &'static str,
}

pub async fn read_source_intake(
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

pub async fn read_develop_composer(
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
        Err(e) => {
            // This error carries no Display, so it is reported by Debug rather than not at all.
            tracing::warn!(?e, "Develop Composer Dashboard read unavailable");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
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

pub async fn read_exploratory_replay(
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

pub async fn read_exploratory_replay_result(
    State(state): State<ApiState>,
    Path(path): Path<ExploratoryReplayResultPathV2>,
    Query(query): Query<ExploratoryReplayResultQueryV2>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }

    if [
        path.result_identity.as_str(),
        query.request_identity.as_str(),
        query.attempt_identity.as_str(),
    ]
    .into_iter()
    .any(|value| OpaqueIdentityV2::try_from(value.to_owned()).is_err())
    {
        return StatusCode::BAD_REQUEST.into_response();
    }

    match state
        .exploratory_replay_result_readback
        .read_exploratory_replay_result(
            &path.result_identity,
            &query.request_identity,
            &query.attempt_identity,
        )
        .await
    {
        Ok(Some(bytes)) => (
            StatusCode::OK,
            [(axum::http::header::CONTENT_TYPE, "application/json")],
            bytes,
        )
            .into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::warn!(%e, "Exploratory Replay result Dashboard read unavailable");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

pub async fn read_exploratory_replay_historical_rejection(
    State(state): State<ApiState>,
    Query(query): Query<ExploratoryReplayHistoricalRejectionQueryV1>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let Some(selector) = HistoricalExploratoryReplayRejectionSelectorV1::try_new(
        query.request_identity,
        query.attempt_identity,
        query.semantic_digest,
    ) else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    match state
        .exploratory_replay_historical_rejection_readback
        .read_historical_rejection(&selector)
        .await
    {
        Ok(Some(readback)) => (StatusCode::OK, Json(readback)).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(ExploratoryReplayOwnerError::InvalidProposal(_)) => {
            StatusCode::BAD_REQUEST.into_response()
        }
        Err(e) => {
            tracing::warn!(%e, "Exploratory Replay historical rejection Dashboard read unavailable");
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

fn hex_digest(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(char::from(HEX[usize::from(byte >> 4)]));
        output.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    output
}
