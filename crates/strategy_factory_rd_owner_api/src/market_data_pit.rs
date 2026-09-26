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
    instrument_master_admission_v1::{
        InstrumentMasterAdmissionErrorV1, InstrumentMasterAdmissionV1,
        InstrumentMasterFactSubmissionV1,
    },
    market_semantics_admission_v1::{
        MarketSemanticsAdmissionErrorV1, MarketSemanticsAdmissionV1,
        MarketSemanticsFactSubmissionV1,
    },
    pit_market_snapshot_intake_v1::{PitMarketSnapshotIntakeErrorV1, PitMarketSnapshotIntakeV1},
    pit_snapshot::UntrustedPitSnapshotRequest,
    source_binding::BindingDigest,
    source_binding_admission_v1::{
        SourceBindingAdmissionErrorV1, SourceBindingAdmissionRequestV1, SourceBindingAdmissionV1,
    },
    strategy_design_role_set::StrategyDesignRoleSetLocatorV1,
    strategy_input_binding_admission_v1::{
        StrategyInputBindingAdmissionErrorV1, StrategyInputBindingAdmissionV1,
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
    bindings: Option<Arc<dyn StrategyInputBindingAdmissionV1>>,
    instruments: Option<Arc<dyn InstrumentMasterAdmissionV1>>,
    semantics: Option<Arc<dyn MarketSemanticsAdmissionV1>>,
    token_digest: [u8; 32],
}

pub(super) fn router(
    intake: Option<Arc<dyn PitMarketSnapshotIntakeV1>>,
    admission: Option<Arc<dyn SourceBindingAdmissionV1>>,
    universe: Option<Arc<dyn UniverseSelectionAdmissionV1>>,
    bindings: Option<Arc<dyn StrategyInputBindingAdmissionV1>>,
    instruments: Option<Arc<dyn InstrumentMasterAdmissionV1>>,
    semantics: Option<Arc<dyn MarketSemanticsAdmissionV1>>,
    token_digest: [u8; 32],
) -> Router {
    Router::new()
        .route(
            "/v1/market-data/instrument-master-facts",
            post(admit_instrument_master_fact),
        )
        .route(
            "/v1/market-data/market-semantics",
            post(admit_market_semantics_fact),
        )
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
        .route(
            "/v1/market-data/strategy-input-bindings",
            post(declare_strategy_input_bindings),
        )
        .route(
            "/v1/market-data/strategy-input-bindings/from-design-intent",
            post(declare_strategy_input_bindings_from_design_intent),
        )
        .with_state(MarketDataPitApiState {
            intake,
            admission,
            universe,
            bindings,
            instruments,
            semantics,
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

/// Admits one Instrument Master V1 fact Operations describes.
///
/// The body is the fact's meaning and nothing about its custody. The Owner binds it to its own
/// current clock head and refuses a predecessor it does not hold; a replayed body rejoins the
/// fact it admitted before.
async fn admit_instrument_master_fact(
    State(state): State<MarketDataPitApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(StatusCode::FORBIDDEN, "UNAUTHORIZED_PRODUCT_EDGE");
    }
    let Some(instruments) = state.instruments else {
        return rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_DATA_INSTRUMENT_MASTER_UNAVAILABLE",
        );
    };
    let submission: InstrumentMasterFactSubmissionV1 = match serde_json::from_slice(&body) {
        Ok(submission) => submission,
        Err(_) => return rejection(StatusCode::BAD_REQUEST, "MALFORMED_TYPED_REQUEST"),
    };

    match instruments.admit_fact(submission).await {
        Ok(terminal) => (StatusCode::OK, Json(terminal)).into_response(),
        Err(e) => instrument_master_error(e),
    }
}

/// Admits one Market Semantics fact Operations states about an admitted binding.
///
/// The body names the binding and the `AVAILABLE` snapshot the statement is made against, plus the
/// typed value and its effective regime. The Owner derives the compatibility scope from the
/// binding's own semantics and resolves every other coordinate from its own custody.
async fn admit_market_semantics_fact(
    State(state): State<MarketDataPitApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(StatusCode::FORBIDDEN, "UNAUTHORIZED_PRODUCT_EDGE");
    }
    let Some(semantics) = state.semantics else {
        return rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_DATA_MARKET_SEMANTICS_UNAVAILABLE",
        );
    };
    let submission: MarketSemanticsFactSubmissionV1 = match serde_json::from_slice(&body) {
        Ok(submission) => submission,
        Err(_) => return rejection(StatusCode::BAD_REQUEST, "MALFORMED_TYPED_REQUEST"),
    };

    match semantics.admit_fact(submission).await {
        Ok(terminal) => (StatusCode::OK, Json(terminal)).into_response(),
        Err(e) => market_semantics_error(e),
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
        UniverseSelectionAdmissionErrorV1::FrontierNotCurrent => (
            StatusCode::CONFLICT,
            "UNIVERSE_SELECTION_FRONTIER_NOT_CURRENT",
        ),
        UniverseSelectionAdmissionErrorV1::FixedMemberUnresolved => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "UNIVERSE_SELECTION_MEMBER_UNRESOLVED",
        ),
        UniverseSelectionAdmissionErrorV1::FixedMemberNotInFrontier => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "UNIVERSE_SELECTION_MEMBER_NOT_IN_FRONTIER",
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
        PitMarketSnapshotIntakeErrorV1::InstrumentMasterUnavailable => {
            (StatusCode::CONFLICT, "PIT_INSTRUMENT_MASTER_UNAVAILABLE")
        }
        PitMarketSnapshotIntakeErrorV1::UniverseMemberCountUnadmitted => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "PIT_UNIVERSE_MEMBER_COUNT_UNADMITTED",
        ),
        PitMarketSnapshotIntakeErrorV1::UniverseMemberKeyIsNotInstrument => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "PIT_UNIVERSE_MEMBER_KEY_IS_NOT_INSTRUMENT",
        ),
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

