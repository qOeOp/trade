//! `/v1/backtests`: submit a `backtest.run` request and run its orchestration to wherever it
//! currently stops, and read back the runs it carried to their replay step.
//!
//! A run is recorded in R&D's backtest run registry (`backtest_run_registry_postgres_v1`) once its
//! orchestration reaches the replay step, with the canonical bytes of its request and the exact
//! answer it was given. The same request under the same run id answers that recorded run without
//! running again; another request under it is refused as `RUN_ID_CONFLICT`. A submission refused
//! before its replay step records nothing, so its run id may be submitted again. `GET` reads only
//! the registry: it never re-runs an orchestration.

use std::sync::Arc;

use axum::{
    Json, Router,
    body::Bytes,
    extract::State,
    extract::{Path, Query},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use sqlx::PgPool;
#[cfg(feature = "composer-v3-replay")]
use vibe_data::owner::{
    instrument_economic_terms_postgres_v1::InstrumentEconomicTermsPostgresOwnerV1,
    instrument_master_v2_postgres::InstrumentMasterV2PostgresOwner,
};
use vibe_data::owner::{
    market_semantics_admission_v1::MarketSemanticsAdmissionV1,
    pit_market_snapshot_intake_v1::PitMarketSnapshotIntakeV1,
    pit_window_custody_v1::{PitWindowCoverageRefusalV1, PitWindowCustodyFramesV1},
    strategy_input_binding_admission_v1::StrategyInputBindingAdmissionV1,
    universe_selection_admission_v1::UniverseSelectionAdmissionV1,
};
use vibe_product_edge::ProductEdgePostgresOwnerV1;
use vibe_strategy_factory::ExploratoryReplayResultLocatorV2;
#[cfg(feature = "composer-v3-replay")]
use vibe_strategy_factory::source_research_composer_postgres_v2::PostgresSourceResearchComposerProductionV2;
use vibe_strategy_factory::{
    backtest_run_dataset_ref_v1::BacktestRunDatasetRefV1,
    backtest_run_registry_postgres_v1::{
        BacktestRunRecordV1, BacktestRunRegistryErrorV1, MAX_BACKTEST_RUN_LIST_V1,
        PostgresBacktestRunRegistryV1,
    },
    backtest_run_report_read_v1::{
        BacktestRunCatalogStatementV1, resolve_backtest_run_report_for_statement_v1,
    },
    product_edge::ProductEdgeResolution,
    product_edge_postgres::{
        PostgresResearchGoalOwnerV1, research_initial_pit::MarketDataInitialPitPortsV1,
    },
    rd_bounded_feature_program_postgres_v1::PostgresResearchBoundedFeatureProgramOwnerV1,
    strategy_catalog_postgres_v1::PostgresStrategyCatalogV1,
    strategy_catalog_v1::{StrategyIdentityV1, StrategyStatementV1},
};

use crate::backtest_run_v1::{
    BacktestRunErrorV1, BacktestRunOwnersV1, BacktestRunReachedReplayV1,
    BacktestRunReplayUnavailableV1, BacktestRunRequestV1, run_backtest_v1,
};
use crate::server::{authorized, hex_digest};

/// Everything the route needs, parallel to [`BacktestRunOwnersV1`] but with the Market-Data-
/// sourced pieces `Option`, matching the rest of this crate's convention of answering
/// `SERVICE_UNAVAILABLE` by name rather than refusing to start when a deployment configures a
/// subset of Market Data's ports.
#[derive(Clone)]
pub(crate) struct BacktestRunRoutesApiState {
    pub(crate) catalog: Arc<PostgresStrategyCatalogV1>,
    pub(crate) registry: Arc<PostgresBacktestRunRegistryV1>,
    pub(crate) product_edge: Arc<ProductEdgePostgresOwnerV1>,
    pub(crate) research: Arc<PostgresResearchGoalOwnerV1>,
    pub(crate) bounded_feature_program: Arc<PostgresResearchBoundedFeatureProgramOwnerV1>,
    pub(crate) strategy_input_bindings: Option<Arc<dyn StrategyInputBindingAdmissionV1>>,
    pub(crate) market_data_universe_selection: Option<Arc<dyn UniverseSelectionAdmissionV1>>,
    pub(crate) market_data_pit_intake: Option<Arc<dyn PitMarketSnapshotIntakeV1>>,
    pub(crate) market_semantics: Option<Arc<dyn MarketSemanticsAdmissionV1>>,
    pub(crate) custody_frames: Option<Arc<dyn PitWindowCustodyFramesV1>>,
    #[cfg(feature = "composer-v3-replay")]
    pub(crate) develop_composer: Option<Arc<PostgresSourceResearchComposerProductionV2>>,
    #[cfg(feature = "composer-v3-replay")]
    pub(crate) instrument_master_v2: Option<Arc<InstrumentMasterV2PostgresOwner>>,
    #[cfg(feature = "composer-v3-replay")]
    pub(crate) instrument_economic_terms: Option<Arc<InstrumentEconomicTermsPostgresOwnerV1>>,
    #[cfg(all(feature = "composer-v3-replay", feature = "native-replay-execution"))]
    pub(crate) native_replay_execution:
        Option<Arc<crate::exploratory_replay::NativeReplayExecutionServiceV2>>,
    pub(crate) rd_pool: PgPool,
    pub(crate) request_proof_digest: String,
    pub(crate) token_digest: [u8; 32],
}

pub(crate) fn router(state: BacktestRunRoutesApiState) -> Router {
    Router::new()
        .route(
            "/v1/backtests",
            post(submit_backtest_run).get(list_backtest_runs),
        )
        .route("/v1/backtests/{run_id}", get(get_backtest_run))
        .route(
            "/v1/backtests/{run_id}/report",
            get(get_backtest_run_report),
        )
        .with_state(state)
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct BacktestRunRequestBodyV1 {
    run_id: String,
    strategy_id: String,
    instrument: String,
    execution_timeframe: String,
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum BacktestRunReplayStateV1 {
    CustodyFramesNotAvailable,
    CustodyFramesRefused,
    #[cfg(not(feature = "composer-v3-replay"))]
    FramesResolvedNoConsumerYet,
    #[cfg(feature = "composer-v3-replay")]
    ComposerNotAvailable,
    #[cfg(feature = "composer-v3-replay")]
    ComposerBuildUnavailable,
    #[cfg(feature = "composer-v3-replay")]
    ComposerBuildRefused,
    #[cfg(feature = "composer-v3-replay")]
    ComposerArtifactLocatorUnavailable,
    #[cfg(feature = "composer-v3-replay")]
    TrialFamilyUnavailable,
    #[cfg(feature = "composer-v3-replay")]
    ReplayAdmissionFailed,
    #[cfg(feature = "composer-v3-replay")]
    ReplayCommitFailed,
    #[cfg(feature = "composer-v3-replay")]
    ReplayCommitted,
    #[cfg(feature = "composer-v3-replay")]
    CustodyIssuanceFailed,
    #[cfg(all(feature = "composer-v3-replay", feature = "native-replay-execution"))]
    ReplayExecutionUnavailable,
    #[cfg(all(feature = "composer-v3-replay", feature = "native-replay-execution"))]
    ReplayExecutionFailed,
}

#[derive(Debug, Serialize)]
struct BacktestRunReachedReplayBodyV1 {
    schema_version: u16,
    research_request_identity: String,
    design_identity: String,
    joint_freeze_digest: String,
    replay_state: BacktestRunReplayStateV1,
    replay_detail: Option<String>,
    /// Whether H8 custody issuance succeeded for this run - report assembly's signal to re-read
    /// this run's bars at the pinned head.
    #[cfg(feature = "composer-v3-replay")]
    custody_binding_issued: bool,
    /// The committed Backtest Result's own exact locator, once this run's committed Replay has
    /// actually executed - a report reads bars and fills back from exactly this triple, never a
    /// `run_id`-derived guess: the Result is counted under the Replay REQUEST's own identity
    /// (`{run_id}-replay`), not the Research request's (`backtest-run:{run_id}`). `None` until
    /// execution commits, including while `custody_binding_issued` is already `true`.
    #[cfg(feature = "composer-v3-replay")]
    replay_result_locator: Option<crate::backtest_run_v1::BacktestReplayResultLocatorV1>,
}

fn reached_replay_body(reached: &BacktestRunReachedReplayV1) -> BacktestRunReachedReplayBodyV1 {
    let (replay_state, replay_detail) = match &reached.reason {
        BacktestRunReplayUnavailableV1::CustodyFramesNotAvailable => {
            (BacktestRunReplayStateV1::CustodyFramesNotAvailable, None)
        }
        BacktestRunReplayUnavailableV1::CustodyFramesRefused(refusal) => (
            BacktestRunReplayStateV1::CustodyFramesRefused,
            Some(refusal.to_string()),
        ),
        #[cfg(not(feature = "composer-v3-replay"))]
        BacktestRunReplayUnavailableV1::FramesResolvedNoConsumerYet(frames) => (
            BacktestRunReplayStateV1::FramesResolvedNoConsumerYet,
            Some(format!("{} frame(s)", frames.frames().len())),
        ),
        #[cfg(feature = "composer-v3-replay")]
        BacktestRunReplayUnavailableV1::ComposerNotAvailable => {
            (BacktestRunReplayStateV1::ComposerNotAvailable, None)
        }
        #[cfg(feature = "composer-v3-replay")]
        BacktestRunReplayUnavailableV1::ComposerBuildUnavailable(detail) => (
            BacktestRunReplayStateV1::ComposerBuildUnavailable,
            Some(detail.clone()),
        ),
        #[cfg(feature = "composer-v3-replay")]
        BacktestRunReplayUnavailableV1::ComposerBuildRefused(disposition) => (
            BacktestRunReplayStateV1::ComposerBuildRefused,
            Some(format!("{disposition:?}")),
        ),
        #[cfg(feature = "composer-v3-replay")]
        BacktestRunReplayUnavailableV1::ComposerArtifactLocatorUnavailable(detail) => (
            BacktestRunReplayStateV1::ComposerArtifactLocatorUnavailable,
            Some(detail.clone()),
        ),
        #[cfg(feature = "composer-v3-replay")]
        BacktestRunReplayUnavailableV1::TrialFamilyUnavailable => {
            (BacktestRunReplayStateV1::TrialFamilyUnavailable, None)
        }
        #[cfg(feature = "composer-v3-replay")]
        BacktestRunReplayUnavailableV1::ReplayAdmissionFailed(e) => (
            BacktestRunReplayStateV1::ReplayAdmissionFailed,
            Some(e.to_string()),
        ),
        #[cfg(feature = "composer-v3-replay")]
        BacktestRunReplayUnavailableV1::ReplayCommitFailed(e) => (
            BacktestRunReplayStateV1::ReplayCommitFailed,
            Some(e.to_string()),
        ),
        #[cfg(feature = "composer-v3-replay")]
        BacktestRunReplayUnavailableV1::ReplayCommitted(result) => (
            BacktestRunReplayStateV1::ReplayCommitted,
            Some(format!("{:?}", result.locator())),
        ),
        #[cfg(feature = "composer-v3-replay")]
        BacktestRunReplayUnavailableV1::CustodyIssuanceFailed(e) => (
            BacktestRunReplayStateV1::CustodyIssuanceFailed,
            Some(e.to_string()),
        ),
        #[cfg(all(feature = "composer-v3-replay", feature = "native-replay-execution"))]
        BacktestRunReplayUnavailableV1::ReplayExecutionUnavailable(result) => (
            BacktestRunReplayStateV1::ReplayExecutionUnavailable,
            Some(format!("{:?}", result.locator())),
        ),
        #[cfg(all(feature = "composer-v3-replay", feature = "native-replay-execution"))]
        BacktestRunReplayUnavailableV1::ReplayExecutionFailed(result, cause) => (
            BacktestRunReplayStateV1::ReplayExecutionFailed,
            Some(format!("{:?}: {cause}", result.locator())),
        ),
    };
    BacktestRunReachedReplayBodyV1 {
        schema_version: 1,
        research_request_identity: reached.research_request_identity.clone(),
        design_identity: format!("sha256:{}", hex_digest(reached.design_identity.as_bytes())),
        joint_freeze_digest: reached.freeze.joint_freeze_digest.clone(),
        replay_state,
        replay_detail,
        #[cfg(feature = "composer-v3-replay")]
        custody_binding_issued: reached.custody_binding.is_some(),
        #[cfg(feature = "composer-v3-replay")]
        replay_result_locator: reached.replay_result_locator.clone(),
    }
}

async fn submit_backtest_run(
    State(state): State<BacktestRunRoutesApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return backtest_run_rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }
    let request: BacktestRunRequestBodyV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return backtest_run_rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let run_id = request.run_id.clone();
    // The request as this route reads it, in one spelling, so a resubmission is recognised by
    // value rather than by the caller's whitespace or key order.
    let request_bytes = serde_json::to_vec(&request).expect("a parsed request serialises");

    match state.registry.get(&run_id).await {
        Ok(Some(recorded)) if recorded.request_bytes == request_bytes => {
            return recorded_answer(&recorded);
        }
        Ok(Some(_)) => {
            return backtest_run_rejection(StatusCode::CONFLICT, "RUN_ID_CONFLICT", &run_id);
        }
        Ok(None) => {}
        Err(e) => return registry_error_response(&e, &run_id),
    }
    let Some(strategy_id) = StrategyIdentityV1::parse(&request.strategy_id) else {
        return backtest_run_rejection(StatusCode::BAD_REQUEST, "STRATEGY_ID_INVALID", &run_id);
    };
    let dataset_ref = match BacktestRunDatasetRefV1::new(
        request.instrument,
        request.execution_timeframe,
        request.window_start_ns,
        request.window_end_ns_exclusive,
    ) {
        Ok(dataset_ref) => dataset_ref,
        Err(_) => {
            return backtest_run_rejection(StatusCode::BAD_REQUEST, "DATASET_REF_INVALID", &run_id);
        }
    };
    let (
        Some(strategy_input_bindings),
        Some(universe_selection),
        Some(pit_intake),
        Some(market_semantics),
    ) = (
        state.strategy_input_bindings.clone(),
        state.market_data_universe_selection.clone(),
        state.market_data_pit_intake.clone(),
        state.market_semantics.clone(),
    )
    else {
        return backtest_run_rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "BACKTEST_RUN_MARKET_DATA_UNAVAILABLE",
            &run_id,
        );
    };

    let registry = state.registry;
    let owners = BacktestRunOwnersV1 {
        catalog: state.catalog,
        product_edge: state.product_edge,
        research: state.research,
        bounded_feature_program: state.bounded_feature_program,
        strategy_input_bindings,
        market_data_initial_pit: MarketDataInitialPitPortsV1::new(universe_selection, pit_intake),
        market_semantics,
        rd_pool: state.rd_pool,
        custody_frames: state.custody_frames,
        #[cfg(feature = "composer-v3-replay")]
        develop_composer: state.develop_composer,
        #[cfg(feature = "composer-v3-replay")]
        instrument_master_v2: state.instrument_master_v2,
        #[cfg(feature = "composer-v3-replay")]
        instrument_economic_terms: state.instrument_economic_terms,
        #[cfg(all(feature = "composer-v3-replay", feature = "native-replay-execution"))]
        native_replay_execution: state.native_replay_execution,
    };
    let backtest_request = BacktestRunRequestV1 {
        run_id: run_id.clone(),
        strategy_id,
        dataset_ref,
        request_proof_digest: state.request_proof_digest,
    };

    match run_backtest_v1(&owners, backtest_request).await {
        Ok(reached) => {
            let answer =
                serde_json::to_vec(&reached_replay_body(&reached)).expect("an answer serialises");
            match registry.record(&run_id, &request_bytes, &answer).await {
                Ok(recorded) => recorded_answer(&recorded),
                Err(e) => registry_error_response(&e, &run_id),
            }
        }
        Err(e) => backtest_run_error_response(&e, &run_id),
    }
}

/// A recorded run's answer, exactly as it was first given.
fn recorded_answer(recorded: &BacktestRunRecordV1) -> Response {
    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        recorded.answer_bytes.clone(),
    )
        .into_response()
}

