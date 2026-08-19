use std::{env, sync::Arc, time::Duration};

use axum::{
    Json, Router,
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::net::TcpListener;
use vibe_strategy_factory::{
    artifact_build::{
        ARTIFACT_BUILD_OPERATION_V1, ARTIFACT_BUILD_SCHEMA_V1, ARTIFACT_BUILD_SCOPE_V1,
        ARTIFACT_VIEW_SCOPE_V1, ArtifactBuildCandidateV1, ArtifactBuildError,
        ArtifactBuildNextLegalAction, ArtifactBuildOwnerPort, ArtifactBuildPreparationV1,
        ArtifactBuildRequestV1, ArtifactBuildResolution, ArtifactBuildResultV1,
        SANDBOX_SOCKET_DEFAULT,
    },
    artifact_build_postgres::PostgresArtifactBuildOwnerV1,
    product_edge::{
        ProductEdgeAdmissionPolicyV1, ProductEdgeChannel, ProductEdgeResearchGoalRequestV1,
        ProductEdgeResolution, RESEARCH_GOAL_OPERATION_V1, RESEARCH_GOAL_SCHEMA_V1,
        RESEARCH_OWNER_V1, RESEARCH_SCOPE_V1, RESEARCH_VIEW_SCOPE_V1, ResearchGoalOwnerError,
        ResearchGoalOwnerPort, ResearchGoalOwnerResultV1, ResearchNextLegalAction,
        SourcedResearchGoalV1, TrustedProductEdgeContextV1, identity_conflict_result,
    },
    product_edge_postgres::PostgresResearchGoalOwnerV1,
};

#[derive(Clone)]
struct ApiState {
    owner: Arc<dyn ResearchGoalOwnerPort>,
    artifact_owner: Arc<dyn ArtifactBuildOwnerPort>,
    token_digest: [u8; 32],
    trusted_context: TrustedProductEdgeContextV1,
    artifact_trusted_context: TrustedProductEdgeContextV1,
    allow_acceptance_faults: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ProductEdgeOperationRequestV1 {
    request_identity: String,
    channel: ProductEdgeChannel,
    goal: SourcedResearchGoalV1,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ArtifactBuildOperationRequestV1 {
    build_request_identity: String,
    attempt_identity: String,
    intent_identity: String,
    channel: ProductEdgeChannel,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ArtifactBuildCandidateOperationV1 {
    request: ArtifactBuildOperationRequestV1,
    candidate: ArtifactBuildCandidateV1,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ArtifactBuildFailureOperationV1 {
    request: ArtifactBuildOperationRequestV1,
    failure_code: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_target(false)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();
    let database_url = required_env("RD_OWNER_DATABASE_URL")?;
    let token = required_env("RD_OWNER_API_TOKEN")?;
    let policy = ProductEdgeAdmissionPolicyV1 {
        effective_principal: env_or("RD_OWNER_EFFECTIVE_PRINCIPAL", "admin"),
        permissioned_as: env_or("RD_OWNER_PERMISSIONED_AS", "u/admin"),
        shell_binding_identity: env_or(
            "RD_OWNER_SHELL_BINDING_IDENTITY",
            "windmill-product-edge-local-v1",
        ),
        shell_history_head: env_or(
            "RD_OWNER_SHELL_HISTORY_HEAD",
            "windmill-product-edge-local-history-genesis-v1",
        ),
        authorization_identity: env_or(
            "RD_OWNER_AUTHORIZATION_IDENTITY",
            "local-single-user-research-v1",
        ),
        authorization_policy_version: env_or(
            "RD_OWNER_AUTHORIZATION_POLICY_VERSION",
            "rd-research-local-policy-v1",
        ),
        manifest_identity: env_or(
            "RD_OWNER_MANIFEST_IDENTITY",
            "windmill-research-goal-operation-manifest-v1",
        ),
        manifest_version: env_or("RD_OWNER_MANIFEST_VERSION", "1"),
        capability_policy_version: env_or(
            "RD_OWNER_CAPABILITY_POLICY_VERSION",
            "rd-product-edge-capabilities-v1",
        ),
        audit_policy_version: env_or("RD_OWNER_AUDIT_POLICY_VERSION", "rd-product-edge-audit-v1"),
    };
    let trusted_context = trusted_context(&policy);
    let artifact_trusted_context = artifact_trusted_context(&policy);
    let owner =
        Arc::new(PostgresResearchGoalOwnerV1::connect(&database_url, policy.clone()).await?);
    let artifact_owner = Arc::new(
        PostgresArtifactBuildOwnerV1::connect(
            &database_url,
            policy,
            &env_or("RD_SANDBOX_SOCKET", SANDBOX_SOCKET_DEFAULT),
            env_or("RD_ARTIFACT_ATTEMPT_TIMEOUT_MS", "600000").parse()?,
        )
        .await?,
    );
    let state = ApiState {
        owner,
        artifact_owner,
        token_digest: Sha256::digest(token.as_bytes()).into(),
        trusted_context,
        artifact_trusted_context,
        allow_acceptance_faults: env::var("RD_OWNER_ENABLE_ACCEPTANCE_FAULTS").as_deref()
            == Ok("1"),
    };
    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/research-goals", post(submit))
        .route(
            "/v1/research-goals/{request_identity}/resolve",
            post(resolve),
        )
        .route("/v1/artifact-builds/prepare", post(prepare_artifact_build))
        .route(
            "/v1/artifact-builds/candidate",
            post(submit_artifact_candidate),
        )
        .route("/v1/artifact-builds/fail", post(fail_artifact_build))
        .route(
            "/v1/artifact-builds/{build_request_identity}/attempts/{attempt_identity}/resolve",
            post(resolve_artifact_build),
        )
        .with_state(state);
    let address = env_or("RD_OWNER_LISTEN", "0.0.0.0:8080");
    let listener = TcpListener::bind(&address).await?;
    tracing::info!(listen = %address, "R&D Owner API ready");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> &'static str {
    "ok"
}

async fn submit(State(state): State<ApiState>, headers: HeaderMap, body: Bytes) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }
    let operation: ProductEdgeOperationRequestV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let request = ProductEdgeResearchGoalRequestV1 {
        request_identity: operation.request_identity,
        channel: operation.channel,
        context: state.trusted_context.clone(),
        goal: operation.goal,
    };
    let request_identity = request.request_identity.clone();
    let response = match state.owner.submit(request).await {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => owner_error(&e, &request_identity),
    };
    maybe_delay(&state, &headers).await;
    response
}

async fn resolve(
    State(state): State<ApiState>,
    Path(request_identity): Path<String>,
    headers: HeaderMap,
    _body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            &request_identity,
        );
    }

    match state
        .owner
        .resolve(&request_identity, &state.trusted_context)
        .await
    {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => owner_error(&e, &request_identity),
    }
}

async fn prepare_artifact_build(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return artifact_preparation_rejection(
            StatusCode::FORBIDDEN,
            "AUTHORIZATION_LINEAGE_REJECTED",
            "unbound",
            "unbound",
        );
    }
    let operation: ArtifactBuildOperationRequestV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return artifact_preparation_rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
                "unbound",
            );
        }
    };
    let request = artifact_request(operation, &state.artifact_trusted_context);
    let build_request_identity = request.build_request_identity.clone();
    let attempt_identity = request.attempt_identity.clone();
    match state.artifact_owner.prepare(request).await {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => artifact_preparation_error(&e, &build_request_identity, &attempt_identity),
    }
}

