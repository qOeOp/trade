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
use vibe_data::owner::strategy_design_role_intent_v1::StrategyDesignRoleIntentV1;
use vibe_strategy_factory::bounded_feature_program_derivation_v1::BoundedFeatureProgramAssemblyErrorV1;
use vibe_strategy_factory::bounded_feature_program_v1::BoundedFeatureProgramErrorV1;
use vibe_strategy_factory::rd_bounded_feature_program_postgres_v1::{
    PostgresResearchBoundedFeatureProgramOwnerV1, ResearchBoundedFeatureProgramDeclarationV1,
    ResearchBoundedFeatureProgramFreezeReceiptV1, ResearchBoundedFeatureProgramFreezeRequestV1,
    ResearchBoundedFeatureProgramLoweringErrorV1, ResearchBoundedFeatureProgramLoweringV1,
    ResearchBoundedFeatureProgramOwnerErrorV1,
};
use vibe_strategy_factory::strategy_design_v2::StrategyDesignV2;

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

    async fn declare(
        &self,
        declaration: ResearchBoundedFeatureProgramDeclarationV1,
    ) -> Result<
        ResearchBoundedFeatureProgramFreezeReceiptV1,
        ResearchBoundedFeatureProgramOwnerErrorV1,
    >;
    async fn lower(
        &self,
        research_request_locator: &str,
    ) -> Result<ResearchBoundedFeatureProgramLoweringV1, ResearchBoundedFeatureProgramLoweringErrorV1>;

    async fn publish_design_role_intent(
        &self,
        research_request_locator: &str,
        design: &StrategyDesignV2,
    ) -> Result<StrategyDesignRoleIntentV1, ResearchBoundedFeatureProgramOwnerErrorV1>;
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

    async fn declare(
        &self,
        declaration: ResearchBoundedFeatureProgramDeclarationV1,
    ) -> Result<
        ResearchBoundedFeatureProgramFreezeReceiptV1,
        ResearchBoundedFeatureProgramOwnerErrorV1,
    > {
        Self::declare(self, declaration).await
    }
    async fn lower(
        &self,
        research_request_locator: &str,
    ) -> Result<ResearchBoundedFeatureProgramLoweringV1, ResearchBoundedFeatureProgramLoweringErrorV1>
    {
        Self::lower(self, research_request_locator).await
    }

    async fn publish_design_role_intent(
        &self,
        research_request_locator: &str,
        design: &StrategyDesignV2,
    ) -> Result<StrategyDesignRoleIntentV1, ResearchBoundedFeatureProgramOwnerErrorV1> {
        Self::publish_design_role_intent(self, research_request_locator, design).await
    }
}

/// Locator-only request. The Owner reads the frozen program it already owns; the caller supplies
/// no Design, program or source.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BoundedFeatureProgramLoweringRequestV1 {
    research_request_locator: String,
}

/// Design and locator. The caller states no identity, digest or role coordinate of its own; all of
/// them are derived from the Design and the Research custody the locator currently names.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct DesignRoleIntentPublicationRequestV1 {
    research_request_locator: String,
    design: StrategyDesignV2,
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
            "/v1/bounded-feature-programs/declare",
            post(declare_bounded_feature_program),
        )
        .route(
            "/v1/bounded-feature-programs/lower",
            post(lower_bounded_feature_program),
        )
        .route(
            "/v1/strategy-designs/publish-role-intent",
            post(publish_design_role_intent),
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

/// Meaning-only entry. The caller declares a Design and program meaning; the Owner derives every
/// identity, digest and binding receipt itself and freezes the result in one transaction.
async fn declare_bounded_feature_program(
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
    let declaration: ResearchBoundedFeatureProgramDeclarationV1 =
        match serde_json::from_slice(&body) {
            Ok(declaration) => declaration,
            Err(_) => {
                return rejection(
                    StatusCode::BAD_REQUEST,
                    "MALFORMED_TYPED_REQUEST",
                    "unbound",
                );
            }
        };
    let research_request_locator = declaration.research_request_locator.clone();

    match state.owner.declare(declaration).await {
        Ok(receipt) => (StatusCode::OK, Json(receipt)).into_response(),
        Err(e) => owner_error(&e, &research_request_locator),
    }
}

/// Design-only entry. The Owner states what it knows about a Design, without any program.
///
/// This is what a Design's first cycle starts from. Market Data cannot issue binding receipts
/// without an authenticated statement of the Design's roles, and every other such statement names a
/// Composer operation over a program whose own identity folds in those receipts. So the caller
/// sends the Design and the Research locator it belongs to, and the Owner derives the statement
/// from its own currently accepted custody.
async fn publish_design_role_intent(
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
    let request: DesignRoleIntentPublicationRequestV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };

    match state
        .owner
        .publish_design_role_intent(&request.research_request_locator, &request.design)
        .await
    {
        Ok(intent) => (StatusCode::OK, Json(intent)).into_response(),
        Err(e) => owner_error(&e, &request.research_request_locator),
    }
}

