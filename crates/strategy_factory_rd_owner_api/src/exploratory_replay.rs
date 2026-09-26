use std::sync::Arc;

use axum::{
    Json, Router,
    body::Bytes,
    extract::{Path, Query, State, rejection::QueryRejection},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
#[cfg(feature = "sealed-develop-composer-acceptance")]
use vibe_backtest_owner::{
    native_replay::{
        NativeReplayCommitDispositionV2, PostgresNativeReplayPreparationOwnerV2,
        run_exploratory_replay_v2,
    },
    postgres::PostgresReplayResultOwnerV2,
};
use vibe_backtest_owner_contracts::{
    CanonicalDigestV2, OpaqueIdentityV2, ReplayNamespaceV2, ReplayRequestDtoV2, ReplayRequestV2,
};
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use vibe_data::owner::source_binding::BindingDigest;
#[cfg(feature = "sealed-develop-composer-acceptance")]
use vibe_data::owner::{
    instrument_economic_terms_postgres_v1::InstrumentEconomicTermsPostgresOwnerV1,
    instrument_master_v2_postgres::InstrumentMasterV2PostgresOwner,
    native_replay_scheduling_v1::NativeReplaySchedulingResolverV1,
};
use vibe_product_edge::{ProductEdgeAdmissionRequestV1, ProductEdgeError};
#[cfg(any(test, feature = "sealed-develop-composer-acceptance"))]
use vibe_strategy_factory::NativeReplayExecutionInputBindingErrorV1;
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use vibe_strategy_factory::exploratory_replay::{
    ComposerBackedExploratoryReplayProposalV3, EXPLORATORY_REPLAY_MUTATION_EFFECT_V3,
    EXPLORATORY_REPLAY_OPERATION_V3, EXPLORATORY_REPLAY_SCHEMA_V3,
};
#[cfg(test)]
use vibe_strategy_factory::exploratory_replay::{
    ExploratoryReplayAvailabilityV1, ExploratoryReplayNextLegalActionV1,
};
use vibe_strategy_factory::{
    ExploratoryReplayResultLocatorV2, MarketDataRepairResolutionLocatorV1,
    exploratory_replay::{
        EXPLORATORY_REPLAY_MUTATION_EFFECT_V2, EXPLORATORY_REPLAY_OPERATION_V2,
        EXPLORATORY_REPLAY_SCHEMA_V2, ExploratoryReplayCommitResultV2, ExploratoryReplayOwnerError,
        ExploratoryReplayRecoverySelectorV2, ExploratoryReplayRequestLocatorV2,
        ExploratoryReplayRequestProjectionV1, ExploratoryReplayRequestProposalV2,
        ExploratoryReplaySealedReadPortV2,
    },
    iteration_decision::is_valid_iteration_decision_locator_v1,
    product_edge::{
        RESEARCH_OWNER_V1, ResearchExploratoryDiagnosisGateErrorV1,
        ResearchExploratoryDiagnosisGateProjectionV1, ResearchExploratoryDiagnosisLocatorV1,
        ResearchExploratoryRunEvidenceProjectionV1,
    },
    product_edge_postgres::PostgresResearchGoalOwnerV1,
};
#[cfg(feature = "sealed-develop-composer-acceptance")]
use vibe_strategy_factory::{
    develop_composer_postgres_v2::DevelopComposerSealedReadPortV2,
    native_replay_execution_preparation_resolver_v2::PostgresNativeReplayExecutionPreparationResolverV2,
};

use super::{ApiState, authorized, hex_digest, insert_rejection_code};

#[derive(Clone)]
struct ExploratoryReplayResultApiState {
    owner: Arc<PostgresResearchGoalOwnerV1>,
    token_digest: [u8; 32],
}

#[async_trait::async_trait]
trait ExploratoryDiagnosisGateReadPort: Send + Sync {
    async fn resolve_diagnosis_gate(
        &self,
        locator: ResearchExploratoryDiagnosisLocatorV1,
    ) -> Result<ResearchExploratoryDiagnosisGateProjectionV1, ResearchExploratoryDiagnosisGateErrorV1>;
}

#[async_trait::async_trait]
impl ExploratoryDiagnosisGateReadPort for PostgresResearchGoalOwnerV1 {
    async fn resolve_diagnosis_gate(
        &self,
        locator: ResearchExploratoryDiagnosisLocatorV1,
    ) -> Result<ResearchExploratoryDiagnosisGateProjectionV1, ResearchExploratoryDiagnosisGateErrorV1>
    {
        self.resolve_exploratory_diagnosis_gate_v1(locator).await
    }
}

#[derive(Clone)]
struct ExploratoryDiagnosisGateApiState {
    owner: Arc<dyn ExploratoryDiagnosisGateReadPort>,
    token_digest: [u8; 32],
}

#[async_trait::async_trait]
trait MarketDataRepairedReplayActionPort: Send + Sync {
    async fn commit_repaired_replay(
        &self,
        predecessor: &ExploratoryReplayRequestLocatorV2,
        resolution: &MarketDataRepairResolutionLocatorV1,
    ) -> Result<MarketDataRepairedReplayActionResponseV1, ExploratoryReplayOwnerError>;
}

#[async_trait::async_trait]
impl MarketDataRepairedReplayActionPort for PostgresResearchGoalOwnerV1 {
    async fn commit_repaired_replay(
        &self,
        predecessor: &ExploratoryReplayRequestLocatorV2,
        resolution: &MarketDataRepairResolutionLocatorV1,
    ) -> Result<MarketDataRepairedReplayActionResponseV1, ExploratoryReplayOwnerError> {
        let result = self
            .commit_market_data_repaired_replay_request_by_locator_v2(predecessor, resolution)
            .await?;
        Ok(MarketDataRepairedReplayActionResponseV1::from_owner_result(
            result,
            predecessor.clone(),
            resolution.clone(),
        ))
    }
}

#[derive(Clone)]
struct MarketDataRepairedReplayActionApiState {
    owner: Arc<dyn MarketDataRepairedReplayActionPort>,
    token_digest: [u8; 32],
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct MarketDataRepairedReplayActionRequestV1 {
    predecessor_request_locator: ExploratoryReplayRequestLocatorV2,
    repair_resolution_locator: MarketDataRepairResolutionLocatorV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct MarketDataRepairedReplayActionResponseV1 {
    schema_version: u16,
    predecessor_request_locator: ExploratoryReplayRequestLocatorV2,
    repair_resolution_locator: MarketDataRepairResolutionLocatorV1,
    projection: ExploratoryReplayRequestProjectionV1,
    locator: ExploratoryReplayRequestLocatorV2,
    canonical_request_bytes: Vec<u8>,
}

impl MarketDataRepairedReplayActionResponseV1 {
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the move-only Owner commit result is consumed when projecting the HTTP response"
    )]
    fn from_owner_result(
        result: ExploratoryReplayCommitResultV2,
        predecessor_request_locator: ExploratoryReplayRequestLocatorV2,
        repair_resolution_locator: MarketDataRepairResolutionLocatorV1,
    ) -> Self {
        Self {
            schema_version: 1,
            predecessor_request_locator,
            repair_resolution_locator,
            projection: result.projection().clone(),
            locator: result.locator().clone(),
            canonical_request_bytes: result.canonical_request_bytes().to_vec(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExploratoryReplayResultPathV2 {
    result_identity: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExploratoryReplayResultQueryV2 {
    request_identity: String,
    attempt_identity: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExploratoryReplayDiagnosisQueryV1 {
    trial_family_identity: String,
    request_identity: String,
    attempt_identity: String,
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
pub(super) struct NativeReplayExecutionServiceV2 {
    preparation_owner: Arc<PostgresNativeReplayPreparationOwnerV2>,
    result_owner: Arc<PostgresReplayResultOwnerV2>,
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
#[derive(Clone)]
struct NativeReplayExecutionApiStateV2 {
    service: Option<Arc<NativeReplayExecutionServiceV2>>,
    token_digest: [u8; 32],
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
impl NativeReplayExecutionServiceV2 {
    #[allow(clippy::too_many_arguments)]
    pub(super) async fn connect(
        rd_database_url: &str,
        backtest_database_url: &str,
        research_owner: Arc<PostgresResearchGoalOwnerV1>,
        composer: Arc<dyn DevelopComposerSealedReadPortV2>,
        instrument_master_owner: Arc<InstrumentMasterV2PostgresOwner>,
        instrument_terms_owner: Arc<InstrumentEconomicTermsPostgresOwnerV1>,
        market_data: Arc<dyn NativeReplaySchedulingResolverV1>,
    ) -> anyhow::Result<Self> {
        let rd_relock_pool = sqlx::PgPool::connect(rd_database_url).await?;
        let backtest_pool = sqlx::PgPool::connect(backtest_database_url).await?;
        let result_owner =
            Arc::new(PostgresReplayResultOwnerV2::from_admitted_pool(backtest_pool).await?);
        let resolver = Arc::new(PostgresNativeReplayExecutionPreparationResolverV2::new(
            research_owner,
            composer,
            instrument_master_owner,
            instrument_terms_owner,
            market_data,
        ));
        let preparation_owner = Arc::new(PostgresNativeReplayPreparationOwnerV2::new(
            rd_relock_pool,
            resolver,
        ));
        Ok(Self {
            preparation_owner,
            result_owner,
        })
    }
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct NativeReplayExecutionRequestV2 {
    request_locator: ExploratoryReplayRequestLocatorV2,
    attempt_identity: OpaqueIdentityV2,
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
pub(super) fn execution_router(
    service: Option<Arc<NativeReplayExecutionServiceV2>>,
    token_digest: [u8; 32],
) -> Router {
    Router::new()
        .route("/v2/exploratory-replays", post(run_native_replay))
        .with_state(NativeReplayExecutionApiStateV2 {
            service,
            token_digest,
        })
}

pub(super) fn result_router(
    owner: Arc<PostgresResearchGoalOwnerV1>,
    token_digest: [u8; 32],
) -> Router {
    let repaired_replay_action = market_data_repaired_replay_router(owner.clone(), token_digest);
    let diagnosis = exploratory_diagnosis_gate_router(owner.clone(), token_digest);
    Router::new()
        .route(
            "/v2/exploratory-replay-results/{result_identity}",
            get(read_result),
        )
        .route(
            "/v2/exploratory-replay-results/{result_identity}/run-evidence",
            get(read_run_evidence),
        )
        .route(
            "/v2/exploratory-replay/execution-input-bindings/resolve",
            post(resolve_execution_input_binding),
        )
        .with_state(ExploratoryReplayResultApiState {
            owner,
            token_digest,
        })
        .merge(repaired_replay_action)
        .merge(diagnosis)
}

fn exploratory_diagnosis_gate_router(
    owner: Arc<dyn ExploratoryDiagnosisGateReadPort>,
    token_digest: [u8; 32],
) -> Router {
    Router::new()
        .route(
            "/v2/exploratory-replay-results/{result_identity}/diagnosis-gate",
            get(read_diagnosis_gate),
        )
        .with_state(ExploratoryDiagnosisGateApiState {
            owner,
            token_digest,
        })
}

fn market_data_repaired_replay_router(
    owner: Arc<dyn MarketDataRepairedReplayActionPort>,
    token_digest: [u8; 32],
) -> Router {
    Router::new()
        .route(
            "/v2/exploratory-replay-requests/market-data-repair-successors",
            post(commit_market_data_repaired_replay),
        )
        .with_state(MarketDataRepairedReplayActionApiState {
            owner,
            token_digest,
        })
}

async fn commit_market_data_repaired_replay(
    State(state): State<MarketDataRepairedReplayActionApiState>,
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
    let request: MarketDataRepairedReplayActionRequestV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let request_identity = request.predecessor_request_locator.request_identity.clone();
    if validate_request_locator(&request.predecessor_request_locator).is_err()
        || OpaqueIdentityV2::try_from(
            request
                .repair_resolution_locator
                .resolution_identity
                .clone(),
        )
        .is_err()
        || OpaqueIdentityV2::try_from(
            request
                .repair_resolution_locator
                .repair_request_identity
                .clone(),
        )
        .is_err()
    {
        return rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_MARKET_DATA_REPAIRED_REPLAY_LOCATORS",
            &request_identity,
        );
    }

    match state
        .owner
        .commit_repaired_replay(
            &request.predecessor_request_locator,
            &request.repair_resolution_locator,
        )
        .await
    {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => owner_error(&e, &request_identity),
    }
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
struct NativeReplayExecutionInputBindingProjectionV1 {
    schema_version: u16,
    request_identity: String,
    binding_identity: String,
    binding_digest: String,
    receipt_identity: String,
}

async fn resolve_execution_input_binding(
    State(state): State<ExploratoryReplayResultApiState>,
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
    let locator: ExploratoryReplayRequestLocatorV2 = match serde_json::from_slice(&body) {
        Ok(locator) => locator,
        Err(_) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "INVALID_EXPLORATORY_REPLAY_REQUEST_LOCATOR",
                "unbound",
            );
        }
    };
    let request_identity = locator.request_identity.clone();
    if OpaqueIdentityV2::try_from(locator.request_identity.clone()).is_err()
        || CanonicalDigestV2::try_from(locator.meaning_digest.clone()).is_err()
        || OpaqueIdentityV2::try_from(locator.receipt_identity.clone()).is_err()
        || CanonicalDigestV2::try_from(locator.seal_digest.clone()).is_err()
    {
        return rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_EXPLORATORY_REPLAY_REQUEST_LOCATOR",
            &request_identity,
        );
    }

    match state
        .owner
        .resolve_native_replay_execution_input_binding_v1(&locator)
        .await
    {
        Ok(Some(readback)) => {
            let binding = readback.binding();
            (
                StatusCode::OK,
                Json(NativeReplayExecutionInputBindingProjectionV1 {
                    schema_version: 1,
                    request_identity,
                    binding_identity: format!("sha256:{}", hex_digest(&binding.binding_identity())),
                    binding_digest: format!("sha256:{}", hex_digest(&binding.binding_digest())),
                    receipt_identity: format!(
                        "sha256:{}",
                        hex_digest(&readback.receipt().receipt_identity())
                    ),
                }),
            )
                .into_response()
        }
        Ok(None) => rejection(
            StatusCode::NOT_FOUND,
            "NATIVE_REPLAY_EXECUTION_INPUT_BINDING_UNAVAILABLE",
            &request_identity,
        ),
        Err(_) => rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "NATIVE_REPLAY_EXECUTION_INPUT_BINDING_UNAVAILABLE",
            &request_identity,
        ),
    }
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
pub(super) async fn issue_execution_input_binding(
    State(state): State<super::ApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !super::authorized(&headers, &state.token_digest) {
        return rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }
    let locator: ExploratoryReplayRequestLocatorV2 = match serde_json::from_slice(&body) {
        Ok(locator) => locator,
        Err(_) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "INVALID_EXPLORATORY_REPLAY_REQUEST_LOCATOR",
                "unbound",
            );
        }
    };
    let request_identity = locator.request_identity.clone();
    if OpaqueIdentityV2::try_from(locator.request_identity.clone()).is_err()
        || CanonicalDigestV2::try_from(locator.meaning_digest.clone()).is_err()
        || OpaqueIdentityV2::try_from(locator.receipt_identity.clone()).is_err()
        || CanonicalDigestV2::try_from(locator.seal_digest.clone()).is_err()
    {
        return rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_EXPLORATORY_REPLAY_REQUEST_LOCATOR",
            &request_identity,
        );
    }
    let (
        Some(market_data),
        Some(composer),
        Some(instrument_master),
        Some(instrument_economic_terms),
        Some(universe_sample_projection),
    ) = (
        state.native_replay_scheduling.as_deref(),
        state.develop_composer_read.as_deref(),
        state.instrument_master_v2.as_deref(),
        state.instrument_economic_terms.as_deref(),
        state.universe_sample_projection.as_deref(),
    )
    else {
        return rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "NATIVE_REPLAY_EXECUTION_INPUT_BINDING_UNAVAILABLE",
            &request_identity,
        );
    };

    match state
        .owner
        .issue_native_replay_execution_input_binding_v1(
            &locator,
            composer,
            instrument_master,
            instrument_economic_terms,
            universe_sample_projection,
            market_data,
        )
        .await
    {
        Ok(readback) => {
            let binding = readback.binding();
            (
                StatusCode::OK,
                Json(NativeReplayExecutionInputBindingProjectionV1 {
                    schema_version: 1,
                    request_identity,
                    binding_identity: format!("sha256:{}", hex_digest(&binding.binding_identity())),
                    binding_digest: format!("sha256:{}", hex_digest(&binding.binding_digest())),
                    receipt_identity: format!(
                        "sha256:{}",
                        hex_digest(&readback.receipt().receipt_identity())
                    ),
                }),
            )
                .into_response()
        }
        Err(e) => execution_input_binding_error(&e, &request_identity),
    }
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
async fn run_native_replay(
    State(state): State<NativeReplayExecutionApiStateV2>,
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
    let request: NativeReplayExecutionRequestV2 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "INVALID_NATIVE_REPLAY_EXECUTION_REQUEST",
                "unbound",
            );
        }
    };
    let request_identity = request.request_locator.request_identity.clone();
    if validate_request_locator(&request.request_locator).is_err() {
        return rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_NATIVE_REPLAY_EXECUTION_REQUEST",
            &request_identity,
        );
    }
    let Some(service) = state.service.as_deref() else {
        return rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "NATIVE_REPLAY_EXECUTION_UNAVAILABLE",
            &request_identity,
        );
    };
    let run = require_send_future(run_exploratory_replay_v2(
        service.preparation_owner.as_ref(),
        service.result_owner.as_ref(),
        &request.request_locator,
        request.attempt_identity,
    ));

    match run.await {
        Ok(disposition) => {
            native_replay_execution_response(service, disposition, &request_identity).await
        }
        Err(_) => rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "NATIVE_REPLAY_EXECUTION_UNAVAILABLE",
            &request_identity,
        ),
    }
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
fn require_send_future<F: std::future::Future + Send>(future: F) -> F {
    future
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
async fn native_replay_execution_response(
    service: &NativeReplayExecutionServiceV2,
    disposition: NativeReplayCommitDispositionV2,
    request_identity: &str,
) -> Response {
    let disposition = match disposition {
        NativeReplayCommitDispositionV2::Committed { result, .. } => {
            return canonical_result_response(result.result_canonical_bytes());
        }
        NativeReplayCommitDispositionV2::SubmittedOrUnknown(recovery) => {
            recovery.resolve(service.result_owner.as_ref()).await
        }
    };

    match disposition {
        Ok(Some(NativeReplayCommitDispositionV2::Committed { result, .. })) => {
            canonical_result_response(result.result_canonical_bytes())
        }
        _ => native_replay_submitted_or_unknown_response(request_identity),
    }
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
fn native_replay_submitted_or_unknown_response(request_identity: &str) -> Response {
    rejection(
        StatusCode::SERVICE_UNAVAILABLE,
        "NATIVE_REPLAY_RESULT_SUBMITTED_OR_UNKNOWN",
        request_identity,
    )
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
fn canonical_result_response(bytes: &[u8]) -> Response {
    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        bytes.to_vec(),
    )
        .into_response()
}

fn validate_request_locator(
    locator: &ExploratoryReplayRequestLocatorV2,
) -> Result<(), vibe_backtest_owner_contracts::ReplayContractErrorV2> {
    OpaqueIdentityV2::try_from(locator.request_identity.clone())?;
    CanonicalDigestV2::try_from(locator.meaning_digest.clone())?;
    OpaqueIdentityV2::try_from(locator.receipt_identity.clone())?;
    CanonicalDigestV2::try_from(locator.seal_digest.clone())?;
    Ok(())
}

async fn read_result(
    State(state): State<ExploratoryReplayResultApiState>,
    path: Result<Path<ExploratoryReplayResultPathV2>, axum::extract::rejection::PathRejection>,
    query: Result<Query<ExploratoryReplayResultQueryV2>, QueryRejection>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }

    let (Path(path), Query(query)) = match (path, query) {
        (Ok(path), Ok(query)) => (path, query),
        _ => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "INVALID_EXPLORATORY_REPLAY_RESULT_LOCATOR",
                "unbound",
            );
        }
    };
    let request_identity = query.request_identity.clone();
    let locator = match validate_result_locator(&path, &query) {
        Ok(locator) => locator,
        Err(()) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "INVALID_EXPLORATORY_REPLAY_RESULT_LOCATOR",
                &request_identity,
            );
        }
    };

    match state
        .owner
        .resolve_exploratory_replay_result_v2(locator)
        .await
    {
        Ok(Some(result)) => (
            StatusCode::OK,
            [(axum::http::header::CONTENT_TYPE, "application/json")],
            result.result_canonical_bytes().to_vec(),
        )
            .into_response(),
        Ok(None) => rejection(
            StatusCode::NOT_FOUND,
            "EXPLORATORY_REPLAY_RESULT_UNAVAILABLE",
            &request_identity,
        ),
        Err(_) => rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "EXPLORATORY_REPLAY_RESULT_UNAVAILABLE",
            &request_identity,
        ),
    }
}