async fn submit_artifact_candidate(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return artifact_rejection(
            StatusCode::FORBIDDEN,
            "AUTHORIZATION_LINEAGE_REJECTED",
            "unbound",
            "unbound",
        );
    }
    let operation: ArtifactBuildCandidateOperationV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return artifact_rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
                "unbound",
            );
        }
    };
    let request = artifact_request(operation.request, &state.artifact_trusted_context);
    let build_request_identity = request.build_request_identity.clone();
    let attempt_identity = request.attempt_identity.clone();
    let response = match state
        .artifact_owner
        .submit_candidate(request, operation.candidate)
        .await
    {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => artifact_error(&e, &build_request_identity, &attempt_identity),
    };
    maybe_delay(&state, &headers).await;
    response
}

async fn fail_artifact_build(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return artifact_rejection(
            StatusCode::FORBIDDEN,
            "AUTHORIZATION_LINEAGE_REJECTED",
            "unbound",
            "unbound",
        );
    }
    let operation: ArtifactBuildFailureOperationV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return artifact_rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
                "unbound",
            );
        }
    };
    let request = artifact_request(operation.request, &state.artifact_trusted_context);
    let build_request_identity = request.build_request_identity.clone();
    let attempt_identity = request.attempt_identity.clone();

    match state
        .artifact_owner
        .fail_no_artifact(request, &operation.failure_code)
        .await
    {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => artifact_error(&e, &build_request_identity, &attempt_identity),
    }
}

