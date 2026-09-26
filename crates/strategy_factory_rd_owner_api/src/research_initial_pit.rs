//! `POST /v3/research-goals/{request_identity}/initial-pit`: issues, or resolves, the initial PIT
//! request of one accepted V3 Research request.
//!
//! The step is separate from acceptance, as the R&D Owner contract states, and repeating it is safe:
//! the Owner returns a recorded terminal as it is and resolves a lost send by correlation. Every
//! answer carries the Research readback, whose `initial_pit` states where the request stands; a
//! refusal adds its code in `x-rd-rejection-code`.
//!
//! Market Data is reached through the same two admission ports its own routes use. The route is
//! absent in effect - it answers `MARKET_DATA_UNAVAILABLE` - when either port is not configured.

use std::sync::Arc;

use axum::{
    Json, Router,
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use vibe_strategy_factory::{
    product_edge::ResearchReadbackOwnerPortV1,
    product_edge_postgres::{
        PostgresResearchGoalOwnerV1,
        research_initial_pit::{MarketDataInitialPitPortsV1, ResearchInitialPitErrorV1},
    },
};

use super::{
    authorized, insert_rejection_code, owner_error_v2, rejection_v2, research_preflight_refusal,
};

#[derive(Clone)]
struct ResearchInitialPitApiState {
    owner: Arc<PostgresResearchGoalOwnerV1>,
    market_data: Option<MarketDataInitialPitPortsV1>,
    token_digest: [u8; 32],
}

pub(super) fn router(
    owner: Arc<PostgresResearchGoalOwnerV1>,
    market_data: Option<MarketDataInitialPitPortsV1>,
    token_digest: [u8; 32],
) -> Router {
    Router::new()
        .route(
            "/v3/research-goals/{request_identity}/initial-pit",
            post(issue_initial_pit),
        )
        .with_state(ResearchInitialPitApiState {
            owner,
            market_data,
            token_digest,
        })
}

async fn issue_initial_pit(
    State(state): State<ResearchInitialPitApiState>,
    Path(request_identity): Path<String>,
    headers: HeaderMap,
    _body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection_v2(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            &request_identity,
        );
    }

    if let Some(refusal) = research_preflight_refusal(
        state
            .owner
            .preflight_request_identity(&request_identity)
            .await,
        &request_identity,
    ) {
        return refusal;
    }
    let Some(market_data) = &state.market_data else {
        return rejection_v2(
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_DATA_UNAVAILABLE",
            &request_identity,
        );
    };
    let refusal = match state
        .owner
        .issue_research_initial_pit_v1(&request_identity, market_data)
        .await
    {
        Ok(_) => None,
        Err(e) => Some(initial_pit_refusal(&e)),
    };

    match state.owner.read_research_v2(&request_identity).await {
        Ok(result) => {
            let (status, code) = refusal.unwrap_or((StatusCode::OK, ""));
            let mut response = (status, Json(result)).into_response();

            if !code.is_empty() {
                insert_rejection_code(&mut response, code);
            }
            response
        }
        Err(e) => owner_error_v2(&e, &request_identity),
    }
}

/// The status and code of a named refusal. Each cause keeps its own code.
fn initial_pit_refusal(error: &ResearchInitialPitErrorV1) -> (StatusCode, &'static str) {
    match error {
        ResearchInitialPitErrorV1::UnknownRequest => {
            (StatusCode::NOT_FOUND, "RESEARCH_REQUEST_UNKNOWN")
        }
        ResearchInitialPitErrorV1::NotAccepted => {
            (StatusCode::CONFLICT, "RESEARCH_REQUEST_NOT_ACCEPTED")
        }
        ResearchInitialPitErrorV1::NoInstrumentScope => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "RESEARCH_REQUEST_STATES_NO_INSTRUMENT_SCOPE",
        ),
        ResearchInitialPitErrorV1::InstrumentScopeNotEligible => (
            StatusCode::CONFLICT,
            "INSTRUMENT_SCOPE_NOT_ELIGIBLE_AT_ISSUE",
        ),
        ResearchInitialPitErrorV1::SourceBindingLineagesDiffer => (
            StatusCode::CONFLICT,
            "INSTRUMENT_SCOPE_SOURCE_BINDING_LINEAGES_DIFFER",
        ),
        ResearchInitialPitErrorV1::SourceBindingUnavailable => (
            StatusCode::CONFLICT,
            "INSTRUMENT_SCOPE_SOURCE_BINDING_UNAVAILABLE",
        ),
        ResearchInitialPitErrorV1::FrontierMoved => {
            (StatusCode::CONFLICT, "ELIGIBLE_INSTRUMENT_FRONTIER_MOVED")
        }
        ResearchInitialPitErrorV1::MarketDataUnavailable => {
            (StatusCode::SERVICE_UNAVAILABLE, "MARKET_DATA_UNAVAILABLE")
        }
        // Market Data refused a request this Owner froze: a defect on one side of the contract,
        // named by Market Data's own refusal.
        ResearchInitialPitErrorV1::RefusedByMarketData(code) => (StatusCode::BAD_GATEWAY, code),
        ResearchInitialPitErrorV1::TerminalUnattributable => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "INITIAL_PIT_TERMINAL_UNATTRIBUTABLE",
        ),
        ResearchInitialPitErrorV1::Storage(_) => {
            (StatusCode::SERVICE_UNAVAILABLE, "OWNER_UNAVAILABLE")
        }
    }
}
