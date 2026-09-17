//! Authenticated transport for the Market Data Owner's own intakes.
//!
//! These are the first routes on which Market Data answers for itself. Operations admits a Source
//! Binding here and R&D freezes a PIT Market Snapshot Request against the Owner's published
//! decision cut; this adapter carries bytes and decides nothing. It never sees a pool, a clock, a
//! raw observation or a disposition it could author, and a refusal from the Owner arrives as a
//! terminal in the response body rather than as an HTTP error, because a decided negative is an
//! answer.
//!
//! When the deployment has not configured a Data Client the intake is absent and every PIT route
//! answers `503`. That is the honest state: without a retrieval path Market Data has nothing to
//! observe, and a route that pretended otherwise would mint an empty snapshot.

use std::sync::Arc;

use axum::{
    Json, Router,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use serde::Deserialize;
use serde_json::json;
use vibe_data::owner::{
    pit_market_snapshot_intake_v1::{PitMarketSnapshotIntakeErrorV1, PitMarketSnapshotIntakeV1},
    pit_snapshot::UntrustedPitSnapshotRequest,
    source_binding::BindingDigest,
    source_binding_admission_v1::{
        SourceBindingAdmissionErrorV1, SourceBindingAdmissionRequestV1, SourceBindingAdmissionV1,
    },
    universe_selection::{
        UntrustedUniverseSelectionLocatorV1, UntrustedUniverseSelectionRequestV1,
    },
    universe_selection_admission_v1::{
        HistoricalMembershipAdmissionRequestV1, UniverseSelectionAdmissionErrorV1,
        UniverseSelectionAdmissionV1,
    },
};

use super::{authorized, insert_rejection_code};

/// One frozen request and the evaluated Universe Selection Record it is bound to.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PitMarketSnapshotSubmissionV1 {
    request: UntrustedPitSnapshotRequest,
    universe_selection: UntrustedUniverseSelectionLocatorV1,
}

/// The selection rule a requester states, as the Owner's request constructor takes it.
///
/// The request's meaning digest is derived by Market Data from this content, never supplied, so a
/// caller cannot bind one meaning to another request's identity.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct UniverseSelectionSubmissionV1 {
    request_identity: BindingDigest,
    requester_role: String,
    selection_rule_identity: BindingDigest,
    selection_rule_bytes: Vec<u8>,
    eligible_instrument_frontier: BindingDigest,
    effective_at_ns: i128,
    owner_observation_ns: i128,
    decision_cut: u64,
    source_binding_lineage_root: BindingDigest,
    correction_frontier_digest: BindingDigest,
    stable_correlation: BindingDigest,
}

impl UniverseSelectionSubmissionV1 {
    fn into_request(self) -> UntrustedUniverseSelectionRequestV1 {
        UntrustedUniverseSelectionRequestV1::new(
            self.request_identity,
            self.requester_role,
            self.selection_rule_identity,
            self.selection_rule_bytes,
            self.eligible_instrument_frontier,
            self.effective_at_ns,
            self.owner_observation_ns,
            self.decision_cut,
            self.source_binding_lineage_root,
            self.correction_frontier_digest,
            self.stable_correlation,
        )
    }
}

#[derive(Clone)]
struct MarketDataPitApiState {
    intake: Option<Arc<dyn PitMarketSnapshotIntakeV1>>,
    admission: Option<Arc<dyn SourceBindingAdmissionV1>>,
    universe: Option<Arc<dyn UniverseSelectionAdmissionV1>>,
    token_digest: [u8; 32],
}

pub(super) fn router(
    intake: Option<Arc<dyn PitMarketSnapshotIntakeV1>>,
    admission: Option<Arc<dyn SourceBindingAdmissionV1>>,
    universe: Option<Arc<dyn UniverseSelectionAdmissionV1>>,
    token_digest: [u8; 32],
) -> Router {
    Router::new()
        .route(
            "/v1/market-data/source-bindings",
            post(admit_source_binding),
        )
        .route(
            "/v1/market-data/historical-memberships",
            post(admit_historical_membership),
        )
        .route(
            "/v1/market-data/universe-selections",
            post(evaluate_universe_selection),
        )
        .route(
            "/v1/market-data/pit-market-snapshot-requests",
            post(submit_pit_market_snapshot_request),
        )
        .route(
            "/v1/market-data/pit-market-snapshot-requests/decision-cut",
            post(resolve_decision_cut),
        )
        .with_state(MarketDataPitApiState {
            intake,
            admission,
            universe,
            token_digest,
        })
}

async fn admit_source_binding(
    State(state): State<MarketDataPitApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(StatusCode::FORBIDDEN, "UNAUTHORIZED_PRODUCT_EDGE");
    }
    let Some(admission) = state.admission else {
        return rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_DATA_ADMISSION_UNAVAILABLE",
        );
    };
    let request: SourceBindingAdmissionRequestV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => return rejection(StatusCode::BAD_REQUEST, "MALFORMED_TYPED_REQUEST"),
    };

    match admission.admit(request).await {
        Ok(terminal) => (StatusCode::OK, Json(terminal)).into_response(),
        Err(e) => admission_error(e),
    }
}

async fn admit_historical_membership(
    State(state): State<MarketDataPitApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(StatusCode::FORBIDDEN, "UNAUTHORIZED_PRODUCT_EDGE");
    }
    let Some(universe) = state.universe else {
        return rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_DATA_UNIVERSE_UNAVAILABLE",
        );
    };
    let request: HistoricalMembershipAdmissionRequestV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => return rejection(StatusCode::BAD_REQUEST, "MALFORMED_TYPED_REQUEST"),
    };

    match universe.admit_membership(request).await {
        Ok(()) => (StatusCode::OK, Json(json!({ "admitted": true }))).into_response(),
        Err(e) => universe_error(e),
    }
}