/// Declares every input role of the Design one Composer attestation authenticates.
///
/// The body is the Composer locator and nothing else. A Design cannot name a snapshot here even if
/// it wanted to, which is the whole point: the Owner reads R&D's own attestation and then resolves
/// its own custody. An unavailable binding arrives with the reason that made it unavailable, because
/// "no snapshot answers this role" and "two lineages answer it" are different facts about the
/// Design and a caller that cannot tell them apart cannot act on either.
async fn declare_strategy_input_bindings(
    State(state): State<MarketDataPitApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(StatusCode::FORBIDDEN, "UNAUTHORIZED_PRODUCT_EDGE");
    }
    let Some(bindings) = state.bindings else {
        return rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_DATA_STRATEGY_INPUT_BINDINGS_UNAVAILABLE",
        );
    };
    let locator: StrategyDesignRoleSetLocatorV1 = match serde_json::from_slice(&body) {
        Ok(locator) => locator,
        Err(_) => return rejection(StatusCode::BAD_REQUEST, "MALFORMED_TYPED_REQUEST"),
    };

    match bindings.admit(locator).await {
        Ok(terminal) => (StatusCode::OK, Json(terminal)).into_response(),
        Err(e) => strategy_input_binding_error(
            e,
            "COMPOSER_ATTESTATION_UNKNOWN",
            "COMPOSER_ATTESTATION_UNTRUSTED",
        ),
    }
}

/// Declares every input role of the Design one published R&D role intent authenticates.
///
/// The body is the Design identity and nothing else. This is the route that opens a Design's first
/// cycle: until a Composer has run there is no attestation to name, because the program whose
/// operation would be attested cannot exist before the receipts this call issues. Everything the
/// Owner does afterwards is the same as on the attestation route, including the write-once custody,
/// so the two routes cannot disagree about one Design.
async fn declare_strategy_input_bindings_from_design_intent(
    State(state): State<MarketDataPitApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(StatusCode::FORBIDDEN, "UNAUTHORIZED_PRODUCT_EDGE");
    }
    let Some(bindings) = state.bindings else {
        return rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_DATA_STRATEGY_INPUT_BINDINGS_UNAVAILABLE",
        );
    };
    let request: PublishedDesignLocatorV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => return rejection(StatusCode::BAD_REQUEST, "MALFORMED_TYPED_REQUEST"),
    };

    match bindings
        .admit_published_design(request.design_identity)
        .await
    {
        Ok(terminal) => (StatusCode::OK, Json(terminal)).into_response(),
        Err(e) => strategy_input_binding_error(
            e,
            "DESIGN_ROLE_INTENT_UNKNOWN",
            "DESIGN_ROLE_INTENT_UNTRUSTED",
        ),
    }
}

/// The whole body of a Design-intent admission: which Design R&D published.
///
/// Nothing else is accepted, because nothing else would be believed. The roles, the Research
/// custody and the digest all come from what R&D published under this identity.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PublishedDesignLocatorV1 {
    design_identity: BindingDigest,
}

