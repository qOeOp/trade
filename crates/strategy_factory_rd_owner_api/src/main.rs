use std::{env, future::Future, sync::Arc, time::Duration};

use axum::{
    Json, Router,
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::net::TcpListener;
use vibe_data::owner::{
    source_binding::SourceBindingOwnerResolver, source_binding_resolver_from_admitted_postgres,
};
use vibe_deployment_store_admission::{
    RdOwnerStoreAdmissionBootstrap, admit_rd_owner_market_data_postgres,
};
use vibe_product_edge::{
    ARTIFACT_BUILD_REQUIRED_EFFECTS_V1, ProductEdgeAdmissionLocatorV1,
    ProductEdgeAdmissionReadbackV1, ProductEdgeAdmissionRequestV1, ProductEdgeAuthorizationTrustV1,
    ProductEdgeError, ProductEdgeInvocationClaimReadbackV1, ProductEdgeInvocationClaimRequestV1,
    ProductEdgeInvocationStateV1, ProductEdgePostgresOwnerV1,
};
use vibe_strategy_factory::{
    artifact_build::{
        ARTIFACT_BUILD_OPERATION_V1, ARTIFACT_BUILD_SCHEMA_V1, ArtifactBuildCandidateV1,
        ArtifactBuildError, ArtifactBuildInvocationCustodyV1, ArtifactBuildNextLegalAction,
        ArtifactBuildOwnerPort, ArtifactBuildPreparationV1, ArtifactBuildRequestV1,
        ArtifactBuildResolution, ArtifactBuildResultV1, ArtifactRequestIdentityPreflightV1,
        SANDBOX_SOCKET_DEFAULT,
    },
    artifact_build_postgres::PostgresArtifactBuildOwnerV1,
    develop_composer_operation_v2::DevelopComposerOperationResponseV2,
    develop_composer_sealed_acceptance_v2::default_unavailable_response,
    product_edge::{
        ProductEdgeChannel, ProductEdgeResearchGoalRequestV2, RESEARCH_GOAL_OPERATION_V2,
        RESEARCH_GOAL_SCHEMA_V2, RESEARCH_OWNER_V1, ResearchGoalOwnerError,
        ResearchGoalOwnerPortV2, SourcedResearchGoalV2, TrialFamilyProposalV1,
        identity_conflict_result, identity_conflict_result_v2, rejected_result, unresolved_result,
        unresolved_result_v2,
    },
    product_edge_postgres::{PostgresResearchGoalOwnerV1, ResearchRequestIdentityPreflightV1},
    trial_family::{TrialFamilyDirectResultV1, TrialFamilyError},
};

#[cfg(feature = "sealed-develop-composer-acceptance")]
use vibe_strategy_factory::develop_composer_operation_v2::DevelopComposerOperationDispositionV2;
#[cfg(not(feature = "sealed-develop-composer-acceptance"))]
use vibe_strategy_factory::develop_composer_operation_v2::DevelopComposerRunRequestV2;
#[cfg(feature = "sealed-develop-composer-acceptance")]
use vibe_strategy_factory::develop_composer_sealed_acceptance_v2::{
    SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2, SealedDevelopComposerAcceptanceV2,
    submitted_or_unknown_response,
};

mod source_intake;
mod source_intake_research;

#[derive(Clone)]
struct ApiState {
    product_edge: Arc<ProductEdgePostgresOwnerV1>,
    owner: Arc<PostgresResearchGoalOwnerV1>,
    artifact_owner: Arc<dyn ArtifactBuildOwnerPort>,
    token_digest: [u8; 32],
    request_proof_digest: String,
    allow_acceptance_faults: bool,
    _market_data_source_binding: Option<Arc<dyn SourceBindingOwnerResolver>>,
    #[cfg(feature = "sealed-develop-composer-acceptance")]
    develop_composer: Arc<SealedDevelopComposerAcceptanceV2>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ProductEdgeOperationRequestV2 {
    request_identity: String,
    channel: ProductEdgeChannel,
    goal: SourcedResearchGoalV2,
    trial_family_proposal: TrialFamilyProposalV1,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ArtifactFamilyResolveRequestV1 {
    artifact_identity: String,
    build_receipt_identity: String,
}

#[derive(Debug, Deserialize, Serialize)]
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

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ArtifactBuildInvocationStartOperationV1 {
    build_request_identity: String,
    attempt_identity: String,
    research_request_identity: String,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
struct ArtifactBuildInvocationStartApiResultV1 {
    invocation_start: vibe_product_edge::ProductEdgeInvocationStartReadbackV1,
    execution_custody: ArtifactBuildInvocationCustodyV1,
}

#[derive(Debug, Serialize)]
struct ArtifactBuildApiResultV1 {
    #[serde(flatten)]
    owner_result: ArtifactBuildResultV1,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider_invocation: Option<ProductEdgeInvocationClaimReadbackV1>,
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
    let market_data_source_binding = bootstrap_deployment_store_admission().await?;
    let database_url = required_env("RD_OWNER_DATABASE_URL")?;
    let qualification_database_url = required_env("QUALIFICATION_OWNER_DATABASE_URL")?;
    let product_edge_database_url = required_env("PRODUCT_EDGE_DATABASE_URL")?;
    let token = required_env("RD_OWNER_API_TOKEN")?;
    let token_digest: [u8; 32] = Sha256::digest(token.as_bytes()).into();
    let request_proof_digest = format!("sha256:{}", hex_digest(&token_digest));
    let product_edge = Arc::new(
        ProductEdgePostgresOwnerV1::connect(
            &product_edge_database_url,
            required_env("PRODUCT_EDGE_DEPLOYMENT_IDENTITY")?,
            ProductEdgeAuthorizationTrustV1 {
                issuer_identity: required_env("PRODUCT_EDGE_TRUSTED_ISSUER_IDENTITY")?,
                issuer_key_version: required_env("PRODUCT_EDGE_TRUSTED_ISSUER_KEY_VERSION")?,
                audience: required_env("PRODUCT_EDGE_TRUSTED_AUTHORIZATION_AUDIENCE")?,
            },
        )
        .await?,
    );
    let owner =
        PostgresResearchGoalOwnerV1::connect(&database_url, &qualification_database_url).await?;
    #[cfg(feature = "sealed-source-intake-acceptance")]
    let owner = owner.bind_sealed_source_intake_research_policy();
    let owner = Arc::new(owner);
    let artifact_owner = Arc::new(
        PostgresArtifactBuildOwnerV1::connect(
            &database_url,
            &env_or("RD_SANDBOX_SOCKET", SANDBOX_SOCKET_DEFAULT),
            env_or("RD_ARTIFACT_ATTEMPT_TIMEOUT_MS", "600000").parse()?,
        )
        .await?,
    );
    #[cfg(feature = "sealed-develop-composer-acceptance")]
    let develop_composer =
        Arc::new(SealedDevelopComposerAcceptanceV2::connect(&database_url).await?);
    let allow_acceptance_faults =
        env::var("RD_OWNER_ENABLE_ACCEPTANCE_FAULTS").as_deref() == Ok("1");
    let state = ApiState {
        product_edge: product_edge.clone(),
        owner: owner.clone(),
        artifact_owner,
        token_digest,
        request_proof_digest: request_proof_digest.clone(),
        allow_acceptance_faults,
        _market_data_source_binding: market_data_source_binding,
        #[cfg(feature = "sealed-develop-composer-acceptance")]
        develop_composer,
    };
    #[cfg(not(feature = "sealed-source-intake-acceptance"))]
    let source_intake = source_intake::production_router(
        product_edge.clone(),
        &database_url,
        token_digest,
        request_proof_digest.clone(),
    )
    .await?;
    #[cfg(feature = "sealed-source-intake-acceptance")]
    let source_intake = source_intake::sealed_acceptance_router(
        product_edge.clone(),
        &database_url,
        token_digest,
        request_proof_digest.clone(),
    )
    .await?;
    let app = Router::new()
        .route("/health", get(health))
        .route(
            "/v1/research-goals/{request_identity}/resolve",
            post(resolve),
        )
        .route("/v2/research-goals", post(submit_v2))
        .route(
            "/v2/research-goals/{request_identity}/resolve",
            post(resolve_v2),
        )
        .route(
            "/v1/trial-families/by-intent/{intent_identity}",
            post(resolve_family_by_intent),
        )
        .route(
            "/v1/trial-families/by-artifact",
            post(resolve_family_by_artifact),
        )
        .route("/v1/artifact-builds/prepare", post(prepare_artifact_build))
        .route(
            "/v1/artifact-builds/claim-provider-invocation",
            post(claim_provider_invocation),
        )
        .route(
            "/v1/artifact-builds/start-provider-invocation",
            post(start_provider_invocation),
        )
        .route(
            "/v1/artifact-builds/candidate",
            post(submit_artifact_candidate),
        )
        .route("/v1/artifact-builds/fail", post(fail_artifact_build))
        .route(
            "/v1/artifact-builds/{build_request_identity}/attempts/{attempt_identity}/resolve",
            post(resolve_artifact_build),
        )
        .route("/v2/develop-composer/runs", post(run_develop_composer))
        .route(
            "/v2/develop-composer/runs/{request_identity}/resolve",
            post(resolve_develop_composer),
        )
        .with_state(state)
        .merge(source_intake)
        .merge(source_intake_research::router(
            product_edge,
            owner,
            token_digest,
            request_proof_digest,
            allow_acceptance_faults,
        ));
    let address = env_or("RD_OWNER_LISTEN", "0.0.0.0:8080");
    let listener = TcpListener::bind(&address).await?;
    tracing::info!(listen = %address, "R&D Owner API ready");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn bootstrap_deployment_store_admission()
-> anyhow::Result<Option<Arc<dyn SourceBindingOwnerResolver>>> {
    enforce_deployment_store_admission(RdOwnerStoreAdmissionBootstrap::from_environment()?).await
}

#[cfg(test)]
async fn bootstrap_deployment_store_admission_from_lookup(
    lookup: impl FnMut(&str) -> Option<String>,
) -> anyhow::Result<Option<Arc<dyn SourceBindingOwnerResolver>>> {
    enforce_deployment_store_admission(RdOwnerStoreAdmissionBootstrap::from_lookup(lookup)?).await
}

async fn enforce_deployment_store_admission(
    bootstrap: RdOwnerStoreAdmissionBootstrap,
) -> anyhow::Result<Option<Arc<dyn SourceBindingOwnerResolver>>> {
    match bootstrap {
        RdOwnerStoreAdmissionBootstrap::Disabled => Ok(None),
        RdOwnerStoreAdmissionBootstrap::Required(request) => {
            let capability = admit_rd_owner_market_data_postgres(&request).await?;
            let receipt_identity = capability.receipt_identity().to_owned();
            let consumer_identity = capability.consumer_identity().to_owned();
            let resolver = source_binding_resolver_from_admitted_postgres(capability).await?;
            tracing::info!(
                receipt_identity,
                consumer = consumer_identity,
                "sealed Deployment Store Admission capability consumed by Market Data Source Binding read port"
            );
            Ok(Some(resolver))
        }
    }
}

async fn health() -> &'static str {
    "ok"
}

async fn run_develop_composer(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return composer_response(
            StatusCode::FORBIDDEN,
            default_unavailable_response("unbound"),
        );
    }

    #[cfg(not(feature = "sealed-develop-composer-acceptance"))]
    {
        let request: DevelopComposerRunRequestV2 = match serde_json::from_slice(&body) {
            Ok(request) => request,
            Err(_) => {
                return composer_response(
                    StatusCode::BAD_REQUEST,
                    default_unavailable_response("unbound"),
                );
            }
        };
        composer_response(
            StatusCode::SERVICE_UNAVAILABLE,
            default_unavailable_response(&request.request_identity),
        )
    }

    #[cfg(feature = "sealed-develop-composer-acceptance")]
    {
        if develop_composer_body_injects_evidence(&body) {
            return composer_response(
                StatusCode::BAD_REQUEST,
                default_unavailable_response(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2),
            );
        }

        match state.develop_composer.run().await {
            Ok(response) => composer_operation_response(response),
            Err(_) => composer_response(
                StatusCode::ACCEPTED,
                submitted_or_unknown_response(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2),
            ),
        }
    }
}

async fn resolve_develop_composer(
    State(state): State<ApiState>,
    Path(request_identity): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return composer_response(
            StatusCode::FORBIDDEN,
            default_unavailable_response(&request_identity),
        );
    }

    #[cfg(not(feature = "sealed-develop-composer-acceptance"))]
    {
        let _ = body;
        composer_response(
            StatusCode::SERVICE_UNAVAILABLE,
            default_unavailable_response(&request_identity),
        )
    }

    #[cfg(feature = "sealed-develop-composer-acceptance")]
    {
        if develop_composer_body_injects_evidence(&body) {
            return composer_response(
                StatusCode::BAD_REQUEST,
                default_unavailable_response(&request_identity),
            );
        }

        match state.develop_composer.resolve(&request_identity).await {
            Ok(response) => composer_operation_response(response),
            Err(_) => composer_response(
                StatusCode::ACCEPTED,
                submitted_or_unknown_response(&request_identity),
            ),
        }
    }
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
fn composer_operation_response(response: DevelopComposerOperationResponseV2) -> Response {
    let status = match response.disposition {
        DevelopComposerOperationDispositionV2::Success => StatusCode::OK,
        DevelopComposerOperationDispositionV2::Conflict => StatusCode::CONFLICT,
        DevelopComposerOperationDispositionV2::Unsupported
        | DevelopComposerOperationDispositionV2::NeedsResearchRefinement => {
            StatusCode::UNPROCESSABLE_ENTITY
        }
        DevelopComposerOperationDispositionV2::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
        DevelopComposerOperationDispositionV2::SubmittedOrUnknown => StatusCode::ACCEPTED,
    };
    composer_response(status, response)
}

fn composer_response(status: StatusCode, response: DevelopComposerOperationResponseV2) -> Response {
    (status, Json(response)).into_response()
}

#[cfg(any(test, feature = "sealed-develop-composer-acceptance"))]
fn develop_composer_body_injects_evidence(body: &[u8]) -> bool {
    body.iter().any(|byte| !byte.is_ascii_whitespace())
}

#[cfg(test)]
mod develop_composer_api_contract_tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn default_unavailable_contract_maps_to_service_unavailable_without_positive_projection() {
        let contract = default_unavailable_response("request-1");
        assert!(contract.receipt_identity.is_none());
        assert!(contract.artifact.is_none());
        assert_eq!(
            composer_response(StatusCode::SERVICE_UNAVAILABLE, contract).status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }

    #[rstest]
    fn caller_evidence_body_is_detected_while_an_empty_command_is_not() {
        assert!(!develop_composer_body_injects_evidence(b" \n\t"));
        assert!(develop_composer_body_injects_evidence(
            br#"{"module_bytes":"caller-selected"}"#
        ));
    }

    #[cfg(feature = "sealed-develop-composer-acceptance")]
    #[rstest]
    fn public_success_contract_maps_to_ok() {
        let response = DevelopComposerOperationResponseV2 {
            schema_version: 2,
            request_identity: SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2.to_owned(),
            disposition: DevelopComposerOperationDispositionV2::Success,
            receipt_identity: None,
            artifact: None,
            coordinate: None,
            reason: None,
        };
        assert_eq!(
            composer_operation_response(response).status(),
            StatusCode::OK
        );
    }
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
        .preflight_request_identity(&request_identity)
        .await
    {
        Ok(ResearchRequestIdentityPreflightV1::LegacyQuarantined) => {
            return match state
                .owner
                .resolve_legacy_quarantined_v1(&request_identity)
                .await
            {
                Ok(result) => (StatusCode::OK, Json(result)).into_response(),
                Err(e) => owner_error(&e, &request_identity),
            };
        }
        Err(e) => return owner_error(&e, &request_identity),
        Ok(
            ResearchRequestIdentityPreflightV1::Vacant
            | ResearchRequestIdentityPreflightV1::Current,
        ) => {}
    }
    let admission = match state
        .product_edge
        .resolve_admission(&request_identity, &state.request_proof_digest)
        .await
    {
        Ok(Some(admission)) => admission,
        Ok(None) => {
            return (
                StatusCode::ACCEPTED,
                Json(unresolved_result(&request_identity)),
            )
                .into_response();
        }
        Err(e) => return product_edge_error(&e, &request_identity, false),
    };

    match state
        .owner
        .resolve_historical_v1(&request_identity, admission.locator())
        .await
    {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => owner_error(&e, &request_identity),
    }
}

async fn submit_v2(State(state): State<ApiState>, headers: HeaderMap, body: Bytes) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection_v2(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }
    let operation: ProductEdgeOperationRequestV2 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return rejection_v2(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let request_identity = operation.request_identity.clone();

    match state
        .owner
        .preflight_request_identity(&request_identity)
        .await
    {
        Ok(ResearchRequestIdentityPreflightV1::LegacyQuarantined) | Err(_) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(unresolved_result_v2(&request_identity)),
            )
                .into_response();
        }
        Ok(
            ResearchRequestIdentityPreflightV1::Vacant
            | ResearchRequestIdentityPreflightV1::Current,
        ) => {}
    }
    let admission = match admit_product_edge_request(
        &state,
        &operation,
        &request_identity,
        RESEARCH_GOAL_OPERATION_V2,
        RESEARCH_GOAL_SCHEMA_V2,
        vec!["R_AND_D_RESEARCH_MUTATION_V1".to_string()],
    )
    .await
    {
        Ok(admission) => admission,
        Err(e) => return product_edge_error(&e, &request_identity, true),
    };
    let request = ProductEdgeResearchGoalRequestV2 {
        request_identity: operation.request_identity,
        channel: operation.channel,
        admission: admission.locator().clone(),
        goal: operation.goal,
        trial_family_proposal: operation.trial_family_proposal,
    };
    let request_identity = request.request_identity.clone();
    let response = match state.owner.submit_v2(request).await {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => owner_error_v2(&e, &request_identity),
    };
    maybe_delay(&state, &headers).await;
    response
}

async fn resolve_v2(
    State(state): State<ApiState>,
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

    match state
        .owner
        .preflight_request_identity(&request_identity)
        .await
    {
        Ok(ResearchRequestIdentityPreflightV1::LegacyQuarantined) | Err(_) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(unresolved_result_v2(&request_identity)),
            )
                .into_response();
        }
        Ok(
            ResearchRequestIdentityPreflightV1::Vacant
            | ResearchRequestIdentityPreflightV1::Current,
        ) => {}
    }
    let admission = match state
        .product_edge
        .resolve_admission(&request_identity, &state.request_proof_digest)
        .await
    {
        Ok(Some(admission)) => admission,
        Ok(None) => {
            return (
                StatusCode::ACCEPTED,
                Json(unresolved_result_v2(&request_identity)),
            )
                .into_response();
        }
        Err(e) => return product_edge_error(&e, &request_identity, true),
    };

    match state
        .owner
        .resolve_v2(&request_identity, admission.locator())
        .await
    {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => owner_error_v2(&e, &request_identity),
    }
}