async fn read_run_evidence(
    State(state): State<ExploratoryReplayResultApiState>,
    path: Result<Path<ExploratoryReplayResultPathV2>, axum::extract::rejection::PathRejection>,
    query: Result<Query<ExploratoryReplayResultQueryV2>, QueryRejection>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }

    let (Path(path), Query(query)) = match (path, query) {
        (Ok(path), Ok(query)) => (path, query),
        _ => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "INVALID_EXPLORATORY_REPLAY_RESULT_LOCATOR",
                "unbound",
            );
        }
    };
    let request_identity = query.request_identity.clone();
    let locator = match validate_result_locator(&path, &query) {
        Ok(locator) => locator,
        Err(()) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "INVALID_EXPLORATORY_REPLAY_RESULT_LOCATOR",
                &request_identity,
            );
        }
    };

    match state
        .owner
        .resolve_exploratory_replay_result_v2(locator)
        .await
    {
        Ok(Some(result)) => (
            StatusCode::OK,
            Json(ResearchExploratoryRunEvidenceProjectionV1::from_locked_owner_readback(&result)),
        )
            .into_response(),
        Ok(None) => rejection(
            StatusCode::NOT_FOUND,
            "EXPLORATORY_REPLAY_RESULT_UNAVAILABLE",
            &request_identity,
        ),
        Err(_) => rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "EXPLORATORY_REPLAY_RESULT_UNAVAILABLE",
            &request_identity,
        ),
    }
}