/// Locator-only entry. The Owner reads the frozen program it already owns and lowers it.
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
        ResearchBoundedFeatureProgramOwnerErrorV1::ResearchCustody => {
            (StatusCode::CONFLICT, "RESEARCH_CUSTODY_MISMATCH")
        }
        ResearchBoundedFeatureProgramOwnerErrorV1::Design => {
            (StatusCode::UNPROCESSABLE_ENTITY, "DESIGN_NOT_CANONICAL")
        }
        // Preparation distinguishes twelve refusals and they send an author to different places:
        // a graph topology refusal and a terminal lifecycle refusal have nothing in common. One
        // code for all of them told a proposer only that something was wrong. These stay 422
        // together, because every one of them is the declaration's own fault.
        ResearchBoundedFeatureProgramOwnerErrorV1::Program(stage) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            bounded_feature_program_stage_code(stage),
        ),
        ResearchBoundedFeatureProgramOwnerErrorV1::SdkSource => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "FIRST_PARTY_SDK_SOURCE_MISMATCH",
        ),
        ResearchBoundedFeatureProgramOwnerErrorV1::Conflict => {
            (StatusCode::CONFLICT, "JOINT_FREEZE_CHANGED_MEANING")
        }
        // The two assembly variants tell a proposer to do opposite things - change the meaning, or
        // wait for an Owner gap it cannot affect - so they cannot share one code. Collapsing them
        // left a proposer holding a 422 with no way to know which of the two it was.
        ResearchBoundedFeatureProgramOwnerErrorV1::CatalogUnavailable => (
            StatusCode::SERVICE_UNAVAILABLE,
            "NO_VERIFIED_PRIMITIVE_CATALOG",
        ),
        ResearchBoundedFeatureProgramOwnerErrorV1::Assembly(
            BoundedFeatureProgramAssemblyErrorV1::Derivation(_),
        ) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "DECLARED_MEANING_DOES_NOT_ASSEMBLE",
        ),
        ResearchBoundedFeatureProgramOwnerErrorV1::Assembly(
            BoundedFeatureProgramAssemblyErrorV1::MarketDataUnavailable,
        ) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "MARKET_DATA_INPUT_CUSTODY_UNAVAILABLE",
        ),
    };
    rejection(status, code, research_request_locator)
}

/// Names which preparation stage refused a declared program.
///
/// One code per `BoundedFeatureProgramErrorV1` variant, so the mapping is total by construction:
/// adding a stage without a code stops compiling here rather than silently folding into a
/// neighbour.
const fn bounded_feature_program_stage_code(stage: &BoundedFeatureProgramErrorV1) -> &'static str {
    match stage {
        BoundedFeatureProgramErrorV1::Identity => "BOUNDED_FEATURE_PROGRAM_IDENTITY_UNSUPPORTED",
        BoundedFeatureProgramErrorV1::Bounds => "BOUNDED_FEATURE_PROGRAM_BOUNDS_INVALID",
        BoundedFeatureProgramErrorV1::Design => "BOUNDED_FEATURE_PROGRAM_DESIGN_BINDING_INVALID",
        BoundedFeatureProgramErrorV1::Input => "BOUNDED_FEATURE_PROGRAM_INPUT_BINDING_INVALID",
        BoundedFeatureProgramErrorV1::Constant => "BOUNDED_FEATURE_PROGRAM_CONSTANT_INVALID",
        BoundedFeatureProgramErrorV1::Primitive => "BOUNDED_FEATURE_PROGRAM_PRIMITIVE_UNKNOWN",
        BoundedFeatureProgramErrorV1::Type => "BOUNDED_FEATURE_PROGRAM_TYPED_EDGE_INVALID",
        BoundedFeatureProgramErrorV1::State => "BOUNDED_FEATURE_PROGRAM_STATE_OWNERSHIP_INVALID",
        BoundedFeatureProgramErrorV1::Graph => "BOUNDED_FEATURE_PROGRAM_GRAPH_INVALID",
        BoundedFeatureProgramErrorV1::Terminal => "BOUNDED_FEATURE_PROGRAM_TERMINAL_INVALID",
        BoundedFeatureProgramErrorV1::NonCanonical => "BOUNDED_FEATURE_PROGRAM_NOT_CANONICAL",
        BoundedFeatureProgramErrorV1::InvalidDestinationLength => {
            "BOUNDED_FEATURE_PROGRAM_DESTINATION_LENGTH_INVALID"
        }
    }
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