async fn resolve_family_by_intent(
    State(state): State<ApiState>,
    Path(intent_identity): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }
    direct_family_response(
        state
            .owner
            .resolve_trial_family_by_intent(&intent_identity)
            .await,
    )
}

async fn resolve_family_by_artifact(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<ArtifactFamilyResolveRequestV1>,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }

    match state
        .owner
        .resolve_trial_family_by_artifact(
            &request.artifact_identity,
            &request.build_receipt_identity,
        )
        .await
    {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => direct_family_error(&e),
    }
}

fn direct_family_response(result: Result<TrialFamilyDirectResultV1, TrialFamilyError>) -> Response {
    match result {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => direct_family_error(&e),
    }
}

fn direct_family_error(error: &TrialFamilyError) -> Response {
    let (status, result) = match error {
        TrialFamilyError::LegacyUnavailable => (
            StatusCode::UNPROCESSABLE_ENTITY,
            TrialFamilyDirectResultV1::legacy_unavailable(),
        ),
        _ => (
            StatusCode::SERVICE_UNAVAILABLE,
            TrialFamilyDirectResultV1::unavailable(),
        ),
    };
    (status, Json(result)).into_response()
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
    let request = match artifact_request(&state, operation).await {
        Ok(request) => request,
        Err((error, request_identity, attempt_identity)) => {
            return artifact_product_edge_error(&error, &request_identity, &attempt_identity);
        }
    };
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
    let request = match artifact_request(&state, operation.request).await {
        Ok(request) => request,
        Err((error, request_identity, attempt_identity)) => {
            return artifact_product_edge_error(&error, &request_identity, &attempt_identity);
        }
    };
    let build_request_identity = request.build_request_identity.clone();
    let attempt_identity = request.attempt_identity.clone();
    let admission = request.admission.clone();
    let invocation = match state
        .product_edge
        .resolve_provider_invocation_claim(&admission, &attempt_identity)
        .await
    {
        Ok(invocation) => invocation,
        Err(e) => {
            return artifact_product_edge_error(&e, &build_request_identity, &attempt_identity);
        }
    };
    let started = invocation
        .as_ref()
        .filter(|claim| claim.state() == ProductEdgeInvocationStateV1::InvocationStarted);
    let response = match state
        .artifact_owner
        .submit_candidate(request, operation.candidate, started)
        .await
    {
        Ok(result) => artifact_result_response(&state, &admission, &attempt_identity, result).await,
        Err(e) => artifact_error(&e, &build_request_identity, &attempt_identity),
    };
    maybe_delay(&state, &headers).await;
    response
}