async fn resolve_artifact_build(
    State(state): State<ApiState>,
    Path((build_request_identity, attempt_identity)): Path<(String, String)>,
    headers: HeaderMap,
    _body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return artifact_rejection(
            StatusCode::FORBIDDEN,
            "AUTHORIZATION_LINEAGE_REJECTED",
            &build_request_identity,
            &attempt_identity,
        );
    }

    match state
        .artifact_owner
        .resolve(
            &build_request_identity,
            &attempt_identity,
            &state.artifact_trusted_context,
        )
        .await
    {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => artifact_error(&e, &build_request_identity, &attempt_identity),
    }
}

fn artifact_request(
    operation: ArtifactBuildOperationRequestV1,
    context: &TrustedProductEdgeContextV1,
) -> ArtifactBuildRequestV1 {
    ArtifactBuildRequestV1 {
        build_request_identity: operation.build_request_identity,
        attempt_identity: operation.attempt_identity,
        intent_identity: operation.intent_identity,
        channel: operation.channel,
        context: context.clone(),
    }
}

fn artifact_preparation_error(
    error: &ArtifactBuildError,
    build_request_identity: &str,
    attempt_identity: &str,
) -> Response {
    let (status, code, resolution, next) = artifact_error_parts(error);
    let mut response = (
        status,
        Json(ArtifactBuildPreparationV1 {
            schema_version: 1,
            resolution,
            build_request_identity: build_request_identity.to_string(),
            attempt_identity: attempt_identity.to_string(),
            semantic_digest: String::new(),
            canonical_intent_bytes: None,
            intent_identity: None,
            intent_semantic_digest: None,
            owner_receipt: None,
            next_legal_action: next,
        }),
    )
        .into_response();
    insert_rejection_code(&mut response, code);
    response
}

fn artifact_error(
    error: &ArtifactBuildError,
    build_request_identity: &str,
    attempt_identity: &str,
) -> Response {
    let (status, code, resolution, next) = artifact_error_parts(error);
    let mut response = (
        status,
        Json(ArtifactBuildResultV1 {
            schema_version: 1,
            resolution,
            build_request_identity: build_request_identity.to_string(),
            attempt_identity: attempt_identity.to_string(),
            owner_receipt: None,
            research_view: None,
            artifact_review: None,
            next_legal_action: next,
        }),
    )
        .into_response();
    insert_rejection_code(&mut response, code);
    response
}