#[cfg(test)]
mod assembly_rejection_tests {
    use axum::http::StatusCode;
    use rstest::rstest;
    use vibe_strategy_factory::bounded_feature_program_derivation_v1::{
        BoundedFeatureProgramAssemblyErrorV1, BoundedFeatureProgramDerivationErrorV1,
    };
    use vibe_strategy_factory::rd_bounded_feature_program_postgres_v1::ResearchBoundedFeatureProgramOwnerErrorV1;

    use super::owner_error;

    fn code_of(error: &ResearchBoundedFeatureProgramOwnerErrorV1) -> String {
        let response = owner_error(error, "research.request.test.v1");
        response
            .headers()
            .get("x-rd-rejection-code")
            .expect("a rejection carries its code in a header")
            .to_str()
            .expect("the code is ASCII")
            .to_owned()
    }

    /// A proposer reading `MARKET_DATA_INPUT_CUSTODY_UNAVAILABLE` must change nothing it owns, and
    /// one reading `DECLARED_MEANING_DOES_NOT_ASSEMBLE` must change its meaning. One code for both
    /// told a proposer neither.
    #[rstest]
    fn the_two_assembly_failures_do_not_share_a_rejection_code() {
        let custody = ResearchBoundedFeatureProgramOwnerErrorV1::Assembly(
            BoundedFeatureProgramAssemblyErrorV1::MarketDataUnavailable,
        );
        let meaning = ResearchBoundedFeatureProgramOwnerErrorV1::Assembly(
            BoundedFeatureProgramAssemblyErrorV1::Derivation(
                BoundedFeatureProgramDerivationErrorV1::UnknownPlugin,
            ),
        );
        assert_eq!(code_of(&custody), "MARKET_DATA_INPUT_CUSTODY_UNAVAILABLE");
        assert_eq!(code_of(&meaning), "DECLARED_MEANING_DOES_NOT_ASSEMBLE");
        assert_ne!(code_of(&custody), code_of(&meaning));
    }

    /// Twelve preparation stages, twelve codes. A proposer that reads one must be able to tell
    /// which of them refused it, and the earlier single code told it nothing.
    #[rstest]
    fn every_preparation_stage_has_its_own_rejection_code() {
        use vibe_strategy_factory::bounded_feature_program_v1::BoundedFeatureProgramErrorV1 as Stage;

        let stages = [
            Stage::Identity,
            Stage::Bounds,
            Stage::Design,
            Stage::Input,
            Stage::Constant,
            Stage::Primitive,
            Stage::Type,
            Stage::State,
            Stage::Graph,
            Stage::Terminal,
            Stage::NonCanonical,
            Stage::InvalidDestinationLength,
        ];
        let codes: std::collections::BTreeSet<String> = stages
            .iter()
            .map(|stage| {
                code_of(&ResearchBoundedFeatureProgramOwnerErrorV1::Program(
                    stage.clone(),
                ))
            })
            .collect();
        assert_eq!(codes.len(), stages.len(), "{codes:?}");
    }

    /// Positive control for the split above: every stage still refuses, so naming them did not
    /// turn any one of them into an answer.
    #[rstest]
    fn every_preparation_stage_is_still_unprocessable() {
        use vibe_strategy_factory::bounded_feature_program_v1::BoundedFeatureProgramErrorV1 as Stage;

        for stage in [
            Stage::Identity,
            Stage::Graph,
            Stage::Terminal,
            Stage::NonCanonical,
        ] {
            let error = ResearchBoundedFeatureProgramOwnerErrorV1::Program(stage);
            assert_eq!(
                owner_error(&error, "research.request.test.v1").status(),
                StatusCode::UNPROCESSABLE_ENTITY
            );
        }
    }

    /// Positive control: both still reject, so the split did not turn one of them into an answer.
    #[rstest]
    fn both_assembly_failures_are_still_unprocessable() {
        for error in [
            ResearchBoundedFeatureProgramOwnerErrorV1::Assembly(
                BoundedFeatureProgramAssemblyErrorV1::MarketDataUnavailable,
            ),
            ResearchBoundedFeatureProgramOwnerErrorV1::Assembly(
                BoundedFeatureProgramAssemblyErrorV1::Derivation(
                    BoundedFeatureProgramDerivationErrorV1::UnknownPlugin,
                ),
            ),
        ] {
            assert_eq!(
                owner_error(&error, "research.request.test.v1").status(),
                StatusCode::UNPROCESSABLE_ENTITY
            );
        }
    }
}
