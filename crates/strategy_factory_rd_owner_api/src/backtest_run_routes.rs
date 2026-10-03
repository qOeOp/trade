//! `POST /v1/backtests`: submit a `backtest.run` request and run its orchestration to wherever
//! it currently stops.
//!
//! No `GET` status/report/list routes yet. A `GET` that re-ran the whole orchestration to answer
//! "where does this stand" would need the original request's dataset_ref and custody claim again
//! (the orchestration is not identity-only), and a `list` needs a registry nothing writes to yet.
//! Building either now - before any run can ever reach a Result, since nothing implements the
//! T0-5 custody-frames resolver - would be exactly the structure-with-no-driver gap this
//! repository's own documentation warns against. Both are the next slice's to design once T0-5
//! and T1 land and a run can produce something worth reading back.

use std::sync::Arc;

use axum::{
    Json, Router,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use vibe_data::owner::{
    market_semantics_admission_v1::MarketSemanticsAdmissionV1,
    pit_market_snapshot_intake_v1::PitMarketSnapshotIntakeV1,
    pit_window_custody_v1::UntrustedPitWindowCustodyClaimV1, source_binding::BindingDigest,
    strategy_input_binding_admission_v1::StrategyInputBindingAdmissionV1,
    universe_selection_admission_v1::UniverseSelectionAdmissionV1,
};
use vibe_product_edge::ProductEdgePostgresOwnerV1;
use vibe_strategy_factory::{
    backtest_run_dataset_ref_v1::BacktestRunDatasetRefV1,
    product_edge::ProductEdgeResolution,
    product_edge_postgres::{
        PostgresResearchGoalOwnerV1, research_initial_pit::MarketDataInitialPitPortsV1,
    },
    rd_bounded_feature_program_postgres_v1::PostgresResearchBoundedFeatureProgramOwnerV1,
    strategy_catalog_postgres_v1::PostgresStrategyCatalogV1,
    strategy_catalog_v1::StrategyIdentityV1,
};

use super::{authorized, hex_digest};
use crate::backtest_run_v1::{
    BacktestRunErrorV1, BacktestRunOwnersV1, BacktestRunReachedReplayV1,
    BacktestRunReplayUnavailableV1, BacktestRunRequestV1, run_backtest_v1,
};

/// Everything the route needs, parallel to [`BacktestRunOwnersV1`] but with the Market-Data-
/// sourced pieces `Option`, matching the rest of this crate's convention of answering
/// `SERVICE_UNAVAILABLE` by name rather than refusing to start when a deployment configures a
/// subset of Market Data's ports.
#[derive(Clone)]
pub(crate) struct BacktestRunRoutesApiState {
    pub(crate) catalog: Arc<PostgresStrategyCatalogV1>,
    pub(crate) product_edge: Arc<ProductEdgePostgresOwnerV1>,
    pub(crate) research: Arc<PostgresResearchGoalOwnerV1>,
    pub(crate) bounded_feature_program: Arc<PostgresResearchBoundedFeatureProgramOwnerV1>,
    pub(crate) strategy_input_bindings: Option<Arc<dyn StrategyInputBindingAdmissionV1>>,
    pub(crate) market_data_universe_selection: Option<Arc<dyn UniverseSelectionAdmissionV1>>,
    pub(crate) market_data_pit_intake: Option<Arc<dyn PitMarketSnapshotIntakeV1>>,
    pub(crate) market_semantics: Option<Arc<dyn MarketSemanticsAdmissionV1>>,
    pub(crate) rd_pool: PgPool,
    pub(crate) request_proof_digest: String,
    pub(crate) token_digest: [u8; 32],
}

pub(crate) fn router(state: BacktestRunRoutesApiState) -> Router {
    Router::new()
        .route("/v1/backtests", post(submit_backtest_run))
        .with_state(state)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BacktestRunRequestBodyV1 {
    run_id: String,
    strategy_id: String,
    instrument: String,
    execution_timeframe: String,
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
    /// The custody chain this run's window is read from. Inert today: nothing implements Market
    /// Data's T0-5 derived view, so the orchestration never validates this claim - it stops at
    /// `CUSTODY_FRAMES_NOT_AVAILABLE` before reaching it. Required anyway, so a caller's request
    /// shape does not need to change once T0-5 lands and the claim starts mattering.
    custody_chain_root: BindingDigest,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum BacktestRunReplayStateV1 {
    CustodyFramesNotAvailable,
    CustodyFramesRefused,
    FramesResolvedNoConsumerYet,
}

#[derive(Debug, Serialize)]
struct BacktestRunReachedReplayBodyV1 {
    schema_version: u16,
    research_request_identity: String,
    design_identity: String,
    joint_freeze_digest: String,
    replay_state: BacktestRunReplayStateV1,
    replay_detail: Option<String>,
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
        BacktestRunReplayUnavailableV1::FramesResolvedNoConsumerYet(frames) => (
            BacktestRunReplayStateV1::FramesResolvedNoConsumerYet,
            Some(format!("{} frame(s)", frames.frames().len())),
        ),
    };
    BacktestRunReachedReplayBodyV1 {
        schema_version: 1,
        research_request_identity: reached.research_request_identity.clone(),
        design_identity: format!("sha256:{}", hex_digest(reached.design_identity.as_bytes())),
        joint_freeze_digest: reached.freeze.joint_freeze_digest.clone(),
        replay_state,
        replay_detail,
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

    let owners = BacktestRunOwnersV1 {
        catalog: state.catalog,
        product_edge: state.product_edge,
        research: state.research,
        bounded_feature_program: state.bounded_feature_program,
        strategy_input_bindings,
        market_data_initial_pit: MarketDataInitialPitPortsV1::new(universe_selection, pit_intake),
        market_semantics,
        rd_pool: state.rd_pool,
        // Nothing implements Market Data's T0-5 derived view yet; see this module's own doc.
        custody_frames: None,
    };
    let backtest_request = BacktestRunRequestV1 {
        run_id: run_id.clone(),
        strategy_id,
        dataset_ref,
        custody: UntrustedPitWindowCustodyClaimV1 {
            chain_root: request.custody_chain_root,
        },
        request_proof_digest: state.request_proof_digest,
    };

    match run_backtest_v1(&owners, backtest_request).await {
        Ok(reached) => (StatusCode::OK, Json(reached_replay_body(&reached))).into_response(),
        Err(e) => backtest_run_error_response(&e, &run_id),
    }
}

fn backtest_run_error_response(error: &BacktestRunErrorV1, request_identity: &str) -> Response {
    let (status, code, detail): (_, _, String) = match error {
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
