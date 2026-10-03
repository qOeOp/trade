//! Two Market Data reads a caller composing a universe-member Replay over a new snapshot needs:
//!
//! - `POST /v1/market-data/source-bindings/market-semantics-scope-value` answers the value a Source
//!   Binding's compatibility scope states, which a Market Semantics fact for a new snapshot under
//!   that binding must restate;
//! - `POST /v1/market-data/universe-member-composition-bases` answers the four locators a
//!   universe-member composition names besides the snapshot and its binding, under the field names
//!   the issuance command takes them by.
//!
//! Both are Market Data's own functions, run by the R&D Owner through the `market_data_rd_api`
//! surface it already reads Market Data by, in a transaction that is read only and rolled back. They
//! decide nothing: the fact admission and the issuance that consume an answer re-derive and check
//! it. Every refusal Market Data names answers by its own code; none becomes a `404`, because a
//! record Market Data does not hold is an answer about this request, not a missing route.

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
use serde_json::json;
use vibe_data::owner::{
    market_semantics_admission_v1::{
        MarketSemanticsScopeValueErrorV1, MarketSemanticsScopeValueV1,
        MarketSemanticsValueSubmissionV1,
    },
    pit_snapshot::UntrustedPitSnapshotLocator,
    replay_market_facts_v2::{
        ReplayCompositionContentLocatorV1, ReplayCompositionRequestLocatorV1,
    },
    source_binding::{BindingDigest, UntrustedSourceBindingLocator},
    universe_member_composition_basis_v1::{
        UniverseMemberCompositionBasisErrorV1, UniverseMemberCompositionBasisV1,
    },
};
use vibe_strategy_factory::product_edge_postgres::PostgresResearchGoalOwnerV1;

use super::{authorized, insert_rejection_code};

#[derive(Clone)]
struct MarketDataCompositionReadsStateV1 {
    owner: Arc<PostgresResearchGoalOwnerV1>,
    token_digest: [u8; 32],
}

pub(super) fn router(owner: Arc<PostgresResearchGoalOwnerV1>, token_digest: [u8; 32]) -> Router {
    Router::new()
        .route(
            "/v1/market-data/source-bindings/market-semantics-scope-value",
            post(read_market_semantics_scope_value),
        )
        .route(
            "/v1/market-data/universe-member-composition-bases",
            post(read_universe_member_composition_basis),
        )
        .with_state(MarketDataCompositionReadsStateV1 {
            owner,
            token_digest,
        })
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct MarketSemanticsScopeValueRequestV1 {
    source_binding: UntrustedSourceBindingLocator,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct UniverseMemberCompositionBasisRequestV1 {
    pit_snapshot: UntrustedPitSnapshotLocator,
    source_binding: UntrustedSourceBindingLocator,
}

/// The scope a binding's semantics derive and the value its heads state; `value` is `null` while
/// the scope has no head, when a first fact may state any value.
#[derive(Debug, Serialize)]
struct MarketSemanticsScopeValueResponseV1<'a> {
    compatibility_scope_identity: BindingDigest,
    value: Option<&'a MarketSemanticsValueSubmissionV1>,
}

impl<'a> From<&'a MarketSemanticsScopeValueV1> for MarketSemanticsScopeValueResponseV1<'a> {
    fn from(scope: &'a MarketSemanticsScopeValueV1) -> Self {
        Self {
            compatibility_scope_identity: scope.compatibility_scope_identity(),
            value: scope.value(),
        }
    }
}

/// The basis under the issuance command's own field names, so a caller copies each one across.
#[derive(Debug, Serialize)]
#[allow(
    clippy::struct_field_names,
    reason = "each field is the issuance command's field of the same name"
)]
struct UniverseMemberCompositionBasisResponseV1 {
    universe_selection_locator: ReplayCompositionRequestLocatorV1,
    reference_fact_r0_locator: ReplayCompositionRequestLocatorV1,
    market_semantics_locator: ReplayCompositionRequestLocatorV1,
    correction_policy_locator: ReplayCompositionContentLocatorV1,
}

impl From<UniverseMemberCompositionBasisV1> for UniverseMemberCompositionBasisResponseV1 {
    fn from(basis: UniverseMemberCompositionBasisV1) -> Self {
        Self {
            universe_selection_locator: basis.universe_selection_locator(),
            reference_fact_r0_locator: basis.reference_fact_r0_locator(),
            market_semantics_locator: basis.market_semantics_locator(),
            correction_policy_locator: basis.correction_policy_locator(),
        }
    }
}

