//! `POST /v2/research-goals` and `POST /v3/research-goals`: submit a Research request whose sources
//! the caller states, through Product Edge admission, to the R&D Owner.
//!
//! The two routes take the same body, except that the V3 one also requires the instrument scope the
//! research studies. Which Product Edge operation a request is admitted under is decided once, by
//! `research_goal_admitted_operation`, from whether it states a scope: the Owner checks a stored
//! request's admission against the same function, so an admission and the request it admits cannot
//! disagree. The V2 route refuses a body that carries a scope, so a V2 request stays exactly what it
//! was. `POST /v3/source-intake-research` submits a V3 request whose sources a Source Intake terminal
//! supplies; this route is the one for sources the caller states directly.

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
use vibe_data::owner::research_instrument_scope_v1::ResearchInstrumentScopeWireV1;
use vibe_product_edge::{
    ProductEdgeAdmissionReadbackV1, ProductEdgeAdmissionRequestV1, ProductEdgeError,
    ProductEdgePostgresOwnerV1,
};
use vibe_strategy_factory::{
    product_edge::{
        ProductEdgeChannel, ProductEdgeResearchGoalRequestV2, RESEARCH_OWNER_V1,
        ResearchGoalOwnerError, ResearchGoalOwnerPortV2, ResearchGoalOwnerResultV2,
        SourcedResearchGoalV2, TrialFamilyProposalV1, research_goal_admitted_operation,
    },
    product_edge_postgres::{PostgresResearchGoalOwnerV1, ResearchRequestIdentityPreflightV1},
};

use super::{
    authorized, maybe_delay, owner_error_v2, product_edge_error, rejection_v2, unresolved_result_v2,
};

#[derive(Clone)]
pub(super) struct ResearchGoalSubmissionApiStateV1 {
    pub(super) product_edge: Arc<ProductEdgePostgresOwnerV1>,
    pub(super) owner: Arc<PostgresResearchGoalOwnerV1>,
    pub(super) token_digest: [u8; 32],
    pub(super) request_proof_digest: String,
    pub(super) allow_acceptance_faults: bool,
}

pub(super) fn router(state: ResearchGoalSubmissionApiStateV1) -> Router {
    Router::new()
        .route("/v2/research-goals", post(submit_v2))
        .route("/v3/research-goals", post(submit_v3))
        .with_state(state)
}

/// A V2 Research request as the caller submits it: no admission yet, and no scope.
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ProductEdgeOperationRequestV2 {
    pub(super) request_identity: String,
    pub(super) channel: ProductEdgeChannel,
    pub(super) goal: SourcedResearchGoalV2,
    pub(super) trial_family_proposal: TrialFamilyProposalV1,
}

/// A V3 Research request as the caller submits it: a V2 request plus the instrument scope it
/// studies, which is required.
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ProductEdgeOperationRequestV3 {
    pub(super) request_identity: String,
    pub(super) channel: ProductEdgeChannel,
    pub(super) goal: SourcedResearchGoalV2,
    pub(super) trial_family_proposal: TrialFamilyProposalV1,
    pub(super) instrument_scope: ResearchInstrumentScopeWireV1,
}

/// What Product Edge admits for one submission: the operation request with the scope present
/// exactly when it states one. These are the bytes the Owner later checks the admission against.
#[derive(Debug, Serialize)]
struct AdmittedResearchPayloadV1<'a> {
    request_identity: &'a str,
    channel: &'a ProductEdgeChannel,
    goal: &'a SourcedResearchGoalV2,
    trial_family_proposal: &'a TrialFamilyProposalV1,
    #[serde(skip_serializing_if = "Option::is_none")]
    instrument_scope: Option<&'a ResearchInstrumentScopeWireV1>,
}

pub(super) async fn submit_v2(
    State(state): State<ResearchGoalSubmissionApiStateV1>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return unauthorized();
    }
    let Ok(operation) = serde_json::from_slice::<ProductEdgeOperationRequestV2>(&body) else {
        return malformed();
    };
    submit(
        &state,
        &headers,
        operation.request_identity,
        operation.channel,
        operation.goal,
        operation.trial_family_proposal,
        None,
    )
    .await
}

async fn submit_v3(
    State(state): State<ResearchGoalSubmissionApiStateV1>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return unauthorized();
    }
    let Ok(operation) = serde_json::from_slice::<ProductEdgeOperationRequestV3>(&body) else {
        return malformed();
    };
    submit(
        &state,
        &headers,
        operation.request_identity,
        operation.channel,
        operation.goal,
        operation.trial_family_proposal,
        Some(operation.instrument_scope),
    )
    .await
}