async fn read_diagnosis_gate(
    State(state): State<ExploratoryDiagnosisGateApiState>,
    path: Result<Path<ExploratoryReplayResultPathV2>, axum::extract::rejection::PathRejection>,
    query: Result<Query<ExploratoryReplayDiagnosisQueryV1>, QueryRejection>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }

    let (Path(path), Query(query)) = match (path, query) {
        (Ok(path), Ok(query)) => (path, query),
        _ => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "INVALID_EXPLORATORY_DIAGNOSIS_GATE_LOCATOR",
                "unbound",
            );
        }
    };
    let request_identity = query.request_identity.clone();
    let locator = match validate_diagnosis_locator(path, query) {
        Ok(locator) => locator,
        Err(()) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "INVALID_EXPLORATORY_DIAGNOSIS_GATE_LOCATOR",
                &request_identity,
            );
        }
    };

    match state.owner.resolve_diagnosis_gate(locator).await {
        Ok(projection) => (StatusCode::OK, Json(projection)).into_response(),
        Err(ResearchExploratoryDiagnosisGateErrorV1::Unavailable) => rejection(
            StatusCode::NOT_FOUND,
            "EXPLORATORY_DIAGNOSIS_GATE_UNAVAILABLE",
            &request_identity,
        ),
        Err(ResearchExploratoryDiagnosisGateErrorV1::InvalidEvidence) => rejection(
            StatusCode::CONFLICT,
            "EXPLORATORY_DIAGNOSIS_GATE_INVALID_EVIDENCE",
            &request_identity,
        ),
        Err(ResearchExploratoryDiagnosisGateErrorV1::Storage(_)) => rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "EXPLORATORY_DIAGNOSIS_GATE_UNAVAILABLE",
            &request_identity,
        ),
        // A locator that addresses no row never reaches here: that is an empty result and keeps
        // the 404 above. Everything that does reach here is an aggregate the Owner holds and
        // cannot answer with, which is a 503 that now says which row was the problem instead of
        // one code standing for seven situations.
        Err(ResearchExploratoryDiagnosisGateErrorV1::Refused(refusal)) => rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            refusal.code(),
            &request_identity,
        ),
    }
}