async fn claim_provider_invocation(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let operation: ArtifactBuildOperationRequestV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    let request = match artifact_request(&state, operation).await {
        Ok(request) => request,
        Err((error, request_identity, attempt_identity)) => {
            return artifact_product_edge_error(&error, &request_identity, &attempt_identity);
        }
    };

    match state
        .product_edge
        .resolve_provider_invocation_claim(&request.admission, &request.attempt_identity)
        .await
    {
        Ok(Some(existing)) => return (StatusCode::OK, Json(existing)).into_response(),
        Ok(None) => {}
        Err(e) => {
            return artifact_product_edge_error(
                &e,
                &request.build_request_identity,
                &request.attempt_identity,
            );
        }
    }
    let preparation = match state.artifact_owner.prepare(request.clone()).await {
        Ok(preparation) => preparation,
        Err(e) => {
            return artifact_preparation_error(
                &e,
                &request.build_request_identity,
                &request.attempt_identity,
            );
        }
    };

    if preparation.resolution() != ArtifactBuildResolution::Prepared {
        return (StatusCode::CONFLICT, Json(preparation)).into_response();
    }

    match state
        .product_edge
        .claim_provider_invocation(ProductEdgeInvocationClaimRequestV1 {
            admission: request.admission,
            attempt_identity: request.attempt_identity,
        })
        .await
    {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => artifact_product_edge_error(&e, &request.build_request_identity, "unavailable"),
    }
}

async fn start_provider_invocation(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let operation: ArtifactBuildInvocationStartOperationV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    let build_request_identity = operation.build_request_identity;
    let attempt_identity = operation.attempt_identity;
    let research_request_identity = operation.research_request_identity;
    let claim = match state
        .product_edge
        .resolve_provider_invocation_claim_by_request(&build_request_identity, &attempt_identity)
        .await
    {
        Ok(Some(claim)) => claim,
        Ok(None) => {
            return artifact_product_edge_error(
                &ProductEdgeError::Unavailable,
                &build_request_identity,
                &attempt_identity,
            );
        }
        Err(e) => {
            return artifact_product_edge_error(&e, &build_request_identity, &attempt_identity);
        }
    };

    if !invocation_start_recovery_state(claim.state()) {
        return artifact_unknown(
            StatusCode::CONFLICT,
            "PROVIDER_INVOCATION_OUTCOME_UNKNOWN",
            &build_request_identity,
            &attempt_identity,
        );
    }
    let reserved = match state
        .artifact_owner
        .reserve_provider_invocation_custody(&build_request_identity, &attempt_identity, claim)
        .await
    {
        Ok(custody) => custody,
        Err(e) => {
            return artifact_preparation_error(&e, &build_request_identity, &attempt_identity);
        }
    };

    let (start_reservation, execution_custody) = reserved.into_parts();
    if execution_custody.research_request_identity() != research_request_identity {
        return artifact_unknown(
            StatusCode::CONFLICT,
            "RESEARCH_REQUEST_IDENTITY_CONFLICT",
            &build_request_identity,
            &attempt_identity,
        );
    }

    match state
        .product_edge
        .start_provider_invocation(start_reservation)
        .await
    {
        Ok(invocation_start) => (
            StatusCode::OK,
            Json(ArtifactBuildInvocationStartApiResultV1 {
                invocation_start,
                execution_custody,
            }),
        )
            .into_response(),
        Err(e) => artifact_product_edge_error(&e, &build_request_identity, &attempt_identity),
    }
}