/// Projects one admission refusal onto the wire.
///
/// The two shapes that can authenticate a Design fail in the same categories but are not the same
/// thing to a caller, so each route names its own shape in the two codes that mention one.
fn strategy_input_binding_error(
    error: StrategyInputBindingAdmissionErrorV1,
    unknown_code: &'static str,
    untrusted_code: &'static str,
) -> Response {
    let (status, code) = match error {
        StrategyInputBindingAdmissionErrorV1::UnknownAuthenticatedDesign => {
            (StatusCode::NOT_FOUND, unknown_code)
        }
        StrategyInputBindingAdmissionErrorV1::AuthenticatedDesignUntrusted => {
            (StatusCode::CONFLICT, untrusted_code)
        }
        StrategyInputBindingAdmissionErrorV1::UnsupportedRole => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "STRATEGY_INPUT_ROLE_UNSUPPORTED",
        ),
        StrategyInputBindingAdmissionErrorV1::InitialPitRequestUnnamed => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "STRATEGY_INPUT_INITIAL_PIT_REQUEST_UNNAMED",
        ),
        StrategyInputBindingAdmissionErrorV1::InitialPitRequestUnknown => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "STRATEGY_INPUT_INITIAL_PIT_REQUEST_UNKNOWN",
        ),
        StrategyInputBindingAdmissionErrorV1::InitialPitRequestDigestMismatch => (
            StatusCode::CONFLICT,
            "STRATEGY_INPUT_INITIAL_PIT_REQUEST_DIGEST_MISMATCH",
        ),
        StrategyInputBindingAdmissionErrorV1::InitialPitRequestNotAvailable => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "STRATEGY_INPUT_INITIAL_PIT_REQUEST_NOT_AVAILABLE",
        ),
        StrategyInputBindingAdmissionErrorV1::InitialPitRequestRequesterMismatch => (
            StatusCode::CONFLICT,
            "STRATEGY_INPUT_INITIAL_PIT_REQUEST_REQUESTER_MISMATCH",
        ),
        StrategyInputBindingAdmissionErrorV1::NoMatchingSnapshot => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "STRATEGY_INPUT_SNAPSHOT_UNAVAILABLE",
        ),
        StrategyInputBindingAdmissionErrorV1::AmbiguousSnapshot => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "STRATEGY_INPUT_SNAPSHOT_AMBIGUOUS",
        ),
        StrategyInputBindingAdmissionErrorV1::SplitCoordinate => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "STRATEGY_INPUT_COORDINATE_SPLIT",
        ),
        StrategyInputBindingAdmissionErrorV1::RequestConflict => {
            (StatusCode::CONFLICT, "STRATEGY_INPUT_DECLARATION_CONFLICT")
        }
        StrategyInputBindingAdmissionErrorV1::BindingUnavailable => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "STRATEGY_INPUT_BINDING_UNAVAILABLE",
        ),
        StrategyInputBindingAdmissionErrorV1::StoreUnavailable => (
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_DATA_OWNER_UNAVAILABLE",
        ),
    };
    rejection(status, code)
}

fn market_semantics_error(error: MarketSemanticsAdmissionErrorV1) -> Response {
    let (status, code) = match error {
        MarketSemanticsAdmissionErrorV1::InvalidSubmission => (
            StatusCode::BAD_REQUEST,
            "INVALID_MARKET_SEMANTICS_SUBMISSION",
        ),
        MarketSemanticsAdmissionErrorV1::DependencyUnavailable => (
            StatusCode::CONFLICT,
            "MARKET_SEMANTICS_DEPENDENCY_UNAVAILABLE",
        ),
        MarketSemanticsAdmissionErrorV1::AdmissionConflict => {
            (StatusCode::CONFLICT, "MARKET_SEMANTICS_ADMISSION_CONFLICT")
        }
        MarketSemanticsAdmissionErrorV1::SnapshotValueConflict => (
            StatusCode::CONFLICT,
            "MARKET_SEMANTICS_SNAPSHOT_VALUE_CONFLICT",
        ),
        MarketSemanticsAdmissionErrorV1::ScopeValueConflict => (
            StatusCode::CONFLICT,
            "MARKET_SEMANTICS_SCOPE_VALUE_CONFLICT",
        ),
        MarketSemanticsAdmissionErrorV1::StoreUnavailable => (
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_DATA_OWNER_UNAVAILABLE",
        ),
    };
    rejection(status, code)
}

fn instrument_master_error(error: InstrumentMasterAdmissionErrorV1) -> Response {
    let (status, code) = match error {
        InstrumentMasterAdmissionErrorV1::InvalidSubmission => (
            StatusCode::BAD_REQUEST,
            "INVALID_INSTRUMENT_MASTER_SUBMISSION",
        ),
        InstrumentMasterAdmissionErrorV1::PredecessorUnavailable => (
            StatusCode::CONFLICT,
            "INSTRUMENT_MASTER_PREDECESSOR_UNAVAILABLE",
        ),
        InstrumentMasterAdmissionErrorV1::AdmissionConflict => {
            (StatusCode::CONFLICT, "INSTRUMENT_MASTER_ADMISSION_CONFLICT")
        }
        InstrumentMasterAdmissionErrorV1::ClockUnavailable => (
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_DATA_CLOCK_UNAVAILABLE",
        ),
        InstrumentMasterAdmissionErrorV1::StoreUnavailable => (
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