fn validate_diagnosis_locator(
    path: ExploratoryReplayResultPathV2,
    query: ExploratoryReplayDiagnosisQueryV1,
) -> Result<ResearchExploratoryDiagnosisLocatorV1, ()> {
    if [
        query.trial_family_identity.as_str(),
        path.result_identity.as_str(),
        query.request_identity.as_str(),
        query.attempt_identity.as_str(),
    ]
    .into_iter()
    .any(|identity| !is_valid_iteration_decision_locator_v1(identity))
    {
        return Err(());
    }
    Ok(ResearchExploratoryDiagnosisLocatorV1 {
        trial_family_identity: query.trial_family_identity,
        result_identity: path.result_identity,
        request_identity: query.request_identity,
        attempt_identity: query.attempt_identity,
    })
}

fn validate_result_locator<'a>(
    path: &'a ExploratoryReplayResultPathV2,
    query: &'a ExploratoryReplayResultQueryV2,
) -> Result<ExploratoryReplayResultLocatorV2<'a>, ()> {
    if [
        path.result_identity.as_str(),
        query.request_identity.as_str(),
        query.attempt_identity.as_str(),
    ]
    .into_iter()
    .any(|value| OpaqueIdentityV2::try_from(value.to_string()).is_err())
    {
        return Err(());
    }

    Ok(ExploratoryReplayResultLocatorV2 {
        result_identity: &path.result_identity,
        request_identity: &query.request_identity,
        attempt_identity: &query.attempt_identity,
    })
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ExploratoryReplayOperationV2 {
    build_request_identity: String,
    attempt_identity: String,
    build_receipt_identity: String,
    artifact_family_binding_identity: String,
    request: ReplayRequestDtoV2,
}

/// Only immutable locators are accepted from Product Edge. The positive Composer, TrialFamily,
/// and Market Data facts are re-read by R&D during the Owner transaction.
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ComposerBackedReplayOperationV3 {
    request_identity: String,
    trial_family_identity: String,
    artifact_identity: String,
    composer_locator:
        vibe_strategy_factory::develop_composer_postgres_v2::DevelopComposerSealedReadLocatorV2,
    market_data_locator:
        vibe_data::owner::replay_market_facts_v2::ReplayCompositionBindingLocatorV1,
    market_data_scope_digest: BindingDigest,
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
impl ComposerBackedReplayOperationV3 {
    fn into_proposal(
        self,
        admission: vibe_product_edge::ProductEdgeAdmissionLocatorV1,
    ) -> ComposerBackedExploratoryReplayProposalV3 {
        ComposerBackedExploratoryReplayProposalV3 {
            admission,
            request_identity: self.request_identity,
            trial_family_identity: self.trial_family_identity,
            artifact_identity: self.artifact_identity,
            composer_locator: self.composer_locator,
            market_data_locator: self.market_data_locator,
            market_data_scope_digest: self.market_data_scope_digest,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExploratoryReplayResolveRequestV2 {
    meaning_digest: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ExploratoryReplayReadbackQueryV2 {
    request_identity: String,
    meaning_digest: String,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
struct ExploratoryReplayIdentifyResultV2 {
    request_identity: String,
    meaning_digest: String,
    canonical_request_bytes: Vec<u8>,
}

pub(super) async fn identify(
    State(state): State<ApiState>,
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

    let request: ReplayRequestDtoV2 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };

    match identify_request(request) {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(request_identity) => rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_EXPLORATORY_REPLAY_REQUEST",
            &request_identity,
        ),
    }
}

pub(super) async fn submit(
    State(state): State<ApiState>,
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

    let operation: ExploratoryReplayOperationV2 = match serde_json::from_slice(&body) {
        Ok(operation) => operation,
        Err(_) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let request_identity = operation.request.request_identity.as_str().to_string();
    if validate_operation(&operation).is_err() {
        return rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_EXPLORATORY_REPLAY_REQUEST",
            &request_identity,
        );
    }

    let typed_payload = match serde_json::to_value(&operation) {
        Ok(payload) => payload,
        Err(_) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                &request_identity,
            );
        }
    };
    let admission = match state
        .product_edge
        .admit_request(ProductEdgeAdmissionRequestV1 {
            request_identity: request_identity.clone(),
            typed_payload,
            operation: EXPLORATORY_REPLAY_OPERATION_V2.into(),
            operation_schema: EXPLORATORY_REPLAY_SCHEMA_V2.into(),
            target_owner: RESEARCH_OWNER_V1.into(),
            requested_effects: vec![EXPLORATORY_REPLAY_MUTATION_EFFECT_V2.into()],
            request_proof_digest: state.request_proof_digest.clone(),
            audit_correlation: format!("rd-workbench:{request_identity}"),
        })
        .await
    {
        Ok(admission) => admission,
        Err(e) => return product_edge_error(&e, &request_identity),
    };

    let proposal = ExploratoryReplayRequestProposalV2 {
        admission: admission.locator().clone(),
        build_request_identity: operation.build_request_identity,
        attempt_identity: operation.attempt_identity,
        build_receipt_identity: operation.build_receipt_identity,
        artifact_family_binding_identity: operation.artifact_family_binding_identity,
        request: operation.request,
    };

    match state
        .owner
        .commit_exploratory_replay_request_v2(proposal)
        .await
    {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => owner_error(&e, &request_identity),
    }
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
pub(super) async fn submit_composer_backed_v3(
    State(state): State<ApiState>,
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
    let operation: ComposerBackedReplayOperationV3 = match serde_json::from_slice(&body) {
        Ok(operation) => operation,
        Err(_) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let request_identity = operation.request_identity.clone();
    if OpaqueIdentityV2::try_from(request_identity.clone()).is_err()
        || operation.trial_family_identity.trim().is_empty()
        || operation.artifact_identity.trim().is_empty()
    {
        return rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_EXPLORATORY_REPLAY_REQUEST",
            &request_identity,
        );
    }
    let typed_payload = match serde_json::to_value(&operation) {
        Ok(payload) => payload,
        Err(_) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                &request_identity,
            );
        }
    };
    let admission = match state
        .product_edge
        .admit_request(ProductEdgeAdmissionRequestV1 {
            request_identity: request_identity.clone(),
            typed_payload,
            operation: EXPLORATORY_REPLAY_OPERATION_V3.into(),
            operation_schema: EXPLORATORY_REPLAY_SCHEMA_V3.into(),
            target_owner: RESEARCH_OWNER_V1.into(),
            requested_effects: vec![EXPLORATORY_REPLAY_MUTATION_EFFECT_V3.into()],
            request_proof_digest: state.request_proof_digest.clone(),
            audit_correlation: format!("rd-workbench:{request_identity}"),
        })
        .await
    {
        Ok(admission) => admission,
        Err(e) => return product_edge_error(&e, &request_identity),
    };
    let proposal = operation.into_proposal(admission.locator().clone());

    match state
        .owner
        .commit_composer_backed_exploratory_replay_request_v3(proposal)
        .await
    {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => owner_error(&e, &request_identity),
    }
}

pub(super) async fn resolve(
    State(state): State<ApiState>,
    Path(request_identity): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            &request_identity,
        );
    }

    let request: ExploratoryReplayResolveRequestV2 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                &request_identity,
            );
        }
    };

    if OpaqueIdentityV2::try_from(request_identity.clone()).is_err()
        || CanonicalDigestV2::try_from(request.meaning_digest.clone()).is_err()
    {
        return rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_EXPLORATORY_REPLAY_SELECTOR",
            &request_identity,
        );
    }

    let selector = ExploratoryReplayRecoverySelectorV2 {
        request_identity: request_identity.clone(),
        meaning_digest: request.meaning_digest,
    };

    match state
        .owner
        .resolve_exploratory_replay_request_v2(&selector)
        .await
    {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => owner_error(&e, &request_identity),
    }
}