fn invocation_start_recovery_state(state: ProductEdgeInvocationStateV1) -> bool {
    matches!(
        state,
        ProductEdgeInvocationStateV1::Claimed | ProductEdgeInvocationStateV1::InvocationStarted
    )
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
    let request = match artifact_request(&state, operation.request).await {
        Ok(request) => request,
        Err((error, request_identity, attempt_identity)) => {
            return artifact_product_edge_error(&error, &request_identity, &attempt_identity);
        }
    };
    let build_request_identity = request.build_request_identity.clone();
    let attempt_identity = request.attempt_identity.clone();
    let admission = request.admission.clone();
    let invocation = match state
        .product_edge
        .resolve_provider_invocation_claim(&admission, &attempt_identity)
        .await
    {
        Ok(invocation) => invocation,
        Err(e) => {
            return artifact_product_edge_error(&e, &build_request_identity, &attempt_identity);
        }
    };
    let started = invocation
        .as_ref()
        .filter(|claim| claim.state() == ProductEdgeInvocationStateV1::InvocationStarted);

    match state
        .artifact_owner
        .fail_no_artifact(request, &operation.failure_code, started)
        .await
    {
        Ok(result) => artifact_result_response(&state, &admission, &attempt_identity, result).await,
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
        .preflight_request_identity(&build_request_identity, &attempt_identity)
        .await
    {
        Ok(ArtifactRequestIdentityPreflightV1::LegacyTerminalQuarantined) => {
            return match state
                .artifact_owner
                .resolve_legacy_terminal_quarantined(&build_request_identity, &attempt_identity)
                .await
            {
                Ok(result) => (StatusCode::OK, Json(result)).into_response(),
                Err(e) => artifact_error(&e, &build_request_identity, &attempt_identity),
            };
        }
        Ok(
            ArtifactRequestIdentityPreflightV1::Vacant
            | ArtifactRequestIdentityPreflightV1::Current,
        ) => {}
        Err(e) => {
            return artifact_error(&e, &build_request_identity, &attempt_identity);
        }
    }

    let admission = match state
        .product_edge
        .resolve_admission(&build_request_identity, &state.request_proof_digest)
        .await
    {
        Ok(Some(admission)) => admission,
        Ok(None) => {
            return artifact_unknown(
                StatusCode::SERVICE_UNAVAILABLE,
                "OWNER_OUTCOME_UNKNOWN",
                &build_request_identity,
                &attempt_identity,
            );
        }
        Err(e) => {
            return artifact_product_edge_error(&e, &build_request_identity, &attempt_identity);
        }
    };

    match state
        .artifact_owner
        .resolve(
            &build_request_identity,
            &attempt_identity,
            admission.locator(),
        )
        .await
    {
        Ok(result) => {
            artifact_result_response(&state, admission.locator(), &attempt_identity, result).await
        }
        Err(e) => artifact_error(&e, &build_request_identity, &attempt_identity),
    }
}

async fn artifact_result_response(
    state: &ApiState,
    admission: &ProductEdgeAdmissionLocatorV1,
    attempt_identity: &str,
    owner_result: ArtifactBuildResultV1,
) -> Response {
    if owner_result.owner_receipt().is_some() {
        return (
            StatusCode::OK,
            Json(ArtifactBuildApiResultV1 {
                owner_result,
                provider_invocation: None,
            }),
        )
            .into_response();
    }

    match state
        .product_edge
        .resolve_provider_invocation_claim(admission, attempt_identity)
        .await
    {
        Ok(provider_invocation) => (
            StatusCode::OK,
            Json(ArtifactBuildApiResultV1 {
                owner_result,
                provider_invocation,
            }),
        )
            .into_response(),
        Err(e) => artifact_product_edge_error(&e, &admission.request_identity, attempt_identity),
    }
}

async fn artifact_request(
    state: &ApiState,
    operation: ArtifactBuildOperationRequestV1,
) -> Result<ArtifactBuildRequestV1, (ProductEdgeError, String, String)> {
    let build_request_identity = operation.build_request_identity.clone();
    let attempt_identity = operation.attempt_identity.clone();
    let admission = preflight_then_admit_artifact_request(
        state.artifact_owner.as_ref(),
        &build_request_identity,
        &attempt_identity,
        || admit_artifact_product_edge_request(state, &operation, &build_request_identity),
    )
    .await?;
    Ok(ArtifactBuildRequestV1 {
        build_request_identity: operation.build_request_identity,
        attempt_identity: operation.attempt_identity,
        intent_identity: operation.intent_identity,
        channel: operation.channel,
        admission: admission.locator().clone(),
    })
}

async fn admit_artifact_product_edge_request(
    state: &ApiState,
    operation: &ArtifactBuildOperationRequestV1,
    build_request_identity: &str,
) -> Result<ProductEdgeAdmissionReadbackV1, ProductEdgeError> {
    state
        .product_edge
        .admit_artifact_build_request(ProductEdgeAdmissionRequestV1 {
            request_identity: build_request_identity.to_string(),
            typed_payload: serde_json::to_value(operation)
                .map_err(|e| ProductEdgeError::Storage(e.to_string()))?,
            operation: ARTIFACT_BUILD_OPERATION_V1.to_string(),
            operation_schema: ARTIFACT_BUILD_SCHEMA_V1.to_string(),
            target_owner: RESEARCH_OWNER_V1.to_string(),
            requested_effects: ARTIFACT_BUILD_REQUIRED_EFFECTS_V1
                .iter()
                .map(|effect| (*effect).to_string())
                .collect(),
            request_proof_digest: state.request_proof_digest.clone(),
            audit_correlation: format!("rd-workbench:{build_request_identity}"),
        })
        .await
}

async fn preflight_then_admit_artifact_request<T, Admit, AdmitFuture>(
    artifact_owner: &dyn ArtifactBuildOwnerPort,
    build_request_identity: &str,
    attempt_identity: &str,
    admit: Admit,
) -> Result<T, (ProductEdgeError, String, String)>
where
    Admit: FnOnce() -> AdmitFuture,
    AdmitFuture: Future<Output = Result<T, ProductEdgeError>>,
{
    match artifact_owner
        .preflight_request_identity(build_request_identity, attempt_identity)
        .await
    {
        Ok(
            ArtifactRequestIdentityPreflightV1::Vacant
            | ArtifactRequestIdentityPreflightV1::Current,
        ) => {}
        Ok(ArtifactRequestIdentityPreflightV1::LegacyTerminalQuarantined) | Err(_) => {
            return Err((
                ProductEdgeError::Unavailable,
                build_request_identity.to_string(),
                attempt_identity.to_string(),
            ));
        }
    }

    admit().await.map_err(|e| {
        (
            e,
            build_request_identity.to_string(),
            attempt_identity.to_string(),
        )
    })
}

fn artifact_preparation_error(
    error: &ArtifactBuildError,
    build_request_identity: &str,
    attempt_identity: &str,
) -> Response {
    let (status, code, resolution, _next) = artifact_error_parts(error);
    let preparation = match resolution {
        ArtifactBuildResolution::IdentityConflict => {
            ArtifactBuildPreparationV1::identity_conflict(build_request_identity, attempt_identity)
        }
        ArtifactBuildResolution::SubmittedOrUnknown => {
            ArtifactBuildPreparationV1::submitted_or_unknown(
                build_request_identity,
                attempt_identity,
            )
        }
        _ => ArtifactBuildPreparationV1::submitted_or_unknown(
            build_request_identity,
            attempt_identity,
        ),
    };
    let mut response = (status, Json(preparation)).into_response();
    insert_rejection_code(&mut response, code);
    response
}

fn artifact_error(
    error: &ArtifactBuildError,
    build_request_identity: &str,
    attempt_identity: &str,
) -> Response {
    let (status, code, resolution, _next) = artifact_error_parts(error);
    let mut response = (
        status,
        Json(match resolution {
            ArtifactBuildResolution::IdentityConflict => {
                ArtifactBuildResultV1::identity_conflict(build_request_identity, attempt_identity)
            }
            ArtifactBuildResolution::SubmittedOrUnknown => {
                ArtifactBuildResultV1::submitted_or_unknown(
                    build_request_identity,
                    attempt_identity,
                )
            }
            _ => ArtifactBuildResultV1::submitted_or_unknown(
                build_request_identity,
                attempt_identity,
            ),
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
            ArtifactBuildResolution::SubmittedOrUnknown,
            ArtifactBuildNextLegalAction::ResolveSameAttemptIdentity,
        ),
        ArtifactBuildError::Candidate(_) => (
            StatusCode::BAD_REQUEST,
            "CANDIDATE_REJECTED",
            ArtifactBuildResolution::SubmittedOrUnknown,
            ArtifactBuildNextLegalAction::ResolveSameAttemptIdentity,
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
        Json(ArtifactBuildPreparationV1::submitted_or_unknown(
            build_request_identity,
            attempt_identity,
        )),
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
        Json(ArtifactBuildResultV1::submitted_or_unknown(
            build_request_identity,
            attempt_identity,
        )),
    )
        .into_response();
    insert_rejection_code(&mut response, code);
    response
}

fn artifact_unknown(
    status: StatusCode,
    code: &str,
    build_request_identity: &str,
    attempt_identity: &str,
) -> Response {
    let mut response = (
        status,
        Json(ArtifactBuildResultV1::submitted_or_unknown(
            build_request_identity,
            attempt_identity,
        )),
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

fn owner_error_v2(error: &ResearchGoalOwnerError, request_identity: &str) -> Response {
    match error {
        ResearchGoalOwnerError::ConflictingReplay => {
            let result = identity_conflict_result_v2(request_identity);
            let mut response = (StatusCode::CONFLICT, Json(result)).into_response();
            insert_rejection_code(&mut response, "CONFLICTING_SEMANTICS_FOR_REQUEST_IDENTITY");
            response
        }
        ResearchGoalOwnerError::Unauthorized(_) => rejection_v2(
            StatusCode::FORBIDDEN,
            "AUTHORIZATION_LINEAGE_REJECTED",
            request_identity,
        ),
        ResearchGoalOwnerError::Storage(_) => rejection_v2(
            StatusCode::SERVICE_UNAVAILABLE,
            "OWNER_UNAVAILABLE",
            request_identity,
        ),
    }
}

fn rejection(status: StatusCode, code: &str, request_identity: &str) -> Response {
    let result = if code == "OWNER_UNAVAILABLE" {
        unresolved_result(request_identity)
    } else {
        rejected_result(request_identity)
    };
    let mut response = (status, Json(result)).into_response();
    if let Ok(value) = code.parse() {
        response.headers_mut().insert("x-rd-rejection-code", value);
    }
    response
}

fn rejection_v2(status: StatusCode, code: &str, request_identity: &str) -> Response {
    // This boundary has no canonical R&D Owner receipt. Transport, authorization,
    // validation, and availability failures therefore cannot prove a no-write
    // terminal outcome or authorize a successor request.
    let result = unresolved_result_v2(request_identity);
    let mut response = (status, Json(result)).into_response();
    insert_rejection_code(&mut response, code);
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

async fn admit_product_edge_request<T: Serialize>(
    state: &ApiState,
    typed_payload: &T,
    request_identity: &str,
    operation: &str,
    operation_schema: &str,
    requested_effects: Vec<String>,
) -> Result<ProductEdgeAdmissionReadbackV1, ProductEdgeError> {
    state
        .product_edge
        .admit_request(ProductEdgeAdmissionRequestV1 {
            request_identity: request_identity.to_string(),
            typed_payload: serde_json::to_value(typed_payload)
                .map_err(|e| ProductEdgeError::Storage(e.to_string()))?,
            operation: operation.to_string(),
            operation_schema: operation_schema.to_string(),
            target_owner: RESEARCH_OWNER_V1.to_string(),
            requested_effects,
            request_proof_digest: state.request_proof_digest.clone(),
            audit_correlation: format!("rd-workbench:{request_identity}"),
        })
        .await
}

fn product_edge_error(error: &ProductEdgeError, request_identity: &str, v2: bool) -> Response {
    let status = match error {
        ProductEdgeError::ConflictingReplay => StatusCode::CONFLICT,
        ProductEdgeError::InvalidProposal(_) => StatusCode::BAD_REQUEST,
        ProductEdgeError::Unavailable | ProductEdgeError::Storage(_) => {
            StatusCode::SERVICE_UNAVAILABLE
        }
    };

    if v2 {
        (status, Json(unresolved_result_v2(request_identity))).into_response()
    } else {
        (status, Json(unresolved_result(request_identity))).into_response()
    }
}

fn artifact_product_edge_error(
    error: &ProductEdgeError,
    build_request_identity: &str,
    attempt_identity: &str,
) -> Response {
    let (status, code, result) = match error {
        ProductEdgeError::ConflictingReplay => (
            StatusCode::CONFLICT,
            "CONFLICTING_SEMANTICS_FOR_REQUEST_IDENTITY",
            ArtifactBuildResultV1::identity_conflict(build_request_identity, attempt_identity),
        ),
        ProductEdgeError::InvalidProposal(_) => (
            StatusCode::BAD_REQUEST,
            "PRODUCT_EDGE_REQUEST_REJECTED",
            ArtifactBuildResultV1::submitted_or_unknown(build_request_identity, attempt_identity),
        ),
        ProductEdgeError::Unavailable | ProductEdgeError::Storage(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "OWNER_OUTCOME_UNKNOWN",
            ArtifactBuildResultV1::submitted_or_unknown(build_request_identity, attempt_identity),
        ),
    };
    let mut response = (status, Json(result)).into_response();
    insert_rejection_code(&mut response, code);
    response
}

fn hex_digest(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    encoded
}

fn env_or(name: &str, default: &str) -> String {
    env::var(name).unwrap_or_else(|_| default.to_string())
}

#[cfg(test)]
mod tests {
    use std::{
        sync::atomic::{AtomicUsize, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    use async_trait::async_trait;
    use rstest::rstest;
    use vibe_operator_authorization::{
        OperationManifestBindingV1, OperatorAuthorizationIssuanceProposalV1,
        OperatorAuthorizationIssuerPostgresV1, OperatorAuthorizationScopeV1,
    };
    use vibe_product_edge::{AgentOperationManifestProposalV1, ProductEdgeBootstrapProposalV1};
    use vibe_rd_artifact_invocation_custody::{
        ArtifactInvocationReservationMeaningV1, seal_invocation_reservation,
    };
    use vibe_strategy_factory::{
        artifact_build::{ARTIFACT_BUILD_SCOPE_V1, ReservedArtifactBuildInvocationV1},
        product_edge::{RESEARCH_SCOPE_V1, RESEARCH_VIEW_SCOPE_V1, ResearchSourceV1},
    };
    use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

    use super::*;

    #[tokio::test]
    async fn deployment_store_consumer_seam_preserves_default_and_fails_closed_when_required() {
        assert!(
            bootstrap_deployment_store_admission_from_lookup(|_| None)
                .await
                .is_ok()
        );

        let invalid_mode = bootstrap_deployment_store_admission_from_lookup(|name| {
            (name == "DEPLOYMENT_STORE_ADMISSION_MODE").then(|| "positive".to_string())
        })
        .await
        .err()
        .expect("invalid mode must fail closed");
        assert!(
            invalid_mode
                .downcast_ref::<vibe_deployment_store_admission::BootstrapConfigurationError>()
                .is_some_and(|e| *e
                    == vibe_deployment_store_admission::BootstrapConfigurationError::InvalidMode)
        );
        let empty_mode = bootstrap_deployment_store_admission_from_lookup(|name| {
            (name == "DEPLOYMENT_STORE_ADMISSION_MODE").then(String::new)
        })
        .await
        .err()
        .expect("empty mode must fail closed");
        assert!(
            empty_mode
                .downcast_ref::<vibe_deployment_store_admission::BootstrapConfigurationError>()
                .is_some_and(|e| *e
                    == vibe_deployment_store_admission::BootstrapConfigurationError::InvalidMode)
        );

        let missing_head = bootstrap_deployment_store_admission_from_lookup(|name| match name {
            "DEPLOYMENT_STORE_ADMISSION_MODE" => Some("required".to_string()),
            "DEPLOYMENT_STORE_ENVIRONMENT_IDENTITY" => Some("test-environment".to_string()),
            "DEPLOYMENT_STORE_DEPLOYMENT_IDENTITY" => Some("rd-workbench-test".to_string()),
            _ => None,
        })
        .await
        .err()
        .expect("missing head must fail closed");
        assert!(
            missing_head
                .downcast_ref::<vibe_deployment_store_admission::BootstrapConfigurationError>()
                .is_some_and(|e| matches!(
            e,
            vibe_deployment_store_admission::BootstrapConfigurationError::MissingRequiredIdentity(
                "DEPLOYMENT_STORE_EXPECTED_HEAD_IDENTITY"
            )
        ))
        );

        let unavailable = bootstrap_deployment_store_admission_from_lookup(|name| match name {
            "DEPLOYMENT_STORE_ADMISSION_MODE" => Some("required".to_string()),
            "DEPLOYMENT_STORE_ENVIRONMENT_IDENTITY" => Some("test-environment".to_string()),
            "DEPLOYMENT_STORE_DEPLOYMENT_IDENTITY" => Some("rd-workbench-test".to_string()),
            "DEPLOYMENT_STORE_EXPECTED_HEAD_IDENTITY" => Some(format!("sha256:{}", "a".repeat(64))),
            _ => None,
        })
        .await
        .err()
        .expect("unavailable production admission must fail closed");
        assert!(
            unavailable
                .downcast_ref::<vibe_deployment_store_admission::DeploymentStoreAdmissionError>()
                .is_some_and(|e| {
                    e.code()
            == vibe_deployment_store_admission::AdmissionFailureCode::ProductionResolverUnavailable
                })
        );
    }

    async fn assert_receiptless_artifact_unknown(response: Response) {
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["resolution"], "SUBMITTED_OR_UNKNOWN");
        assert_eq!(value["owner_receipt"], serde_json::Value::Null);
        assert_eq!(value["next_legal_action"], "RESOLVE_SAME_ATTEMPT_IDENTITY");
    }

    #[tokio::test]
    async fn receiptless_artifact_failures_require_same_attempt_resolution() {
        for response in [
            artifact_error(
                &ArtifactBuildError::Candidate("provider failure code"),
                "build-1",
                "attempt-1",
            ),
            artifact_error(
                &ArtifactBuildError::Unauthorized("lineage"),
                "build-1",
                "attempt-1",
            ),
            artifact_rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "build-1",
                "attempt-1",
            ),
            artifact_product_edge_error(
                &ProductEdgeError::InvalidProposal("request admission"),
                "build-1",
                "attempt-1",
            ),
        ] {
            assert_receiptless_artifact_unknown(response).await;
        }

        assert_receiptless_artifact_unknown(artifact_preparation_rejection(
            StatusCode::FORBIDDEN,
            "AUTHORIZATION_LINEAGE_REJECTED",
            "build-1",
            "attempt-1",
        ))
        .await;
    }

    #[rstest]
    fn invocation_start_recovery_accepts_claimed_and_started_custody() {
        assert!(invocation_start_recovery_state(
            ProductEdgeInvocationStateV1::Claimed
        ));
        assert!(invocation_start_recovery_state(
            ProductEdgeInvocationStateV1::InvocationStarted
        ));
    }

    async fn bootstrap_api_test_product_edge(
        test_database: &CanonicalOwnerPostgresTestDatabaseV1,
        suffix: &str,
        request_proof_digest: &str,
    ) -> ProductEdgePostgresOwnerV1 {
        let now: u64 = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis()
            .try_into()
            .unwrap();
        let principal = format!("rd-api-retry-principal-{suffix}");
        let mut manifests = vec![
            AgentOperationManifestProposalV1 {
                operation: RESEARCH_GOAL_OPERATION_V2.to_string(),
                operation_schema: RESEARCH_GOAL_SCHEMA_V2.to_string(),
                target_owner: RESEARCH_OWNER_V1.to_string(),
                allowed_effects: vec!["R_AND_D_RESEARCH_MUTATION_V1".to_string()],
                prohibited_effects: vec!["REAL_TRADING_V1".to_string()],
                capability_policy_digest: format!("sha256:{}", "c".repeat(64)),
                effective_from_epoch_ms: now.saturating_sub(1_000),
                valid_through_epoch_ms: now.saturating_add(3_600_000),
            },
            AgentOperationManifestProposalV1 {
                operation: ARTIFACT_BUILD_OPERATION_V1.to_string(),
                operation_schema: ARTIFACT_BUILD_SCHEMA_V1.to_string(),
                target_owner: RESEARCH_OWNER_V1.to_string(),
                allowed_effects: vec![
                    "R_AND_D_ARTIFACT_BUILD_MUTATION_V1".to_string(),
                    "R_AND_D_PROVIDER_INVOCATION_V1".to_string(),
                ],
                prohibited_effects: vec!["REAL_TRADING_V1".to_string()],
                capability_policy_digest: format!("sha256:{}", "d".repeat(64)),
                effective_from_epoch_ms: now.saturating_sub(1_000),
                valid_through_epoch_ms: now.saturating_add(3_600_000),
            },
        ];
        manifests.sort_by_key(|manifest| manifest.manifest_identity().unwrap());
        let operation_manifests = manifests
            .iter()
            .map(|manifest| OperationManifestBindingV1 {
                manifest_identity: manifest.manifest_identity().unwrap(),
                manifest_digest: manifest.manifest_digest().unwrap(),
            })
            .collect();
        let issuer = OperatorAuthorizationIssuerPostgresV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter),
        )
        .await
        .unwrap();
        let authorization = issuer
            .issue_genesis(OperatorAuthorizationIssuanceProposalV1 {
                authorization_identity: format!("rd-api-retry-authorization-{suffix}"),
                issuer_identity: "operator-authorization-issuer-test-v1".to_string(),
                issuer_key_version: "test-key-v1".to_string(),
                scope: OperatorAuthorizationScopeV1 {
                    principal: principal.clone(),
                    audience: RESEARCH_OWNER_V1.to_string(),
                    permissions: vec![
                        ARTIFACT_BUILD_SCOPE_V1.to_string(),
                        RESEARCH_SCOPE_V1.to_string(),
                        RESEARCH_VIEW_SCOPE_V1.to_string(),
                    ],
                },
                request_proof_digest: request_proof_digest.to_string(),
                operation_manifests,
                not_before_epoch_ms: now.saturating_sub(1_000),
                valid_through_epoch_ms: now.saturating_add(3_600_000),
                expected_revocation_head: "EMPTY".to_string(),
            })
            .await
            .unwrap();
        let deployment_identity = format!("rd-api-retry-deployment-{suffix}");
        let product_edge = ProductEdgePostgresOwnerV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner),
            &deployment_identity,
            ProductEdgeAuthorizationTrustV1 {
                issuer_identity: "operator-authorization-issuer-test-v1".to_string(),
                issuer_key_version: "test-key-v1".to_string(),
                audience: RESEARCH_OWNER_V1.to_string(),
            },
        )
        .await
        .unwrap();
        product_edge
            .bootstrap_genesis(ProductEdgeBootstrapProposalV1 {
                deployment_identity,
                binding_identity: format!("rd-api-retry-binding-{suffix}"),
                expected_history_head: "EMPTY".to_string(),
                generation: 1,
                effective_principal: principal,
                scope_policy_version: "research-scope-v1".to_string(),
                capability_policy_version: "capability-v1".to_string(),
                audit_policy_version: "audit-v1".to_string(),
                valid_from_epoch_ms: now.saturating_sub(1_000),
                valid_through_epoch_ms: now.saturating_add(3_600_000),
                authorization: authorization.locator(),
                manifests,
            })
            .await
            .unwrap();
        product_edge
    }

    #[tokio::test]
    #[ignore = "requires the disposable canonical OA/PE/R&D/Qualification PostgreSQL topology"]
    async fn same_identity_started_retry_returns_http_ok_with_exact_custody_once() {
        let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let mutation = test_database.mutation();
        let token = "rd-owner-api-start-retry-test";
        let token_digest: [u8; 32] = Sha256::digest(token.as_bytes()).into();
        let request_proof_digest = format!("sha256:{}", hex_digest(&token_digest));
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let product_edge = Arc::new(
            bootstrap_api_test_product_edge(
                &test_database,
                &suffix.to_string(),
                &request_proof_digest,
            )
            .await,
        );
        let product_edge_pool = mutation.pool(CanonicalOwnerTestRoleV1::ProductEdgeOwner);
        let owner = Arc::new(
            PostgresResearchGoalOwnerV1::connect(
                test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
                test_database.database_url(CanonicalOwnerTestRoleV1::QualificationWriter),
            )
            .await
            .unwrap(),
        );
        let artifact_owner = Arc::new(
            PostgresArtifactBuildOwnerV1::connect(
                test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
                "/tmp/unused-rd-sandbox.sock",
                u64::MAX,
            )
            .await
            .unwrap(),
        );
        let state = ApiState {
            product_edge,
            owner,
            artifact_owner,
            token_digest,
            request_proof_digest,
            allow_acceptance_faults: false,
            _market_data_source_binding: None,
            #[cfg(feature = "sealed-develop-composer-acceptance")]
            develop_composer: Arc::new(
                SealedDevelopComposerAcceptanceV2::connect(
                    test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
                )
                .await
                .unwrap(),
            ),
        };
        let headers = bearer_headers(token);
        let research_request_identity = format!("rd-api-retry-research-{suffix}");
        let research = ProductEdgeOperationRequestV2 {
            request_identity: research_request_identity.clone(),
            channel: ProductEdgeChannel::WindmillProductEdge,
            goal: SourcedResearchGoalV2 {
                hypothesis: "A bounded point-in-time continuation effect remains after costs."
                    .to_string(),
                mechanism: "Slow information diffusion creates bounded continuation.".to_string(),
                falsification_question: "Does the effect disappear after exact modeled costs?"
                    .to_string(),
                expected_observation: "Net continuation remains positive.".to_string(),
                required_data: vec!["PIT adjusted bars".to_string()],
                cost_assumption: "Exact test cost model identity.".to_string(),
                capacity_assumption: "Exact test capacity model identity.".to_string(),
                sources: vec![ResearchSourceV1 {
                    locator: "https://example.com/rd-api-retry".to_string(),
                    content_digest: format!("sha256:{}", "a".repeat(64)),
                    observed_at: "2026-08-23T00:00:00Z".to_string(),
                    source_cut: "rd-api-retry-source-cut-v1".to_string(),
                    license_basis: "public research".to_string(),
                    interpretation: "Bounded API retry fixture only.".to_string(),
                }],
            },
            trial_family_proposal: TrialFamilyProposalV1 {
                trial_budget: 2,
                stop_rule: "Stop on falsifier or unavailable PIT input.".to_string(),
                pit_rule_identity: "pit-rule-v1".to_string(),
                cost_model_identity: "cost-model-v1".to_string(),
                slippage_model_identity: "slippage-model-v1".to_string(),
                capacity_model_identity: "capacity-model-v1".to_string(),
                independence_rationale: "Fresh isolated API retry family.".to_string(),
            },
        };
        let research_response = Box::pin(submit_v2(
            State(state.clone()),
            headers.clone(),
            Bytes::from(serde_json::to_vec(&research).unwrap()),
        ))
        .await;
        assert_eq!(research_response.status(), StatusCode::OK);
        let research_json = response_json(research_response).await;
        let intent_identity = research_json["owner_receipt"]["resulting_research_intent_identity"]
            .as_str()
            .unwrap_or_else(|| {
                panic!("research API did not return accepted custody: {research_json}")
            })
            .to_string();

        let build_request_identity = format!("rd-api-retry-build-{suffix}");
        let attempt_identity = format!("rd-api-retry-attempt-{suffix}");
        let build = ArtifactBuildOperationRequestV1 {
            build_request_identity: build_request_identity.clone(),
            attempt_identity: attempt_identity.clone(),
            intent_identity,
            channel: ProductEdgeChannel::WindmillProductEdge,
        };
        let build_body = Bytes::from(serde_json::to_vec(&build).unwrap());
        let prepared =
            prepare_artifact_build(State(state.clone()), headers.clone(), build_body.clone()).await;
        assert_eq!(prepared.status(), StatusCode::OK);
        let claimed =
            claim_provider_invocation(State(state.clone()), headers.clone(), build_body).await;
        assert_eq!(claimed.status(), StatusCode::OK);
        let claimed_json = response_json(claimed).await;
        let claim_identity = claimed_json["claim_identity"].as_str().unwrap().to_string();

        let product_edge_state_before_foreign_start: serde_json::Value = sqlx::query_scalar(
            "SELECT state_json FROM product_edge_effect_invocation_states_v1 WHERE claim_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();
        let foreign_start_body = Bytes::from(
            serde_json::to_vec(&serde_json::json!({
                "build_request_identity": build_request_identity,
                "attempt_identity": attempt_identity,
                "research_request_identity": "foreign-research-request",
            }))
            .unwrap(),
        );
        let foreign_start =
            start_provider_invocation(State(state.clone()), headers.clone(), foreign_start_body)
                .await;
        assert_eq!(foreign_start.status(), StatusCode::CONFLICT);
        assert_eq!(
            foreign_start.headers().get("x-rd-rejection-code").unwrap(),
            "RESEARCH_REQUEST_IDENTITY_CONFLICT"
        );
        let product_edge_state_after_foreign_start: serde_json::Value = sqlx::query_scalar(
            "SELECT state_json FROM product_edge_effect_invocation_states_v1 WHERE claim_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();
        let foreign_started_events: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE event_kind='PRODUCT_EDGE_PROVIDER_INVOCATION_STARTED_V1' AND aggregate_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();
        assert_eq!(
            product_edge_state_after_foreign_start,
            product_edge_state_before_foreign_start
        );
        assert_eq!(foreign_started_events, 0);

        let start_body = Bytes::from(
            serde_json::to_vec(&serde_json::json!({
                "build_request_identity": build_request_identity,
                "attempt_identity": attempt_identity,
                "research_request_identity": research_request_identity,
            }))
            .unwrap(),
        );
        let started =
            start_provider_invocation(State(state.clone()), headers.clone(), start_body.clone())
                .await;
        assert_eq!(started.status(), StatusCode::OK);
        let started_json = response_json(started).await;
        assert_eq!(
            started_json["invocation_start"]["disposition"],
            "STARTED_NEW"
        );
        assert_exact_start_custody(&started_json, &build_request_identity, &attempt_identity);
        assert_eq!(
            started_json["execution_custody"]["claim_identity"],
            claim_identity
        );
        let started_events_after_first: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE event_kind='PRODUCT_EDGE_PROVIDER_INVOCATION_STARTED_V1' AND aggregate_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();
        assert_eq!(started_events_after_first, 1);
        let rd_attempt_after_first: serde_json::Value = sqlx::query_scalar(
            "SELECT attempt_json FROM rd_artifact_build_attempts_v1 WHERE build_request_identity=$1",
        )
        .bind(&build_request_identity)
        .fetch_one(mutation.pool(CanonicalOwnerTestRoleV1::RdOwner))
        .await
        .unwrap();

        let retried =
            start_provider_invocation(State(state.clone()), headers.clone(), start_body.clone())
                .await;
        assert_eq!(retried.status(), StatusCode::OK);
        let retried_json = response_json(retried).await;
        assert_eq!(
            retried_json["invocation_start"]["disposition"],
            "OUTCOME_UNKNOWN"
        );
        assert_exact_start_custody(&retried_json, &build_request_identity, &attempt_identity);
        assert_eq!(
            retried_json["execution_custody"],
            started_json["execution_custody"]
        );
        let started_events_after_retry: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE event_kind='PRODUCT_EDGE_PROVIDER_INVOCATION_STARTED_V1' AND aggregate_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();
        assert_eq!(started_events_after_retry, started_events_after_first);
        let rd_attempt_after_retry: serde_json::Value = sqlx::query_scalar(
            "SELECT attempt_json FROM rd_artifact_build_attempts_v1 WHERE build_request_identity=$1",
        )
        .bind(&build_request_identity)
        .fetch_one(mutation.pool(CanonicalOwnerTestRoleV1::RdOwner))
        .await
        .unwrap();
        assert_eq!(rd_attempt_after_retry, rd_attempt_after_first);

        let rd_owner_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
        let mut missing_snapshot_attempt = rd_attempt_after_retry.clone();
        missing_snapshot_attempt
            .as_object_mut()
            .unwrap()
            .remove("invocation_custody");
        sqlx::query(
            "UPDATE rd_artifact_build_attempts_v1 SET attempt_json=$1 WHERE build_request_identity=$2",
        )
        .bind(&missing_snapshot_attempt)
        .bind(&build_request_identity)
        .execute(rd_owner_pool)
        .await
        .unwrap();
        let product_edge_state_before_missing_snapshot: serde_json::Value = sqlx::query_scalar(
            "SELECT state_json FROM product_edge_effect_invocation_states_v1 WHERE claim_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();
        let product_edge_outbox_before_missing_snapshot: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE aggregate_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();
        let missing_snapshot_rejected =
            start_provider_invocation(State(state.clone()), headers.clone(), start_body.clone())
                .await;
        assert_eq!(
            missing_snapshot_rejected.status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
        assert_eq!(
            missing_snapshot_rejected
                .headers()
                .get("x-rd-rejection-code")
                .unwrap(),
            "OWNER_OUTCOME_UNKNOWN"
        );
        let product_edge_state_after_missing_snapshot: serde_json::Value = sqlx::query_scalar(
            "SELECT state_json FROM product_edge_effect_invocation_states_v1 WHERE claim_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();
        let product_edge_outbox_after_missing_snapshot: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE aggregate_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();
        let rd_attempt_after_missing_snapshot: serde_json::Value = sqlx::query_scalar(
            "SELECT attempt_json FROM rd_artifact_build_attempts_v1 WHERE build_request_identity=$1",
        )
        .bind(&build_request_identity)
        .fetch_one(rd_owner_pool)
        .await
        .unwrap();
        assert_eq!(
            product_edge_state_after_missing_snapshot,
            product_edge_state_before_missing_snapshot
        );
        assert_eq!(
            product_edge_outbox_after_missing_snapshot,
            product_edge_outbox_before_missing_snapshot
        );
        assert_eq!(rd_attempt_after_missing_snapshot, missing_snapshot_attempt);
        sqlx::query(
            "UPDATE rd_artifact_build_attempts_v1 SET attempt_json=$1 WHERE build_request_identity=$2",
        )
        .bind(&rd_attempt_after_retry)
        .bind(&build_request_identity)
        .execute(rd_owner_pool)
        .await
        .unwrap();

        let mut tampered_attempt = rd_attempt_after_retry.clone();
        let reservation = tampered_attempt["invocation_claim"]
            .as_object_mut()
            .unwrap();
        let tampered_claimed_state_digest = format!("sha256:{}", "b".repeat(64));
        reservation.insert(
            "claimed_state_digest".to_string(),
            tampered_claimed_state_digest.clone().into(),
        );
        let request_identity = reservation["request_identity"]
            .as_str()
            .unwrap()
            .to_string();
        let admission_identity = reservation["admission_identity"]
            .as_str()
            .unwrap()
            .to_string();
        let reserved_attempt_identity = reservation["attempt_identity"]
            .as_str()
            .unwrap()
            .to_string();
        let reserved_claim_identity = reservation["claim_identity"].as_str().unwrap().to_string();
        let claim_digest = reservation["claim_digest"].as_str().unwrap().to_string();
        let admission_receipt_identity = reservation["invocation_admission_receipt_identity"]
            .as_str()
            .unwrap()
            .to_string();
        let admission_receipt_digest = reservation["invocation_admission_receipt_digest"]
            .as_str()
            .unwrap()
            .to_string();
        let execution_custody_digest = reservation["execution_custody_digest"]
            .as_str()
            .unwrap()
            .to_string();
        let reserved_at_epoch_ms = reservation["reserved_at_epoch_ms"].as_u64().unwrap();
        let tampered_seal = seal_invocation_reservation(ArtifactInvocationReservationMeaningV1 {
            request_identity: &request_identity,
            admission_identity: &admission_identity,
            attempt_identity: &reserved_attempt_identity,
            claim_identity: &reserved_claim_identity,
            claim_digest: &claim_digest,
            invocation_admission_receipt_identity: &admission_receipt_identity,
            invocation_admission_receipt_digest: &admission_receipt_digest,
            claimed_state_digest: &tampered_claimed_state_digest,
            execution_custody_digest: &execution_custody_digest,
            reserved_at_epoch_ms,
        })
        .unwrap();
        reservation.insert(
            "reservation_identity".to_string(),
            tampered_seal.reservation_identity().into(),
        );
        reservation.insert(
            "reservation_digest".to_string(),
            tampered_seal.reservation_digest().into(),
        );
        sqlx::query(
            "UPDATE rd_artifact_build_attempts_v1 SET attempt_json=$1 WHERE build_request_identity=$2",
        )
        .bind(&tampered_attempt)
        .bind(&build_request_identity)
        .execute(rd_owner_pool)
        .await
        .unwrap();
        let product_edge_state_before_tampered_retry: serde_json::Value = sqlx::query_scalar(
            "SELECT state_json FROM product_edge_effect_invocation_states_v1 WHERE claim_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();
        let product_edge_outbox_before_tampered_retry: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE aggregate_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();

        let rejected = start_provider_invocation(State(state), headers, start_body).await;
        assert_eq!(rejected.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            rejected.headers().get("x-rd-rejection-code").unwrap(),
            "OWNER_OUTCOME_UNKNOWN"
        );
        let product_edge_state_after_tampered_retry: serde_json::Value = sqlx::query_scalar(
            "SELECT state_json FROM product_edge_effect_invocation_states_v1 WHERE claim_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();
        let product_edge_outbox_after_tampered_retry: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE aggregate_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();
        let rd_attempt_after_tampered_retry: serde_json::Value = sqlx::query_scalar(
            "SELECT attempt_json FROM rd_artifact_build_attempts_v1 WHERE build_request_identity=$1",
        )
        .bind(&build_request_identity)
        .fetch_one(rd_owner_pool)
        .await
        .unwrap();
        assert_eq!(
            product_edge_state_after_tampered_retry,
            product_edge_state_before_tampered_retry
        );
        assert_eq!(
            product_edge_outbox_after_tampered_retry,
            product_edge_outbox_before_tampered_retry
        );
        assert_eq!(rd_attempt_after_tampered_retry, tampered_attempt);
    }

    fn bearer_headers(token: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {token}").parse().unwrap(),
        );
        headers
    }

    async fn response_json(response: Response) -> serde_json::Value {
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&body).unwrap()
    }

    fn assert_exact_start_custody(
        response: &serde_json::Value,
        build_request_identity: &str,
        attempt_identity: &str,
    ) {
        assert_eq!(
            response["execution_custody"]["request"]["build_request_identity"],
            build_request_identity
        );
        assert_eq!(
            response["execution_custody"]["request"]["attempt_identity"],
            attempt_identity
        );
        assert_eq!(
            response["execution_custody"]["claim_identity"],
            response["invocation_start"]["claim_identity"]
        );
        assert_eq!(
            response["execution_custody"]["claim_digest"],
            response["invocation_start"]["claim_digest"]
        );

        for field in [
            "reservation_identity",
            "reservation_digest",
            "execution_custody_digest",
            "canonical_intent_bytes",
            "trial_family_identity",
            "census_frontier_identity",
        ] {
            assert!(
                response["execution_custody"][field]
                    .as_str()
                    .is_some_and(|value| !value.is_empty())
            );
        }
    }

    #[tokio::test]
    async fn receiptless_v2_rejections_require_same_identity_resolution() {
        for (status, code) in [
            (StatusCode::FORBIDDEN, "UNAUTHORIZED_PRODUCT_EDGE"),
            (StatusCode::BAD_REQUEST, "MALFORMED_TYPED_REQUEST"),
            (StatusCode::SERVICE_UNAVAILABLE, "OWNER_UNAVAILABLE"),
        ] {
            let response = rejection_v2(status, code, "request-v2");
            assert_eq!(response.status(), status);
            assert_eq!(response.headers().get("x-rd-rejection-code").unwrap(), code);
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(value["resolution"], "SUBMITTED_OR_UNKNOWN");
            assert_eq!(value["request_identity"], "request-v2");
            assert_eq!(value["owner_receipt"], serde_json::Value::Null);
            assert_eq!(value["next_legal_action"], "RESOLVE_SAME_REQUEST_IDENTITY");
        }
    }

    #[tokio::test]
    async fn product_edge_unavailable_projects_same_attempt_resolution() {
        let response =
            artifact_product_edge_error(&ProductEdgeError::Unavailable, "build-1", "attempt-1");
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response.headers().get("x-rd-rejection-code").unwrap(),
            "OWNER_OUTCOME_UNKNOWN"
        );
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["resolution"], "SUBMITTED_OR_UNKNOWN");
        assert_eq!(value["build_request_identity"], "build-1");
        assert_eq!(value["attempt_identity"], "attempt-1");
        assert_eq!(value["next_legal_action"], "RESOLVE_SAME_ATTEMPT_IDENTITY");
    }

    #[tokio::test]
    async fn missing_artifact_admission_is_truthful_same_attempt_unknown() {
        let response = artifact_unknown(
            StatusCode::SERVICE_UNAVAILABLE,
            "OWNER_OUTCOME_UNKNOWN",
            "build-1",
            "attempt-1",
        );
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response.headers().get("x-rd-rejection-code").unwrap(),
            "OWNER_OUTCOME_UNKNOWN"
        );
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["resolution"], "SUBMITTED_OR_UNKNOWN");
        assert_eq!(value["build_request_identity"], "build-1");
        assert_eq!(value["attempt_identity"], "attempt-1");
        assert_eq!(value["owner_receipt"], serde_json::Value::Null);
        assert_eq!(value["next_legal_action"], "RESOLVE_SAME_ATTEMPT_IDENTITY");
    }

    struct MockArtifactBuildOwner {
        preflight: ArtifactRequestIdentityPreflightV1,
        preflight_calls: AtomicUsize,
    }

    #[async_trait]
    impl ArtifactBuildOwnerPort for MockArtifactBuildOwner {
        async fn preflight_request_identity(
            &self,
            _build_request_identity: &str,
            _attempt_identity: &str,
        ) -> Result<ArtifactRequestIdentityPreflightV1, ArtifactBuildError> {
            self.preflight_calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.preflight)
        }

        async fn prepare(
            &self,
            _request: ArtifactBuildRequestV1,
        ) -> Result<ArtifactBuildPreparationV1, ArtifactBuildError> {
            panic!("preflight test must not prepare")
        }

        async fn reserve_provider_invocation_custody(
            &self,
            _build_request_identity: &str,
            _attempt_identity: &str,
            _claim: ProductEdgeInvocationClaimReadbackV1,
        ) -> Result<ReservedArtifactBuildInvocationV1, ArtifactBuildError> {
            panic!("preflight test must not resolve invocation custody")
        }

        async fn submit_candidate(
            &self,
            _request: ArtifactBuildRequestV1,
            _candidate: ArtifactBuildCandidateV1,
            _invocation: Option<&ProductEdgeInvocationClaimReadbackV1>,
        ) -> Result<ArtifactBuildResultV1, ArtifactBuildError> {
            panic!("preflight test must not submit a candidate")
        }

        async fn fail_no_artifact(
            &self,
            _request: ArtifactBuildRequestV1,
            _failure_code: &str,
            _invocation: Option<&ProductEdgeInvocationClaimReadbackV1>,
        ) -> Result<ArtifactBuildResultV1, ArtifactBuildError> {
            panic!("preflight test must not terminalize")
        }

        async fn resolve(
            &self,
            _build_request_identity: &str,
            _attempt_identity: &str,
            _admission: &vibe_product_edge::ProductEdgeAdmissionLocatorV1,
        ) -> Result<ArtifactBuildResultV1, ArtifactBuildError> {
            panic!("preflight test must not resolve")
        }

        async fn resolve_legacy_terminal_quarantined(
            &self,
            _build_request_identity: &str,
            _attempt_identity: &str,
        ) -> Result<ArtifactBuildResultV1, ArtifactBuildError> {
            panic!("preflight test must not resolve legacy custody")
        }
    }

    #[tokio::test]
    async fn legacy_collision_stops_before_product_edge_admission_through_owner_port() {
        let concrete = Arc::new(MockArtifactBuildOwner {
            preflight: ArtifactRequestIdentityPreflightV1::LegacyTerminalQuarantined,
            preflight_calls: AtomicUsize::new(0),
        });
        let artifact_owner: Arc<dyn ArtifactBuildOwnerPort> = concrete.clone();
        let product_edge_admission_calls = AtomicUsize::new(0);

        let result = preflight_then_admit_artifact_request(
            artifact_owner.as_ref(),
            "artifact-build-request-legacy",
            "artifact-build-attempt-legacy",
            || async {
                product_edge_admission_calls.fetch_add(1, Ordering::SeqCst);
                Ok(())
            },
        )
        .await;

        assert!(matches!(result, Err((ProductEdgeError::Unavailable, _, _))));
        assert_eq!(concrete.preflight_calls.load(Ordering::SeqCst), 1);
        assert_eq!(product_edge_admission_calls.load(Ordering::SeqCst), 0);
    }
}