fn artifact_error_parts(
    error: &ArtifactBuildError,
) -> (
    StatusCode,
    &'static str,
    ArtifactBuildResolution,
    ArtifactBuildNextLegalAction,
) {
    match error {
        ArtifactBuildError::ConflictingReplay => (
            StatusCode::CONFLICT,
            "CONFLICTING_SEMANTICS_FOR_REQUEST_IDENTITY",
            ArtifactBuildResolution::IdentityConflict,
            ArtifactBuildNextLegalAction::CorrectInputAndCreateSuccessorRequest,
        ),
        ArtifactBuildError::Unauthorized(_) => (
            StatusCode::FORBIDDEN,
            "AUTHORIZATION_LINEAGE_REJECTED",
            ArtifactBuildResolution::RejectedNoWrite,
            ArtifactBuildNextLegalAction::CorrectInputAndCreateSuccessorRequest,
        ),
        ArtifactBuildError::Candidate(_) => (
            StatusCode::BAD_REQUEST,
            "CANDIDATE_REJECTED",
            ArtifactBuildResolution::RejectedNoWrite,
            ArtifactBuildNextLegalAction::CorrectInputAndCreateSuccessorRequest,
        ),
        ArtifactBuildError::Sandbox(_) | ArtifactBuildError::Storage(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "OWNER_OUTCOME_UNKNOWN",
            ArtifactBuildResolution::SubmittedOrUnknown,
            ArtifactBuildNextLegalAction::ResolveSameAttemptIdentity,
        ),
    }
}

fn artifact_preparation_rejection(
    status: StatusCode,
    code: &str,
    build_request_identity: &str,
    attempt_identity: &str,
) -> Response {
    let mut response = (
        status,
        Json(ArtifactBuildPreparationV1 {
            schema_version: 1,
            resolution: ArtifactBuildResolution::RejectedNoWrite,
            build_request_identity: build_request_identity.to_string(),
            attempt_identity: attempt_identity.to_string(),
            semantic_digest: String::new(),
            canonical_intent_bytes: None,
            intent_identity: None,
            intent_semantic_digest: None,
            owner_receipt: None,
            next_legal_action: ArtifactBuildNextLegalAction::CorrectInputAndCreateSuccessorRequest,
        }),
    )
        .into_response();
    insert_rejection_code(&mut response, code);
    response
}

fn artifact_rejection(
    status: StatusCode,
    code: &str,
    build_request_identity: &str,
    attempt_identity: &str,
) -> Response {
    let mut response = (
        status,
        Json(ArtifactBuildResultV1 {
            schema_version: 1,
            resolution: ArtifactBuildResolution::RejectedNoWrite,
            build_request_identity: build_request_identity.to_string(),
            attempt_identity: attempt_identity.to_string(),
            owner_receipt: None,
            research_view: None,
            artifact_review: None,
            next_legal_action: ArtifactBuildNextLegalAction::CorrectInputAndCreateSuccessorRequest,
        }),
    )
        .into_response();
    insert_rejection_code(&mut response, code);
    response
}

fn insert_rejection_code(response: &mut Response, code: &str) {
    if let Ok(value) = code.parse() {
        response.headers_mut().insert("x-rd-rejection-code", value);
    }
}

fn owner_error(error: &ResearchGoalOwnerError, request_identity: &str) -> Response {
    match error {
        ResearchGoalOwnerError::ConflictingReplay => {
            let mut response = (
                StatusCode::CONFLICT,
                Json(identity_conflict_result(request_identity)),
            )
                .into_response();
            response.headers_mut().insert(
                "x-rd-rejection-code",
                "CONFLICTING_SEMANTICS_FOR_REQUEST_IDENTITY"
                    .parse()
                    .expect("static header value"),
            );
            response
        }
        ResearchGoalOwnerError::Unauthorized(_) => rejection(
            StatusCode::FORBIDDEN,
            "AUTHORIZATION_LINEAGE_REJECTED",
            request_identity,
        ),
        ResearchGoalOwnerError::Storage(_) => rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "OWNER_UNAVAILABLE",
            request_identity,
        ),
    }
}