pub(super) async fn readback(
    State(state): State<ApiState>,
    Query(query): Query<ExploratoryReplayReadbackQueryV2>,
    headers: HeaderMap,
) -> Response {
    let request_identity = query.request_identity;

    if !authorized(&headers, &state.token_digest) {
        return rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            &request_identity,
        );
    }

    let selector = match readback_selector(request_identity.clone(), query.meaning_digest) {
        Ok(selector) => selector,
        Err(()) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "INVALID_EXPLORATORY_REPLAY_SELECTOR",
                &request_identity,
            );
        }
    };

    match state
        .owner
        .resolve_sealed_exploratory_replay_request_v2(&selector)
        .await
    {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => owner_error(&e, &request_identity),
    }
}

fn readback_selector(
    request_identity: String,
    meaning_digest: String,
) -> Result<ExploratoryReplayRecoverySelectorV2, ()> {
    if OpaqueIdentityV2::try_from(request_identity.clone()).is_err()
        || CanonicalDigestV2::try_from(meaning_digest.clone()).is_err()
    {
        return Err(());
    }
    Ok(ExploratoryReplayRecoverySelectorV2 {
        request_identity,
        meaning_digest,
    })
}

fn identify_request(
    request: ReplayRequestDtoV2,
) -> Result<ExploratoryReplayIdentifyResultV2, String> {
    let request_identity = request.request_identity.as_str().to_string();
    let request = ReplayRequestV2::try_from(request).map_err(|_| request_identity.clone())?;
    if request.namespace() != ReplayNamespaceV2::Exploratory {
        return Err(request_identity);
    }
    let canonical_request_bytes = request
        .to_canonical_bytes()
        .map_err(|_| request_identity.clone())?;
    let meaning_digest = request
        .meaning_digest()
        .map_err(|_| request_identity.clone())?
        .as_str()
        .to_string();
    Ok(ExploratoryReplayIdentifyResultV2 {
        request_identity,
        meaning_digest,
        canonical_request_bytes,
    })
}

fn validate_operation(operation: &ExploratoryReplayOperationV2) -> Result<(), ()> {
    let request = ReplayRequestV2::try_from(operation.request.clone()).map_err(|_| ())?;
    if request.namespace() != ReplayNamespaceV2::Exploratory
        || [
            operation.build_request_identity.as_str(),
            operation.attempt_identity.as_str(),
            operation.build_receipt_identity.as_str(),
            operation.artifact_family_binding_identity.as_str(),
        ]
        .iter()
        .any(|identity| identity.trim().is_empty())
    {
        return Err(());
    }
    Ok(())
}

fn product_edge_error(error: &ProductEdgeError, request_identity: &str) -> Response {
    match error {
        ProductEdgeError::ConflictingReplay => rejection(
            StatusCode::CONFLICT,
            "CONFLICTING_SEMANTICS_FOR_REQUEST_IDENTITY",
            request_identity,
        ),
        ProductEdgeError::InvalidProposal(_) => rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_EXPLORATORY_REPLAY_REQUEST",
            request_identity,
        ),
        // Two causes collapse into one code here, and the response cannot separate them:
        // `OWNER_UNAVAILABLE` is consumed by the Dashboard's run contract, its run store and the
        // Owner client, so splitting it is a wire change, not a diagnostic fix.
        //
        // What can be fixed is that the cause was thrown away. A deployment bring-up spent a pass
        // on a 503 from this family and the response carried nothing to say whether the authority
        // or the store was the one unavailable - the `_` was the whole answer and it was
        // discarded at the match. Logged under the two variants' own names, the reason survives
        // where a reader can find it while the contract stays where its consumers expect it.
        ProductEdgeError::Unavailable(detail) => {
            tracing::warn!(%detail, %request_identity, "Product Edge authority unavailable");
            rejection(
                StatusCode::SERVICE_UNAVAILABLE,
                "OWNER_UNAVAILABLE",
                request_identity,
            )
        }
        ProductEdgeError::Storage(detail) => {
            tracing::warn!(%detail, %request_identity, "Product Edge storage unavailable");
            rejection(
                StatusCode::SERVICE_UNAVAILABLE,
                "OWNER_UNAVAILABLE",
                request_identity,
            )
        }
    }
}

/// A request whose Owner inputs no longer reproduce the binding already issued for it is refused
/// for good, so it answers `409` rather than a `503` that invites the same retry forever.
/// `Unavailable` recorded its stage in the R&D Owner before it got here; `Storage` has no such
/// record, so its detail is logged at the match.
#[cfg(any(test, feature = "sealed-develop-composer-acceptance"))]
fn execution_input_binding_error(
    error: &NativeReplayExecutionInputBindingErrorV1,
    request_identity: &str,
) -> Response {
    match error {
        NativeReplayExecutionInputBindingErrorV1::Conflict => rejection(
            StatusCode::CONFLICT,
            "CONFLICTING_SEMANTICS_FOR_REQUEST_IDENTITY",
            request_identity,
        ),
        NativeReplayExecutionInputBindingErrorV1::Storage(detail) => {
            tracing::warn!(%detail, %request_identity, "execution-input binding storage unavailable");
            rejection(
                StatusCode::SERVICE_UNAVAILABLE,
                "NATIVE_REPLAY_EXECUTION_INPUT_BINDING_UNAVAILABLE",
                request_identity,
            )
        }
        NativeReplayExecutionInputBindingErrorV1::Unavailable => rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "NATIVE_REPLAY_EXECUTION_INPUT_BINDING_UNAVAILABLE",
            request_identity,
        ),
        NativeReplayExecutionInputBindingErrorV1::NoCompositionBinding => rejection(
            StatusCode::UNPROCESSABLE_ENTITY,
            "REPLAY_REQUEST_NAMES_NO_COMPOSITION_BINDING",
            request_identity,
        ),
    }
}

fn owner_error(error: &ExploratoryReplayOwnerError, request_identity: &str) -> Response {
    match error {
        ExploratoryReplayOwnerError::ConflictingReplay => rejection(
            StatusCode::CONFLICT,
            "CONFLICTING_SEMANTICS_FOR_REQUEST_IDENTITY",
            request_identity,
        ),
        ExploratoryReplayOwnerError::InvalidProposal(_) => rejection(
            StatusCode::BAD_REQUEST,
            "INVALID_EXPLORATORY_REPLAY_REQUEST",
            request_identity,
        ),
        ExploratoryReplayOwnerError::Unavailable(_) => rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "OWNER_UNAVAILABLE",
            request_identity,
        ),
        ExploratoryReplayOwnerError::ComposerReplayShapeRefused(_) => rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "COMPOSER_REPLAY_SHAPE_REFUSED",
            request_identity,
        ),
    }
}