fn registry_error_response(error: &BacktestRunRegistryErrorV1, run_id: &str) -> Response {
    match error {
        BacktestRunRegistryErrorV1::RunIdConflict => {
            backtest_run_rejection(StatusCode::CONFLICT, "RUN_ID_CONFLICT", run_id)
        }
        BacktestRunRegistryErrorV1::Storage(detail) => {
            tracing::warn!(%detail, %run_id, "the backtest run registry is unavailable");
            backtest_run_rejection(
                StatusCode::SERVICE_UNAVAILABLE,
                "BACKTEST_RUN_REGISTRY_UNAVAILABLE",
                run_id,
            )
        }
    }
}

/// One recorded run on the wire: its request and its answer as the registry holds them.
#[derive(Debug, Serialize)]
struct BacktestRunViewV1 {
    run_id: String,
    request: Box<RawValue>,
    answer: Box<RawValue>,
    recorded_at_epoch_ms: u64,
}

#[derive(Debug, Serialize)]
struct BacktestRunListV1 {
    runs: Vec<BacktestRunViewV1>,
}

fn run_view(
    recorded: BacktestRunRecordV1,
) -> Result<BacktestRunViewV1, BacktestRunRegistryErrorV1> {
    let raw = |bytes: Vec<u8>| {
        String::from_utf8(bytes)
            .ok()
            .and_then(|text| RawValue::from_string(text).ok())
            .ok_or_else(|| BacktestRunRegistryErrorV1::Storage("a recorded run is not JSON".into()))
    };
    Ok(BacktestRunViewV1 {
        run_id: recorded.run_id,
        request: raw(recorded.request_bytes)?,
        answer: raw(recorded.answer_bytes)?,
        recorded_at_epoch_ms: recorded.recorded_at_epoch_ms,
    })
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BacktestRunListQueryV1 {
    limit: Option<u32>,
}

/// The page of runs one list returns when the caller names none.
const DEFAULT_BACKTEST_RUN_LIST_V1: u32 = 100;

async fn list_backtest_runs(
    State(state): State<BacktestRunRoutesApiState>,
    headers: HeaderMap,
    query: Result<Query<BacktestRunListQueryV1>, axum::extract::rejection::QueryRejection>,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return backtest_run_rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }
    let Ok(Query(query)) = query else {
        return backtest_run_rejection(
            StatusCode::BAD_REQUEST,
            "MALFORMED_TYPED_REQUEST",
            "unbound",
        );
    };
    let limit = query.limit.unwrap_or(DEFAULT_BACKTEST_RUN_LIST_V1);

    if limit == 0 || limit > MAX_BACKTEST_RUN_LIST_V1 {
        return backtest_run_rejection(
            StatusCode::BAD_REQUEST,
            "BACKTEST_RUN_LIST_LIMIT_OUT_OF_RANGE",
            "unbound",
        );
    }
    let runs = match state.registry.list(limit).await {
        Ok(runs) => runs,
        Err(e) => return registry_error_response(&e, "unbound"),
    };

    match runs
        .into_iter()
        .map(run_view)
        .collect::<Result<Vec<_>, _>>()
    {
        Ok(runs) => (StatusCode::OK, Json(BacktestRunListV1 { runs })).into_response(),
        Err(e) => registry_error_response(&e, "unbound"),
    }
}