async fn submit(
    state: &ResearchGoalSubmissionApiStateV1,
    headers: &HeaderMap,
    request_identity: String,
    channel: ProductEdgeChannel,
    goal: SourcedResearchGoalV2,
    trial_family_proposal: TrialFamilyProposalV1,
    instrument_scope: Option<ResearchInstrumentScopeWireV1>,
) -> Response {
    let outcome = submit_research_goal_v2_in_process(
        &state.product_edge,
        &state.owner,
        &state.request_proof_digest,
        request_identity.clone(),
        channel,
        goal,
        trial_family_proposal,
        instrument_scope,
    )
    .await;
    // The route's own HTTP fault injection runs only once a submission was actually attempted
    // (the submit_v2 call itself, win or lose), not on a preflight refusal or an admission
    // failure: unchanged from before this function was split from its typed core.
    let delay_eligible = matches!(
        outcome,
        Ok(ResearchGoalSubmissionOutcomeV1::Submitted(_))
            | Err(ResearchGoalSubmissionErrorV1::Submission(_))
    );
    let response = match outcome {
        Ok(ResearchGoalSubmissionOutcomeV1::Submitted(result)) => {
            (StatusCode::OK, Json(result)).into_response()
        }
        Ok(ResearchGoalSubmissionOutcomeV1::LegacyQuarantined) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(unresolved_result_v2(&request_identity)),
        )
            .into_response(),
        Err(ResearchGoalSubmissionErrorV1::PreflightUnavailable(e)) => {
            tracing::warn!(error = %e, %request_identity, "Research request identity preflight unavailable");
            owner_error_v2(&e, &request_identity)
        }
        Err(ResearchGoalSubmissionErrorV1::Admission(e)) => {
            product_edge_error(&e, &request_identity, true)
        }
        Err(ResearchGoalSubmissionErrorV1::Submission(e)) => owner_error_v2(&e, &request_identity),
    };

    if delay_eligible {
        maybe_delay(state.allow_acceptance_faults, headers).await;
    }
    response
}

/// What a submission reached, once Product Edge has (or has not) admitted it.
pub(crate) enum ResearchGoalSubmissionOutcomeV1 {
    /// Admitted and submitted; the Owner's own disposition (accepted, rejected, submitted-or-
    /// unknown, …) is in the result.
    Submitted(Box<ResearchGoalOwnerResultV2>),
    /// The identity names a request this Owner's custody quarantined under the legacy shape; no
    /// admission was attempted.
    LegacyQuarantined,
}

/// Why [`submit_research_goal_v2_in_process`] did not reach a [`ResearchGoalSubmissionOutcomeV1`].
pub(crate) enum ResearchGoalSubmissionErrorV1 {
    PreflightUnavailable(ResearchGoalOwnerError),
    Admission(ProductEdgeError),
    Submission(ResearchGoalOwnerError),
}

/// Submits one V2 or V3 Research request (a `None` scope is V2, `Some` is V3) in process: the
/// production composition `/v2/research-goals` and `/v3/research-goals` answer over HTTP, reached
/// here without HTTP for a direct caller - `backtest.run`'s own orchestration opens a Research
/// goal this same way, once per run.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn submit_research_goal_v2_in_process(
    product_edge: &ProductEdgePostgresOwnerV1,
    owner: &PostgresResearchGoalOwnerV1,
    request_proof_digest: &str,
    request_identity: String,
    channel: ProductEdgeChannel,
    goal: SourcedResearchGoalV2,
    trial_family_proposal: TrialFamilyProposalV1,
    instrument_scope: Option<ResearchInstrumentScopeWireV1>,
) -> Result<ResearchGoalSubmissionOutcomeV1, ResearchGoalSubmissionErrorV1> {
    match owner
        .preflight_request_identity(&request_identity)
        .await
        .map_err(ResearchGoalSubmissionErrorV1::PreflightUnavailable)?
    {
        ResearchRequestIdentityPreflightV1::Vacant
        | ResearchRequestIdentityPreflightV1::Current => {}
        ResearchRequestIdentityPreflightV1::LegacyQuarantined => {
            return Ok(ResearchGoalSubmissionOutcomeV1::LegacyQuarantined);
        }
    }
    let admission = admit_in_process(
        product_edge,
        request_proof_digest,
        &AdmittedResearchPayloadV1 {
            request_identity: &request_identity,
            channel: &channel,
            goal: &goal,
            trial_family_proposal: &trial_family_proposal,
            instrument_scope: instrument_scope.as_ref(),
        },
    )
    .await
    .map_err(ResearchGoalSubmissionErrorV1::Admission)?;
    let request = ProductEdgeResearchGoalRequestV2 {
        request_identity,
        channel,
        admission: admission.locator().clone(),
        goal,
        trial_family_proposal,
        instrument_scope,
    };
    owner
        .submit_v2(request)
        .await
        .map(|result| ResearchGoalSubmissionOutcomeV1::Submitted(Box::new(result)))
        .map_err(ResearchGoalSubmissionErrorV1::Submission)
}