fn rejection(status: StatusCode, code: &str, request_identity: &str) -> Response {
    let mut response = (
        status,
        Json(json!({
            "request_identity": request_identity,
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

    use rstest::rstest;
    use sha2::Digest as _;
    use tower::ServiceExt;

    use super::*;
    use vibe_product_edge::{
        ProductEdgeSubjectKindV1, ProductEdgeUnavailableReasonV1, ProductEdgeUnavailableV1,
    };

    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    #[rstest]
    fn composer_v3_edge_payload_matches_owner_proposal_without_admission() {
        let digest = vec![0_u8; 32];
        let payload = json!({
            "request_identity": "composer-replay-request-v3",
            "trial_family_identity": "trial-family-v3",
            "artifact_identity": "composer-artifact-v3",
            "composer_locator": {
                "schema_version": 2,
                "request_identity": "composer-operation-v3",
                "operation_receipt_identity": digest,
                "artifact_locator": "composer-artifact-locator-v3",
                "artifact_identity": digest,
                "canonical_plan_digest": digest,
                "design_digest": digest
            },
            "market_data_locator": {
                "binding_identity": digest,
                "binding_digest": digest
            },
            "market_data_scope_digest": digest
        });
        let operation: ComposerBackedReplayOperationV3 =
            serde_json::from_value(payload.clone()).expect("locator-only V3 operation");
        let proposal = operation.into_proposal(vibe_product_edge::ProductEdgeAdmissionLocatorV1 {
            request_identity: "composer-replay-request-v3".into(),
            admission_identity: "admission-v3".into(),
            admission_digest: format!("sha256:{}", "0".repeat(64)),
        });
        let mut owner_payload = serde_json::to_value(proposal).expect("Owner V3 proposal");
        owner_payload
            .as_object_mut()
            .expect("proposal object")
            .remove("admission");
        assert_eq!(owner_payload, payload);
    }

    struct RepairedReplayOwnerStub {
        calls: AtomicUsize,
        response: Option<MarketDataRepairedReplayActionResponseV1>,
    }

    struct DiagnosisOwnerStub {
        calls: AtomicUsize,
        response: DiagnosisOwnerStubResponse,
    }

    #[derive(Clone, Copy)]
    enum DiagnosisOwnerStubResponse {
        Unavailable,
        InvalidEvidence,
        Storage,
    }

    #[async_trait::async_trait]
    impl ExploratoryDiagnosisGateReadPort for DiagnosisOwnerStub {
        async fn resolve_diagnosis_gate(
            &self,
            _locator: ResearchExploratoryDiagnosisLocatorV1,
        ) -> Result<
            ResearchExploratoryDiagnosisGateProjectionV1,
            ResearchExploratoryDiagnosisGateErrorV1,
        > {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Err(match self.response {
                DiagnosisOwnerStubResponse::Unavailable => {
                    ResearchExploratoryDiagnosisGateErrorV1::Unavailable
                }
                DiagnosisOwnerStubResponse::InvalidEvidence => {
                    ResearchExploratoryDiagnosisGateErrorV1::InvalidEvidence
                }
                DiagnosisOwnerStubResponse::Storage => {
                    ResearchExploratoryDiagnosisGateErrorV1::Storage("test storage".into())
                }
            })
        }
    }

    #[async_trait::async_trait]
    impl MarketDataRepairedReplayActionPort for RepairedReplayOwnerStub {
        async fn commit_repaired_replay(
            &self,
            _predecessor: &ExploratoryReplayRequestLocatorV2,
            _resolution: &MarketDataRepairResolutionLocatorV1,
        ) -> Result<MarketDataRepairedReplayActionResponseV1, ExploratoryReplayOwnerError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.response.clone().ok_or_else(|| {
                ExploratoryReplayOwnerError::Unavailable("test owner unavailable".into())
            })
        }
    }

    fn request() -> ReplayRequestDtoV2 {
        serde_json::from_value(json!({
            "schema_version": 2,
            "request_identity": "request-1",
            "frozen_research_intent": content("intent", '1'),
            "trial_family": content("family", '2'),
            "trial_family_census_frontier": content("frontier", '3'),
            "replay_authority": { "namespace": "EXPLORATORY" },
            "strategy_design": content("design", '4'),
            "strategy_plan": content("plan", '5'),
            "artifact": content("artifact", '6'),
            "resolved_owner_inputs": content("inputs", '7'),
            "pit_scope": content("pit-scope", '8'),
            "pit_snapshot": content("pit-snapshot", '9'),
            "universe_selection": content("universe", 'a'),
            "correction_rule": version("correction"),
            "market_semantics": version("market-semantics"),
            "replay_configuration": content("replay-configuration", 'b'),
            "models": {
                "runtime_kernel": version("runtime-kernel"),
                "simulator": version("simulator"),
                "cost": version("cost"),
                "slippage": version("slippage"),
                "capacity": version("capacity")
            },
            "runner_operational_profile": version("runner"),
            "diagnostic_policy": version("diagnostic"),
            "deterministic_seed": 17,
            "window": { "start_event_ns": 10, "end_event_ns_exclusive": 20 },
            "calendar": version("calendar"),
            "session": version("session"),
            "time_zone": version("time-zone"),
            "corporate_action_cut": content("corporate-action-cut", 'c'),
            "historical_membership_cut": content("membership-cut", 'd')
        }))
        .expect("fixture request")
    }

    fn content(identity: &str, byte: char) -> serde_json::Value {
        json!({
            "identity": identity,
            "digest": format!("sha256:{}", byte.to_string().repeat(64)),
        })
    }

    fn version(identity: &str) -> serde_json::Value {
        json!({ "identity": identity, "version": "v1" })
    }

    fn repaired_replay_action_request() -> serde_json::Value {
        json!({
            "predecessor_request_locator": {
                "request_identity": "request-1",
                "meaning_digest": format!("blake3:{}", "a".repeat(64)),
                "receipt_identity": "receipt-1",
                "seal_digest": format!("sha256:{}", "b".repeat(64)),
            },
            "repair_resolution_locator": {
                "resolution_identity": "resolution-1",
                "repair_request_identity": "repair-request-1",
            },
        })
    }

    fn repaired_replay_action_response() -> MarketDataRepairedReplayActionResponseV1 {
        MarketDataRepairedReplayActionResponseV1 {
            schema_version: 1,
            predecessor_request_locator: ExploratoryReplayRequestLocatorV2 {
                request_identity: "request-1".into(),
                meaning_digest: format!("blake3:{}", "a".repeat(64)),
                receipt_identity: "receipt-1".into(),
                seal_digest: format!("sha256:{}", "b".repeat(64)),
            },
            repair_resolution_locator: MarketDataRepairResolutionLocatorV1 {
                resolution_identity: "resolution-1".into(),
                repair_request_identity: "repair-request-1".into(),
            },
            projection: ExploratoryReplayRequestProjectionV1 {
                schema_version: 1,
                request_identity: "successor-1".into(),
                availability: ExploratoryReplayAvailabilityV1::Available,
                next_legal_action: ExploratoryReplayNextLegalActionV1::LockByLocator,
            },
            locator: ExploratoryReplayRequestLocatorV2 {
                request_identity: "successor-1".into(),
                meaning_digest: format!("blake3:{}", "c".repeat(64)),
                receipt_identity: "successor-receipt-1".into(),
                seal_digest: format!("sha256:{}", "d".repeat(64)),
            },
            canonical_request_bytes: br#"{"request_identity":"successor-1"}"#.to_vec(),
        }
    }

    #[rstest]
    fn repaired_replay_action_accepts_only_the_two_exact_owner_locators() {
        let request = repaired_replay_action_request();
        serde_json::from_value::<MarketDataRepairedReplayActionRequestV1>(request.clone())
            .expect("exact locator-only request");

        let mut with_terminal = request;
        with_terminal["repair_resolution"] = json!({ "disposition": "REPAIRED" });
        assert!(
            serde_json::from_value::<MarketDataRepairedReplayActionRequestV1>(with_terminal)
                .is_err()
        );
    }

    #[tokio::test]
    async fn repaired_replay_action_rejects_before_owner_and_maps_owner_unavailability() {
        let token = "repaired-replay-action-test";
        let token_digest: [u8; 32] = sha2::Sha256::digest(token.as_bytes()).into();
        let owner = Arc::new(RepairedReplayOwnerStub {
            calls: AtomicUsize::new(0),
            response: None,
        });
        let router = || market_data_repaired_replay_router(owner.clone(), token_digest);
        let send = |body: serde_json::Value, authorization: Option<&str>| {
            let mut request = axum::http::Request::builder()
                .method(axum::http::Method::POST)
                .uri("/v2/exploratory-replay-requests/market-data-repair-successors")
                .header(axum::http::header::CONTENT_TYPE, "application/json");
            if let Some(authorization) = authorization {
                request = request.header(axum::http::header::AUTHORIZATION, authorization);
            }
            request
                .body(axum::body::Body::from(body.to_string()))
                .expect("HTTP request")
        };

        let unauthorized = router()
            .oneshot(send(repaired_replay_action_request(), None))
            .await
            .expect("router response");
        assert_eq!(unauthorized.status(), StatusCode::FORBIDDEN);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);

        let mut invalid = repaired_replay_action_request();
        invalid["repair_resolution_locator"]["resolution_identity"] = json!(" invalid");
        let invalid = router()
            .oneshot(send(invalid, Some(&format!("Bearer {token}"))))
            .await
            .expect("router response");
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);

        let unavailable = router()
            .oneshot(send(
                repaired_replay_action_request(),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(unavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn repaired_replay_action_returns_the_typed_owner_result_on_exact_retry() {
        let token = "repaired-replay-action-success-test";
        let token_digest: [u8; 32] = sha2::Sha256::digest(token.as_bytes()).into();
        let expected = repaired_replay_action_response();
        let owner = Arc::new(RepairedReplayOwnerStub {
            calls: AtomicUsize::new(0),
            response: Some(expected.clone()),
        });
        let request = || {
            axum::http::Request::builder()
                .method(axum::http::Method::POST)
                .uri("/v2/exploratory-replay-requests/market-data-repair-successors")
                .header(axum::http::header::AUTHORIZATION, format!("Bearer {token}"))
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(axum::body::Body::from(
                    repaired_replay_action_request().to_string(),
                ))
                .expect("HTTP request")
        };
        let mut bodies = Vec::new();

        for _ in 0..2 {
            let response = market_data_repaired_replay_router(owner.clone(), token_digest)
                .oneshot(request())
                .await
                .expect("router response");
            assert_eq!(response.status(), StatusCode::OK);
            bodies.push(
                axum::body::to_bytes(response.into_body(), usize::MAX)
                    .await
                    .expect("typed response bytes"),
            );
        }
        assert_eq!(owner.calls.load(Ordering::SeqCst), 2);
        assert_eq!(bodies[0], bodies[1]);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&bodies[0]).expect("typed response JSON"),
            serde_json::to_value(expected).expect("expected response JSON"),
        );
    }

    #[tokio::test]
    async fn diagnosis_gate_route_authenticates_and_validates_before_owner_read() {
        let token = "exploratory-diagnosis-test";
        let token_digest: [u8; 32] = sha2::Sha256::digest(token.as_bytes()).into();
        let owner = Arc::new(DiagnosisOwnerStub {
            calls: AtomicUsize::new(0),
            response: DiagnosisOwnerStubResponse::Unavailable,
        });
        let exact_uri = "/v2/exploratory-replay-results/result-1/diagnosis-gate?trial_family_identity=family-1&request_identity=request-1&attempt_identity=attempt-1";
        let request = |uri: &str, authorization: Option<&str>| {
            let mut request = axum::http::Request::builder()
                .method(axum::http::Method::GET)
                .uri(uri);

            if let Some(authorization) = authorization {
                request = request.header(axum::http::header::AUTHORIZATION, authorization);
            }
            request
                .body(axum::body::Body::empty())
                .expect("HTTP request")
        };

        let unauthorized = exploratory_diagnosis_gate_router(owner.clone(), token_digest)
            .oneshot(request(exact_uri, None))
            .await
            .expect("router response");
        assert_eq!(unauthorized.status(), StatusCode::FORBIDDEN);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);

        let invalid = exploratory_diagnosis_gate_router(owner.clone(), token_digest)
            .oneshot(request(
                &format!("{exact_uri}&decision_identity=caller-supplied"),
                Some(&format!("Bearer {token}")),
            ))
            .await
            .expect("router response");
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 0);

        let unavailable = exploratory_diagnosis_gate_router(owner.clone(), token_digest)
            .oneshot(request(exact_uri, Some(&format!("Bearer {token}"))))
            .await
            .expect("router response");
        assert_eq!(unavailable.status(), StatusCode::NOT_FOUND);
        assert_eq!(owner.calls.load(Ordering::SeqCst), 1);

        for (response, expected_status, expected_code) in [
            (
                DiagnosisOwnerStubResponse::InvalidEvidence,
                StatusCode::CONFLICT,
                "EXPLORATORY_DIAGNOSIS_GATE_INVALID_EVIDENCE",
            ),
            (
                DiagnosisOwnerStubResponse::Storage,
                StatusCode::SERVICE_UNAVAILABLE,
                "EXPLORATORY_DIAGNOSIS_GATE_UNAVAILABLE",
            ),
        ] {
            let owner = Arc::new(DiagnosisOwnerStub {
                calls: AtomicUsize::new(0),
                response,
            });
            let rejected = exploratory_diagnosis_gate_router(owner.clone(), token_digest)
                .oneshot(request(exact_uri, Some(&format!("Bearer {token}"))))
                .await
                .expect("router response");
            assert_eq!(rejected.status(), expected_status);
            assert_eq!(
                rejected.headers().get("x-rd-rejection-code").unwrap(),
                expected_code
            );
            assert_eq!(owner.calls.load(Ordering::SeqCst), 1);
        }
    }

    #[cfg(feature = "sealed-develop-composer-acceptance")]
    #[rstest]
    fn native_replay_execution_request_accepts_only_exact_owner_locators() {
        let request = json!({
            "request_locator": {
                "request_identity": "request-1",
                "meaning_digest": format!("blake3:{}", "a".repeat(64)),
                "receipt_identity": "receipt-1",
                "seal_digest": format!("sha256:{}", "b".repeat(64)),
            },
            "attempt_identity": "attempt-1",
        });
        let parsed: NativeReplayExecutionRequestV2 =
            serde_json::from_value(request.clone()).expect("exact execution request");
        assert!(validate_request_locator(&parsed.request_locator).is_ok());

        let mut with_caller_execution = request;
        with_caller_execution["execution"] = json!({ "events": [] });
        assert!(
            serde_json::from_value::<NativeReplayExecutionRequestV2>(with_caller_execution)
                .is_err()
        );
    }

    #[cfg(feature = "sealed-develop-composer-acceptance")]
    #[tokio::test]
    async fn native_replay_unknown_result_preserves_request_correlation() {
        let response = native_replay_submitted_or_unknown_response("request-1");
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("bounded rejection body");
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).expect("JSON rejection"),
            json!({
                "error": "NATIVE_REPLAY_RESULT_SUBMITTED_OR_UNKNOWN",
                "request_identity": "request-1",
            })
        );
    }

    #[cfg(feature = "sealed-develop-composer-acceptance")]
    #[tokio::test]
    async fn native_replay_router_is_authenticated_and_fail_closed_without_service() {
        let token = "native-replay-router-test";
        let token_digest: [u8; 32] = sha2::Sha256::digest(token.as_bytes()).into();
        let request = json!({
            "request_locator": {
                "request_identity": "request-1",
                "meaning_digest": format!("blake3:{}", "a".repeat(64)),
                "receipt_identity": "receipt-1",
                "seal_digest": format!("sha256:{}", "b".repeat(64)),
            },
            "attempt_identity": "attempt-1",
        });
        let response = execution_router(None, token_digest)
            .oneshot(
                axum::http::Request::builder()
                    .method(axum::http::Method::POST)
                    .uri("/v2/exploratory-replays")
                    .header(axum::http::header::AUTHORIZATION, format!("Bearer {token}"))
                    .header(axum::http::header::CONTENT_TYPE, "application/json")
                    .body(axum::body::Body::from(request.to_string()))
                    .expect("HTTP request"),
            )
            .await
            .expect("router response");
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("bounded rejection body");
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).expect("JSON rejection"),
            json!({
                "error": "NATIVE_REPLAY_EXECUTION_UNAVAILABLE",
                "request_identity": "request-1",
            })
        );
    }

    #[rstest]
    fn identify_returns_pre_send_selector_and_exact_canonical_bytes() {
        let expected = request();
        let result = identify_request(expected.clone()).expect("valid exploratory request");

        assert_eq!(result.request_identity, "request-1");
        assert!(result.meaning_digest.starts_with("blake3:"));
        assert_eq!(
            result.canonical_request_bytes,
            serde_json::to_vec(&expected).expect("canonical fixture bytes")
        );
    }

    #[rstest]
    fn identify_and_submit_validation_reject_non_exploratory_or_invalid_requests() {
        let mut invalid_window = request();
        invalid_window.window.end_event_ns_exclusive = invalid_window.window.start_event_ns;
        assert!(identify_request(invalid_window).is_err());

        let mut protected = serde_json::to_value(request()).expect("request value");
        protected["replay_authority"] = json!({
            "namespace": "PROTECTED",
            "qualification_candidate_intake": content("candidate", 'e'),
            "holdout_reservation": content("reservation", 'f'),
            "protected_replay_plan": content("protected-plan", '0'),
            "protected_plan_cell": content("plan-cell", '1')
        });
        let protected = serde_json::from_value(protected).expect("protected request");
        assert!(identify_request(protected).is_err());
    }

    #[rstest]
    fn readback_selector_binds_exact_identity_and_meaning_digest() {
        let selector = readback_selector(
            "request-1".to_string(),
            format!("sha256:{}", "a".repeat(64)),
        )
        .expect("valid selector");

        assert_eq!(selector.request_identity, "request-1");
        assert_eq!(
            selector.meaning_digest,
            format!("sha256:{}", "a".repeat(64))
        );
    }

    #[rstest]
    fn result_locator_wire_shape_is_exact_and_carries_no_result_evidence() {
        let path = serde_json::from_value::<ExploratoryReplayResultPathV2>(json!({
            "result_identity": "result-1",
        }))
        .expect("exact result path");
        let query = serde_json::from_value::<ExploratoryReplayResultQueryV2>(json!({
            "request_identity": "request-1",
            "attempt_identity": "attempt-1",
        }))
        .expect("exact result query");
        assert_eq!(path.result_identity, "result-1");
        assert_eq!(query.request_identity, "request-1");
        assert_eq!(query.attempt_identity, "attempt-1");
        let locator = validate_result_locator(&path, &query).expect("valid result locator");
        assert_eq!(locator.result_identity, "result-1");
        assert_eq!(locator.request_identity, "request-1");
        assert_eq!(locator.attempt_identity, "attempt-1");
        assert!(
            serde_json::from_value::<ExploratoryReplayResultQueryV2>(json!({
                "request_identity": "request-1",
                "attempt_identity": "attempt-1",
                "result_bytes": [],
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<ExploratoryReplayResultPathV2>(json!({
                "result_identity": "result-1",
                "diagnosis": "caller-controlled",
            }))
            .is_err()
        );

        let invalid = ExploratoryReplayResultQueryV2 {
            request_identity: " request-1".into(),
            attempt_identity: "attempt-1".into(),
        };
        assert!(validate_result_locator(&path, &invalid).is_err());
    }

    #[rstest]
    fn readback_query_requires_both_exact_selector_fields() {
        let meaning_digest = format!("sha256:{}", "a".repeat(64));
        assert!(
            serde_json::from_value::<ExploratoryReplayReadbackQueryV2>(json!({
                "request_identity": ".",
                "meaning_digest": meaning_digest,
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<ExploratoryReplayReadbackQueryV2>(json!({
                "meaning_digest": format!("sha256:{}", "a".repeat(64)),
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<ExploratoryReplayReadbackQueryV2>(json!({
                "request_identity": ".",
                "meaning_digest": format!("sha256:{}", "a".repeat(64)),
                "smuggled": true,
            }))
            .is_err()
        );
    }

    #[rstest]
    #[case(" request-1", &format!("sha256:{}", "a".repeat(64)))]
    #[case("request-1", "sha256:short")]
    fn readback_selector_rejects_invalid_values_without_owner_access(
        #[case] request_identity: &str,
        #[case] meaning_digest: &str,
    ) {
        assert!(
            readback_selector(request_identity.to_string(), meaning_digest.to_string()).is_err()
        );
    }

    #[rstest]
    fn resolve_body_is_exact_and_owner_errors_map_to_required_statuses() {
        assert!(
            serde_json::from_value::<ExploratoryReplayResolveRequestV2>(
                json!({ "meaning_digest": format!("blake3:{}", "a".repeat(64)) })
            )
            .is_ok()
        );
        assert!(
            serde_json::from_value::<ExploratoryReplayResolveRequestV2>(json!({
                "meaning_digest": format!("blake3:{}", "a".repeat(64)),
                "rerun": true
            }))
            .is_err()
        );
        assert_eq!(
            owner_error(&ExploratoryReplayOwnerError::ConflictingReplay, "request-1").status(),
            StatusCode::CONFLICT
        );
        assert_eq!(
            owner_error(
                &ExploratoryReplayOwnerError::InvalidProposal("request"),
                "request-1"
            )
            .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            owner_error(
                &ExploratoryReplayOwnerError::Unavailable("storage".into()),
                "request-1"
            )
            .status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }

    #[rstest]
    fn execution_input_binding_conflict_is_not_offered_as_retryable() {
        assert_eq!(
            execution_input_binding_error(
                &NativeReplayExecutionInputBindingErrorV1::Conflict,
                "request-1"
            )
            .status(),
            StatusCode::CONFLICT
        );
        assert_eq!(
            execution_input_binding_error(
                &NativeReplayExecutionInputBindingErrorV1::Unavailable,
                "request-1"
            )
            .status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
        assert_eq!(
            execution_input_binding_error(
                &NativeReplayExecutionInputBindingErrorV1::Storage(sqlx::Error::PoolTimedOut),
                "request-1"
            )
            .status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }

    /// The two causes are one status and one code on the wire; the log is where they come apart.
    #[rstest]
    #[case::authority(
        ProductEdgeError::Unavailable(ProductEdgeUnavailableV1::about(
            ProductEdgeUnavailableReasonV1::Missing,
            ProductEdgeSubjectKindV1::Admission,
            "exploratory-replay-authority",
        )),
        "exploratory-replay-authority",
        "Product Edge authority unavailable",
        StatusCode::SERVICE_UNAVAILABLE
    )]
    #[case::storage(
        ProductEdgeError::Storage("exploratory-replay-storage".to_string()),
        "exploratory-replay-storage",
        "Product Edge storage unavailable",
        StatusCode::SERVICE_UNAVAILABLE,
    )]
    fn an_unavailable_refusal_names_its_cause_in_the_log(
        #[case] error: ProductEdgeError,
        #[case] detail: &str,
        #[case] message: &str,
        #[case] status: StatusCode,
    ) {
        let (response, written) =
            crate::log_capture::capture(|| product_edge_error(&error, "request-1"));

        assert_eq!(response.status(), status, "{written}");
        assert!(written.contains("WARN"), "{written}");
        assert!(written.contains(detail), "{written}");
        assert!(written.contains(message), "{written}");
    }
}