async fn get_backtest_run(
    State(state): State<BacktestRunRoutesApiState>,
    Path(run_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return backtest_run_rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }

    match state.registry.get(&run_id).await {
        Ok(Some(recorded)) => match run_view(recorded) {
            Ok(view) => (StatusCode::OK, Json(view)).into_response(),
            Err(e) => registry_error_response(&e, &run_id),
        },
        Ok(None) => backtest_run_rejection(StatusCode::NOT_FOUND, "RUN_UNKNOWN", &run_id),
        Err(e) => registry_error_response(&e, &run_id),
    }
}

/// A run's report: the four-question report of the Result the run committed, stating the strategy
/// its registry row names.
///
/// A recorded run that committed no Result answers `RUN_HAS_NO_RESULT` with the replay state it
/// stopped at. The report reads the Result back through the Backtest Owner's own readback, keyed by
/// the run's Result, its Replay request (`{run_id}-replay`) and its one attempt
/// (`{run_id}-attempt-1`), all three named by `backtest.run` itself.
async fn get_backtest_run_report(
    State(state): State<BacktestRunRoutesApiState>,
    Path(run_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return backtest_run_rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }
    let recorded = match state.registry.get(&run_id).await {
        Ok(Some(recorded)) => recorded,
        Ok(None) => return backtest_run_rejection(StatusCode::NOT_FOUND, "RUN_UNKNOWN", &run_id),
        Err(e) => return registry_error_response(&e, &run_id),
    };
    let answer = serde_json::from_slice::<serde_json::Value>(&recorded.answer_bytes)
        .unwrap_or(serde_json::Value::Null);
    let Some(result_identity) = answer
        .get("replay_result_identity")
        .and_then(serde_json::Value::as_str)
    else {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "request_identity": run_id,
                "code": "RUN_HAS_NO_RESULT",
                "replay_state": answer.get("replay_state").cloned().unwrap_or(serde_json::Value::Null),
            })),
        )
            .into_response();
    };

    // The registry wrote the request it was submitted with; a row whose request does not name a
    // strategy is not one this route recorded.
    let Some(strategy_id) =
        serde_json::from_slice::<BacktestRunRequestBodyV1>(&recorded.request_bytes)
            .ok()
            .and_then(|request| StrategyIdentityV1::parse(&request.strategy_id))
    else {
        return backtest_run_rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "BACKTEST_RUN_RECORD_UNREADABLE",
            &run_id,
        );
    };
    let statement = match state.catalog.get(strategy_id).await {
        Ok(Some(record)) => match serde_json::from_slice::<StrategyStatementV1>(&record.spec_bytes)
        {
            Ok(statement) => statement,
            Err(_) => {
                return backtest_run_rejection(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "STRATEGY_SPEC_UNDECODABLE",
                    &run_id,
                );
            }
        },
        Ok(None) => {
            return backtest_run_rejection(
                StatusCode::SERVICE_UNAVAILABLE,
                "STRATEGY_UNKNOWN",
                &run_id,
            );
        }
        Err(_) => {
            return backtest_run_rejection(
                StatusCode::SERVICE_UNAVAILABLE,
                "CATALOG_UNAVAILABLE",
                &run_id,
            );
        }
    };
    let request_identity = format!("{run_id}-replay");
    let attempt_identity = format!("{run_id}-attempt-1");
    let locator = ExploratoryReplayResultLocatorV2 {
        result_identity,
        request_identity: &request_identity,
        attempt_identity: &attempt_identity,
    };

    match resolve_backtest_run_report_for_statement_v1(
        &state.rd_pool,
        locator,
        Some(BacktestRunCatalogStatementV1 {
            strategy_id,
            statement: &statement,
        }),
    )
    .await
    {
        Ok(Some(report)) => (StatusCode::OK, Json(report)).into_response(),
        Ok(None) => backtest_run_rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "BACKTEST_RUN_RESULT_ABSENT",
            &run_id,
        ),
        Err(refusal) => {
            tracing::warn!(request_identity = %run_id, code = refusal.code(), detail = %refusal, "backtest.run report refused");
            let status = if refusal.is_owner_judgement() {
                StatusCode::CONFLICT
            } else {
                StatusCode::SERVICE_UNAVAILABLE
            };
            backtest_run_rejection(status, refusal.code(), &run_id)
        }
    }
}