fn rejection(status: StatusCode, code: &str, request_identity: &str) -> Response {
    let mut result = ResearchGoalOwnerResultV1 {
        schema_version: 1,
        resolution: ProductEdgeResolution::RejectedNoWrite,
        request_identity: request_identity.to_string(),
        owner_receipt: None,
        research_view: None,
        next_legal_action: ResearchNextLegalAction::CorrectInputAndCreateSuccessorRequest,
    };

    if code == "OWNER_UNAVAILABLE" {
        result.resolution = ProductEdgeResolution::SubmittedOrUnknown;
        result.next_legal_action = ResearchNextLegalAction::ResolveSameRequestIdentity;
    }
    let mut response = (status, Json(result)).into_response();
    if let Ok(value) = code.parse() {
        response.headers_mut().insert("x-rd-rejection-code", value);
    }
    response
}

fn authorized(headers: &HeaderMap, expected_digest: &[u8; 32]) -> bool {
    let Some(value) = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
    else {
        return false;
    };
    let actual: [u8; 32] = Sha256::digest(value.as_bytes()).into();
    actual
        .iter()
        .zip(expected_digest)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

async fn maybe_delay(state: &ApiState, headers: &HeaderMap) {
    if !state.allow_acceptance_faults {
        return;
    }
    let delay = headers
        .get("x-rd-acceptance-delay-after-commit-ms")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0)
        .min(30_000);

    if delay > 0 {
        tokio::time::sleep(Duration::from_millis(delay)).await;
    }
}

fn required_env(name: &str) -> anyhow::Result<String> {
    env::var(name).map_err(|_| anyhow::anyhow!("required environment variable {name} is missing"))
}

fn env_or(name: &str, default: &str) -> String {
    env::var(name).unwrap_or_else(|_| default.to_string())
}

fn trusted_context(policy: &ProductEdgeAdmissionPolicyV1) -> TrustedProductEdgeContextV1 {
    TrustedProductEdgeContextV1 {
        effective_principal: policy.effective_principal.clone(),
        permissioned_as: policy.permissioned_as.clone(),
        authorized_scope: vec![
            RESEARCH_SCOPE_V1.to_string(),
            RESEARCH_VIEW_SCOPE_V1.to_string(),
        ],
        shell_binding_identity: policy.shell_binding_identity.clone(),
        shell_history_head: policy.shell_history_head.clone(),
        shell_binding_generation: 1,
        shell_binding_state: "ACTIVE".to_string(),
        authorization_identity: policy.authorization_identity.clone(),
        authorization_policy_version: policy.authorization_policy_version.clone(),
        manifest_identity: policy.manifest_identity.clone(),
        manifest_version: policy.manifest_version.clone(),
        capability_policy_version: policy.capability_policy_version.clone(),
        audit_policy_version: policy.audit_policy_version.clone(),
        target_owner: RESEARCH_OWNER_V1.to_string(),
        target_operation: RESEARCH_GOAL_OPERATION_V1.to_string(),
        operation_schema: RESEARCH_GOAL_SCHEMA_V1.to_string(),
    }
}

fn artifact_trusted_context(policy: &ProductEdgeAdmissionPolicyV1) -> TrustedProductEdgeContextV1 {
    TrustedProductEdgeContextV1 {
        effective_principal: policy.effective_principal.clone(),
        permissioned_as: policy.permissioned_as.clone(),
        authorized_scope: vec![
            ARTIFACT_BUILD_SCOPE_V1.to_string(),
            ARTIFACT_VIEW_SCOPE_V1.to_string(),
        ],
        shell_binding_identity: policy.shell_binding_identity.clone(),
        shell_history_head: policy.shell_history_head.clone(),
        shell_binding_generation: 1,
        shell_binding_state: "ACTIVE".to_string(),
        authorization_identity: policy.authorization_identity.clone(),
        authorization_policy_version: policy.authorization_policy_version.clone(),
        manifest_identity: policy.manifest_identity.clone(),
        manifest_version: policy.manifest_version.clone(),
        capability_policy_version: policy.capability_policy_version.clone(),
        audit_policy_version: policy.audit_policy_version.clone(),
        target_owner: RESEARCH_OWNER_V1.to_string(),
        target_operation: ARTIFACT_BUILD_OPERATION_V1.to_string(),
        operation_schema: ARTIFACT_BUILD_SCHEMA_V1.to_string(),
    }
}
