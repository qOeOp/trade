use axum::{
    Json,
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use vibe_backtest_owner_contracts::{
    CanonicalDigestV2, OpaqueIdentityV2, ReplayNamespaceV2, ReplayRequestDtoV2, ReplayRequestV2,
};
use vibe_product_edge::{ProductEdgeAdmissionRequestV1, ProductEdgeError};
use vibe_strategy_factory::{
    exploratory_replay::{
        EXPLORATORY_REPLAY_MUTATION_EFFECT_V2, EXPLORATORY_REPLAY_OPERATION_V2,
        EXPLORATORY_REPLAY_SCHEMA_V2, ExploratoryReplayOwnerError,
        ExploratoryReplayRecoverySelectorV2, ExploratoryReplayRequestProposalV2,
        ExploratoryReplaySealedReadPortV2,
    },
    product_edge::RESEARCH_OWNER_V1,
};

use super::{ApiState, authorized, insert_rejection_code};

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ExploratoryReplayOperationV2 {
    build_request_identity: String,
    attempt_identity: String,
    build_receipt_identity: String,
    artifact_family_binding_identity: String,
    request: ReplayRequestDtoV2,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExploratoryReplayResolveRequestV2 {
    meaning_digest: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ExploratoryReplayReadbackQueryV2 {
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
    Path(request_identity): Path<String>,
    Query(query): Query<ExploratoryReplayReadbackQueryV2>,
    headers: HeaderMap,
) -> Response {
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
        ProductEdgeError::Unavailable | ProductEdgeError::Storage(_) => rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "OWNER_UNAVAILABLE",
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
    use super::*;
    use rstest::rstest;

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
}