fn backtest_run_error_response(error: &BacktestRunErrorV1, request_identity: &str) -> Response {
    let (status, code, detail): (_, _, String) = match error {
        BacktestRunErrorV1::ExecutionTimeframeUndeclared => (
            StatusCode::BAD_REQUEST,
            "DATASET_REF_INVALID",
            String::new(),
        ),
        BacktestRunErrorV1::CustodyCoverageRefused(refusal) => match refusal {
            PitWindowCoverageRefusalV1::InvalidRequest => (
                StatusCode::BAD_REQUEST,
                "PIT_WINDOW_COVERAGE_REQUEST_INVALID",
                String::new(),
            ),
            PitWindowCoverageRefusalV1::CustodyNotFound => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "PIT_WINDOW_CUSTODY_NOT_FOUND",
                String::new(),
            ),
            PitWindowCoverageRefusalV1::WindowNotCovered { missing } => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "PIT_WINDOW_NOT_COVERED",
                format!("missing {missing:?}"),
            ),
            PitWindowCoverageRefusalV1::CoveredOnlyAcrossChains => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "PIT_WINDOW_COVERED_ONLY_ACROSS_CHAINS",
                String::new(),
            ),
            PitWindowCoverageRefusalV1::StoreUnavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                "BACKTEST_RUN_MARKET_DATA_UNAVAILABLE",
                String::new(),
            ),
        },
        BacktestRunErrorV1::StrategyUnknown => {
            (StatusCode::NOT_FOUND, "STRATEGY_UNKNOWN", String::new())
        }
        BacktestRunErrorV1::StrategyArchived => {
            (StatusCode::CONFLICT, "STRATEGY_ARCHIVED", String::new())
        }
        BacktestRunErrorV1::AuthoringFailed(e) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "STRATEGY_STATEMENT_DOES_NOT_AUTHOR",
            e.to_string(),
        ),
        BacktestRunErrorV1::CatalogUnavailable(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "CATALOG_UNAVAILABLE",
            e.to_string(),
        ),
        BacktestRunErrorV1::StrategySpecUndecodable(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "STRATEGY_SPEC_UNDECODABLE",
            e.to_string(),
        ),
        BacktestRunErrorV1::AdmissionPreflightUnavailable(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "ADMISSION_PREFLIGHT_UNAVAILABLE",
            e.to_string(),
        ),
        BacktestRunErrorV1::AdmissionFailed(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "ADMISSION_FAILED",
            e.to_string(),
        ),
        BacktestRunErrorV1::AdmissionLegacyQuarantined => (
            StatusCode::SERVICE_UNAVAILABLE,
            "ADMISSION_LEGACY_QUARANTINED",
            String::new(),
        ),
        BacktestRunErrorV1::GoalSubmissionFailed(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "GOAL_SUBMISSION_FAILED",
            e.to_string(),
        ),
        BacktestRunErrorV1::GoalNotAccepted(resolution) => (
            goal_not_accepted_status(*resolution),
            "GOAL_NOT_ACCEPTED",
            format!("{resolution:?}"),
        ),
        BacktestRunErrorV1::InitialPitFailed(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "INITIAL_PIT_FAILED",
            e.to_string(),
        ),
        BacktestRunErrorV1::InitialPitNotAvailable(state) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "INITIAL_PIT_NOT_AVAILABLE",
            format!("{state:?}"),
        ),
        BacktestRunErrorV1::PitTerminalUnreadable(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "PIT_TERMINAL_UNREADABLE",
            e.clone(),
        ),
        BacktestRunErrorV1::PitTerminalNotCommitted => (
            StatusCode::SERVICE_UNAVAILABLE,
            "PIT_TERMINAL_NOT_COMMITTED",
            String::new(),
        ),
        BacktestRunErrorV1::PitSnapshotNotLocatable => (
            StatusCode::SERVICE_UNAVAILABLE,
            "PIT_SNAPSHOT_NOT_LOCATABLE",
            String::new(),
        ),
        BacktestRunErrorV1::MarketSemanticsScopeUnavailable(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_SEMANTICS_SCOPE_UNAVAILABLE",
            e.clone(),
        ),
        BacktestRunErrorV1::MarketSemanticsAdmissionFailed(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_SEMANTICS_ADMISSION_FAILED",
            format!("{e:?}"),
        ),
        BacktestRunErrorV1::AuthoringFactsUnavailable(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "AUTHORING_FACTS_UNAVAILABLE",
            e.to_string(),
        ),
        BacktestRunErrorV1::RoleIntentPublicationFailed(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "ROLE_INTENT_PUBLICATION_FAILED",
            e.to_string(),
        ),
        BacktestRunErrorV1::StrategyInputBindingFailed(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "STRATEGY_INPUT_BINDING_FAILED",
            format!("{e:?}"),
        ),
        BacktestRunErrorV1::FreezeFailed(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "FREEZE_FAILED",
            e.to_string(),
        ),
    };
    tracing::warn!(%detail, %request_identity, code, "backtest.run did not reach the replay step");
    backtest_run_rejection(status, code, request_identity)
}

/// `Rejected*` outcomes answer as a true conflict (the request was decided, not merely unknown);
/// every other resolution this variant carries - submitted-or-unknown, an identity conflict, a
/// legacy-quarantined terminal - answers unavailable, matching how this crate answers every other
/// not-yet-resolved Research outcome.
const fn goal_not_accepted_status(resolution: ProductEdgeResolution) -> StatusCode {
    match resolution {
        ProductEdgeResolution::RejectedNoWrite => StatusCode::CONFLICT,
        ProductEdgeResolution::Accepted
        | ProductEdgeResolution::SubmittedOrUnknown
        | ProductEdgeResolution::IdentityConflict
        | ProductEdgeResolution::LegacyTerminalQuarantined => StatusCode::SERVICE_UNAVAILABLE,
    }
}

fn backtest_run_rejection(
    status: StatusCode,
    code: &'static str,
    request_identity: &str,
) -> Response {
    (
        status,
        Json(serde_json::json!({
            "request_identity": request_identity,
            "code": code,
        })),
    )
        .into_response()
}