async fn admit_in_process(
    product_edge: &ProductEdgePostgresOwnerV1,
    request_proof_digest: &str,
    payload: &AdmittedResearchPayloadV1<'_>,
) -> Result<ProductEdgeAdmissionReadbackV1, ProductEdgeError> {
    let (operation, operation_schema) =
        research_goal_admitted_operation(payload.instrument_scope.is_some());
    product_edge
        .admit_request(ProductEdgeAdmissionRequestV1 {
            request_identity: payload.request_identity.to_owned(),
            typed_payload: serde_json::to_value(payload)
                .map_err(|e| ProductEdgeError::Storage(e.to_string()))?,
            operation: operation.to_owned(),
            operation_schema: operation_schema.to_owned(),
            target_owner: RESEARCH_OWNER_V1.to_owned(),
            requested_effects: vec!["R_AND_D_RESEARCH_MUTATION_V1".to_owned()],
            request_proof_digest: request_proof_digest.to_owned(),
            audit_correlation: format!("rd-workbench:{}", payload.request_identity),
        })
        .await
}

fn unauthorized() -> Response {
    rejection_v2(
        StatusCode::FORBIDDEN,
        "UNAUTHORIZED_PRODUCT_EDGE",
        "unbound",
    )
}

fn malformed() -> Response {
    rejection_v2(
        StatusCode::BAD_REQUEST,
        "MALFORMED_TYPED_REQUEST",
        "unbound",
    )
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn body(scope: bool) -> serde_json::Value {
        let mut body = serde_json::json!({
            "request_identity": "rd-submission-shape",
            "channel": ProductEdgeChannel::WindmillProductEdge,
            "goal": {
                "hypothesis": "h", "mechanism": "m", "falsification_question": "f",
                "expected_observation": "e", "required_data": ["d"], "cost_assumption": "c",
                "capacity_assumption": "a",
                "sources": [{
                    "locator": "https://example.com/s", "content_digest": format!("sha256:{}", "a".repeat(64)),
                    "observed_at": "2026-10-03T00:00:00Z", "source_cut": "cut", "license_basis": "public",
                    "interpretation": "i",
                }],
            },
            "trial_family_proposal": {
                "trial_budget": 2, "stop_rule": "s", "pit_rule_identity": "p",
                "cost_model_identity": "c", "slippage_model_identity": "s",
                "capacity_model_identity": "c", "independence_rationale": "r",
            },
        });

        if scope {
            body["instrument_scope"] =
                serde_json::json!({"schema_version": 1, "identities": ["BTCUSDT-PERP.BINANCE"]});
        }
        body
    }

    /// Each route takes exactly its own body: V2 refuses a scope, V3 requires one.
    #[rstest]
    fn each_route_takes_only_its_own_body() {
        assert!(serde_json::from_value::<ProductEdgeOperationRequestV2>(body(false)).is_ok());
        assert!(serde_json::from_value::<ProductEdgeOperationRequestV2>(body(true)).is_err());
        assert!(serde_json::from_value::<ProductEdgeOperationRequestV3>(body(true)).is_ok());
        assert!(serde_json::from_value::<ProductEdgeOperationRequestV3>(body(false)).is_err());
    }

    /// What is admitted is the submitted body itself: the scope is present exactly for V3, so the
    /// payload is the one the Owner checks a stored request's admission against.
    #[rstest]
    #[case::v2(false)]
    #[case::v3(true)]
    fn the_admitted_payload_is_the_submitted_body(#[case] scope: bool) {
        let submitted = body(scope);
        let operation: ProductEdgeOperationRequestV3 = serde_json::from_value(body(true)).unwrap();
        let scope_value = operation.instrument_scope;
        let payload = AdmittedResearchPayloadV1 {
            request_identity: &operation.request_identity,
            channel: &operation.channel,
            goal: &operation.goal,
            trial_family_proposal: &operation.trial_family_proposal,
            instrument_scope: scope.then_some(&scope_value),
        };
        assert_eq!(serde_json::to_value(&payload).unwrap(), submitted);
    }
}