async fn read_market_semantics_scope_value(
    State(state): State<MarketDataCompositionReadsStateV1>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(StatusCode::FORBIDDEN, "UNAUTHORIZED_PRODUCT_EDGE");
    }
    let Ok(request) = serde_json::from_slice::<MarketSemanticsScopeValueRequestV1>(&body) else {
        return rejection(StatusCode::BAD_REQUEST, "MALFORMED_TYPED_REQUEST");
    };

    match state
        .owner
        .read_market_semantics_scope_value_v1(&request.source_binding)
        .await
    {
        Ok(scope) => (
            StatusCode::OK,
            Json(MarketSemanticsScopeValueResponseV1::from(&scope)),
        )
            .into_response(),
        Err(e) => market_semantics_scope_value_error(e),
    }
}

async fn read_universe_member_composition_basis(
    State(state): State<MarketDataCompositionReadsStateV1>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(StatusCode::FORBIDDEN, "UNAUTHORIZED_PRODUCT_EDGE");
    }
    let Ok(request) = serde_json::from_slice::<UniverseMemberCompositionBasisRequestV1>(&body)
    else {
        return rejection(StatusCode::BAD_REQUEST, "MALFORMED_TYPED_REQUEST");
    };

    match state
        .owner
        .read_universe_member_composition_basis_v1(&request.pit_snapshot, &request.source_binding)
        .await
    {
        Ok(basis) => (
            StatusCode::OK,
            Json(UniverseMemberCompositionBasisResponseV1::from(basis)),
        )
            .into_response(),
        Err(e) => universe_member_composition_basis_error(e),
    }
}

fn market_semantics_scope_value_error(error: MarketSemanticsScopeValueErrorV1) -> Response {
    let (status, code) = match error {
        MarketSemanticsScopeValueErrorV1::SourceBindingUnavailable => (
            StatusCode::CONFLICT,
            "MARKET_SEMANTICS_SCOPE_SOURCE_BINDING_UNAVAILABLE",
        ),
        MarketSemanticsScopeValueErrorV1::StoreUnavailable => (
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_DATA_OWNER_UNAVAILABLE",
        ),
    };
    rejection(status, code)
}

fn universe_member_composition_basis_error(
    error: UniverseMemberCompositionBasisErrorV1,
) -> Response {
    let (status, code) = match error {
        UniverseMemberCompositionBasisErrorV1::PitUnavailable => {
            (StatusCode::CONFLICT, "COMPOSITION_BASIS_PIT_UNAVAILABLE")
        }
        UniverseMemberCompositionBasisErrorV1::SourceBindingMismatch => (
            StatusCode::CONFLICT,
            "COMPOSITION_BASIS_SOURCE_BINDING_MISMATCH",
        ),
        UniverseMemberCompositionBasisErrorV1::SourceBindingUnavailable => (
            StatusCode::CONFLICT,
            "COMPOSITION_BASIS_SOURCE_BINDING_UNAVAILABLE",
        ),
        UniverseMemberCompositionBasisErrorV1::MarketSemanticsNotAdmitted => (
            StatusCode::CONFLICT,
            "COMPOSITION_BASIS_MARKET_SEMANTICS_NOT_ADMITTED",
        ),
        UniverseMemberCompositionBasisErrorV1::StoreUnavailable => (
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

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use rstest::rstest;

    use super::*;

    /// Every refusal Market Data names reaches the caller under a code of its own, and none of them
    /// is a `404`.
    #[rstest]
    fn each_refusal_answers_by_its_own_code() {
        let scope = [
            MarketSemanticsScopeValueErrorV1::SourceBindingUnavailable,
            MarketSemanticsScopeValueErrorV1::StoreUnavailable,
        ]
        .map(market_semantics_scope_value_error);
        let basis = [
            UniverseMemberCompositionBasisErrorV1::PitUnavailable,
            UniverseMemberCompositionBasisErrorV1::SourceBindingMismatch,
            UniverseMemberCompositionBasisErrorV1::SourceBindingUnavailable,
            UniverseMemberCompositionBasisErrorV1::MarketSemanticsNotAdmitted,
            UniverseMemberCompositionBasisErrorV1::StoreUnavailable,
        ]
        .map(universe_member_composition_basis_error);

        for responses in [&scope[..], &basis[..]] {
            let codes: BTreeSet<_> = responses
                .iter()
                .map(|response| {
                    assert_ne!(response.status(), StatusCode::NOT_FOUND);
                    response.headers()["x-rd-rejection-code"].clone()
                })
                .collect();
            assert_eq!(codes.len(), responses.len());
        }
    }
}