async fn evaluate_universe_selection(
    State(state): State<MarketDataPitApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(StatusCode::FORBIDDEN, "UNAUTHORIZED_PRODUCT_EDGE");
    }
    let Some(universe) = state.universe else {
        return rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_DATA_UNIVERSE_UNAVAILABLE",
        );
    };
    let submission: UniverseSelectionSubmissionV1 = match serde_json::from_slice(&body) {
        Ok(submission) => submission,
        Err(_) => return rejection(StatusCode::BAD_REQUEST, "MALFORMED_TYPED_REQUEST"),
    };

    match universe.evaluate(submission.into_request()).await {
        Ok(terminal) => (StatusCode::OK, Json(terminal)).into_response(),
        Err(e) => universe_error(e),
    }
}

fn universe_error(error: UniverseSelectionAdmissionErrorV1) -> Response {
    let (status, code) = match error {
        UniverseSelectionAdmissionErrorV1::InvalidRequest => (
            StatusCode::BAD_REQUEST,
            "INVALID_UNIVERSE_SELECTION_REQUEST",
        ),
        UniverseSelectionAdmissionErrorV1::RequestConflict => {
            (StatusCode::CONFLICT, "UNIVERSE_SELECTION_CONFLICT")
        }
        UniverseSelectionAdmissionErrorV1::UnknownIdentity => {
            (StatusCode::NOT_FOUND, "UNIVERSE_SELECTION_NOT_FOUND")
        }
        UniverseSelectionAdmissionErrorV1::StoreUnavailable => (
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_DATA_OWNER_UNAVAILABLE",
        ),
    };
    rejection(status, code)
}

async fn submit_pit_market_snapshot_request(
    State(state): State<MarketDataPitApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(StatusCode::FORBIDDEN, "UNAUTHORIZED_PRODUCT_EDGE");
    }
    let Some(intake) = state.intake else {
        return rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_DATA_INTAKE_UNAVAILABLE",
        );
    };
    let submission: PitMarketSnapshotSubmissionV1 = match serde_json::from_slice(&body) {
        Ok(submission) => submission,
        Err(_) => return rejection(StatusCode::BAD_REQUEST, "MALFORMED_TYPED_REQUEST"),
    };

    match intake
        .submit(submission.request, submission.universe_selection)
        .await
    {
        // Every terminal is a 200, including `UNLICENSED` and `INSUFFICIENT`: Market Data decided.
        Ok(terminal) => (StatusCode::OK, Json(terminal)).into_response(),
        Err(e) => intake_error(e),
    }
}

async fn resolve_decision_cut(
    State(state): State<MarketDataPitApiState>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(StatusCode::FORBIDDEN, "UNAUTHORIZED_PRODUCT_EDGE");
    }
    let Some(intake) = state.intake else {
        return rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_DATA_INTAKE_UNAVAILABLE",
        );
    };

    match intake.current_decision_cut().await {
        Ok(cut) => (StatusCode::OK, Json(cut)).into_response(),
        Err(e) => intake_error(e),
    }
}

fn intake_error(error: PitMarketSnapshotIntakeErrorV1) -> Response {
    let (status, code) = match error {
        PitMarketSnapshotIntakeErrorV1::InvalidRequest => (
            StatusCode::BAD_REQUEST,
            "INVALID_PIT_MARKET_SNAPSHOT_REQUEST",
        ),
        PitMarketSnapshotIntakeErrorV1::SourceBindingUnavailable => {
            (StatusCode::CONFLICT, "PIT_SOURCE_BINDING_UNAVAILABLE")
        }
        PitMarketSnapshotIntakeErrorV1::ObservationUnavailable => {
            (StatusCode::CONFLICT, "PIT_OBSERVATION_SOURCE_UNAVAILABLE")
        }
        PitMarketSnapshotIntakeErrorV1::ObservationBatchInvalid => {
            (StatusCode::CONFLICT, "PIT_OBSERVATION_BATCH_INVALID")
        }
        PitMarketSnapshotIntakeErrorV1::RequestConflict => {
            (StatusCode::CONFLICT, "PIT_MARKET_SNAPSHOT_REQUEST_CONFLICT")
        }
        PitMarketSnapshotIntakeErrorV1::ClockUnavailable => (
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_DATA_CLOCK_UNAVAILABLE",
        ),
        PitMarketSnapshotIntakeErrorV1::StoreUnavailable => (
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_DATA_OWNER_UNAVAILABLE",
        ),
    };
    rejection(status, code)
}

fn admission_error(error: SourceBindingAdmissionErrorV1) -> Response {
    let (status, code) = match error {
        SourceBindingAdmissionErrorV1::InvalidProposal => {
            (StatusCode::BAD_REQUEST, "INVALID_SOURCE_BINDING_PROPOSAL")
        }
        SourceBindingAdmissionErrorV1::AdmissionConflict => {
            (StatusCode::CONFLICT, "SOURCE_BINDING_ADMISSION_CONFLICT")
        }
        SourceBindingAdmissionErrorV1::ClockUnavailable => (
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_DATA_CLOCK_UNAVAILABLE",
        ),
        SourceBindingAdmissionErrorV1::StoreUnavailable => (
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_DATA_OWNER_UNAVAILABLE",
        ),
    };
    rejection(status, code)
}

fn rejection(status: StatusCode, code: &str) -> Response {
    let mut response = (status, Json(json!({ "error": code }))).into_response();
    insert_rejection_code(&mut response, code);
    response
}
