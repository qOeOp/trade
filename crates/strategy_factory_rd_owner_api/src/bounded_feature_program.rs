//! Authenticated transport for the R&D joint Bounded Feature Program freeze.
//!
//! The caller declares one canonical `StrategyDesignV2` and one canonical
//! `BoundedFeatureProgramProposalV1`. This adapter mints neither. The R&D Owner admits the pair only
//! against currently accepted Research custody and the pinned primitive catalog, and it rejects a
//! second, different freeze for the same Research identity as a changed-meaning conflict.

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
use vibe_strategy_factory::rd_bounded_feature_program_postgres_v1::{
    PostgresResearchBoundedFeatureProgramOwnerV1, ResearchBoundedFeatureProgramFreezeReceiptV1,
    ResearchBoundedFeatureProgramFreezeRequestV1, ResearchBoundedFeatureProgramLoweringErrorV1,
    ResearchBoundedFeatureProgramLoweringV1, ResearchBoundedFeatureProgramOwnerErrorV1,
};

use super::{authorized, insert_rejection_code};

#[async_trait::async_trait]
trait ResearchBoundedFeatureProgramPort: Send + Sync {
    async fn freeze(
        &self,
        request: ResearchBoundedFeatureProgramFreezeRequestV1,
    ) -> Result<
        ResearchBoundedFeatureProgramFreezeReceiptV1,
        ResearchBoundedFeatureProgramOwnerErrorV1,
    >;

    async fn lower(
        &self,
        research_request_locator: &str,
    ) -> Result<ResearchBoundedFeatureProgramLoweringV1, ResearchBoundedFeatureProgramLoweringErrorV1>;
}

#[async_trait::async_trait]
impl ResearchBoundedFeatureProgramPort for PostgresResearchBoundedFeatureProgramOwnerV1 {
    async fn freeze(
        &self,
        request: ResearchBoundedFeatureProgramFreezeRequestV1,
    ) -> Result<
        ResearchBoundedFeatureProgramFreezeReceiptV1,
        ResearchBoundedFeatureProgramOwnerErrorV1,
    > {
        Self::freeze(self, request).await
    }

    async fn lower(
        &self,
        research_request_locator: &str,
    ) -> Result<ResearchBoundedFeatureProgramLoweringV1, ResearchBoundedFeatureProgramLoweringErrorV1>
    {
        Self::lower(self, research_request_locator).await
    }
}

/// Locator-only request. The Owner reads the frozen program it already owns; the caller supplies
/// no Design, program or source.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BoundedFeatureProgramLoweringRequestV1 {
    research_request_locator: String,
}

#[derive(Clone)]
struct BoundedFeatureProgramApiState {
    owner: Arc<dyn ResearchBoundedFeatureProgramPort>,
    token_digest: [u8; 32],
}

pub(super) fn router(
    owner: Arc<PostgresResearchBoundedFeatureProgramOwnerV1>,
    token_digest: [u8; 32],
) -> Router {
    bounded_feature_program_router(owner, token_digest)
}

fn bounded_feature_program_router(
    owner: Arc<dyn ResearchBoundedFeatureProgramPort>,
    token_digest: [u8; 32],
) -> Router {
    Router::new()
        .route(
            "/v1/bounded-feature-programs/freeze",
            post(freeze_bounded_feature_program),
        )
        .route(
            "/v1/bounded-feature-programs/lower",
            post(lower_bounded_feature_program),
        )
        .with_state(BoundedFeatureProgramApiState {
            owner,
            token_digest,
        })
}

async fn freeze_bounded_feature_program(
    State(state): State<BoundedFeatureProgramApiState>,
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
    let request: ResearchBoundedFeatureProgramFreezeRequestV1 = match serde_json::from_slice(&body)
    {
        Ok(request) => request,
        Err(_) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let research_request_locator = request.research_request_locator.clone();

    match state.owner.freeze(request).await {
        Ok(receipt) => (StatusCode::OK, Json(receipt)).into_response(),
        Err(e) => owner_error(&e, &research_request_locator),
    }
}

async fn lower_bounded_feature_program(
    State(state): State<BoundedFeatureProgramApiState>,
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
    let request: BoundedFeatureProgramLoweringRequestV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };

    match state.owner.lower(&request.research_request_locator).await {
        Ok(lowering) => (StatusCode::OK, Json(lowering)).into_response(),
        Err(e) => lowering_error(&e, &request.research_request_locator),
    }
}

fn lowering_error(
    error: &ResearchBoundedFeatureProgramLoweringErrorV1,
    research_request_locator: &str,
) -> Response {
    let (status, code) = match error {
        ResearchBoundedFeatureProgramLoweringErrorV1::Storage(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "RD_OWNER_CUSTODY_UNAVAILABLE",
        ),
        ResearchBoundedFeatureProgramLoweringErrorV1::Unavailable => {
            (StatusCode::NOT_FOUND, "NO_VERIFIABLE_JOINT_FREEZE")
        }
        ResearchBoundedFeatureProgramLoweringErrorV1::Lowering(_) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "BOUNDED_FEATURE_PROGRAM_DOES_NOT_LOWER",
        ),
    };

    rejection(status, code, research_request_locator)
}

fn owner_error(
    error: &ResearchBoundedFeatureProgramOwnerErrorV1,
    research_request_locator: &str,
) -> Response {
    let (status, code) = match error {
        ResearchBoundedFeatureProgramOwnerErrorV1::Storage(_)
        | ResearchBoundedFeatureProgramOwnerErrorV1::Unavailable => (
            StatusCode::SERVICE_UNAVAILABLE,
            "RD_OWNER_CUSTODY_UNAVAILABLE",
        ),
        ResearchBoundedFeatureProgramOwnerErrorV1::Catalog => (
            StatusCode::SERVICE_UNAVAILABLE,
            "PRIMITIVE_CATALOG_UNAVAILABLE",
        ),
        ResearchBoundedFeatureProgramOwnerErrorV1::ResearchCustody => {
            (StatusCode::CONFLICT, "RESEARCH_CUSTODY_MISMATCH")
        }
        ResearchBoundedFeatureProgramOwnerErrorV1::Design => {
            (StatusCode::UNPROCESSABLE_ENTITY, "DESIGN_NOT_CANONICAL")
        }
        ResearchBoundedFeatureProgramOwnerErrorV1::Program => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "BOUNDED_FEATURE_PROGRAM_UNSUPPORTED",
        ),
        ResearchBoundedFeatureProgramOwnerErrorV1::Conflict => {
            (StatusCode::CONFLICT, "JOINT_FREEZE_CHANGED_MEANING")
        }
    };
    rejection(status, code, research_request_locator)
}

fn rejection(status: StatusCode, code: &str, research_request_locator: &str) -> Response {
    let mut response = (
        status,
        Json(json!({
            "research_request_locator": research_request_locator,
            "state": "NOT_FROZEN",
        })),
    )
        .into_response();
    insert_rejection_code(&mut response, code);
    response
}
