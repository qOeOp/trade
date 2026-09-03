use std::sync::Arc;

#[cfg(feature = "sealed-source-intake-acceptance")]
use anyhow::Context;
use async_trait::async_trait;
use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use vibe_product_edge::ProductEdgePostgresOwnerV1;
#[cfg(feature = "sealed-source-intake-acceptance")]
use vibe_strategy_factory::source_intake::{
    SOURCE_INTAKE_MIGRATION_SQL_V1, SealedSourceIntakeAuditV1, SealedSourceIntakeEnvironmentV1,
};
use vibe_strategy_factory::source_intake::{
    SourceIntakeOperationRequestV1, SourceIntakeOwnerErrorV1, SourceIntakeOwnerV1,
    SourceIntakeTerminalAtomV1,
};

const MAX_REQUEST_BYTES: usize = 256 * 1024;
const MAX_IDENTITY_BYTES: usize = 192;

#[async_trait]
trait SourceIntakeOwnerPort: Send + Sync {
    async fn run(
        &self,
        request: SourceIntakeOperationRequestV1,
    ) -> Result<Option<SourceIntakeTerminalAtomV1>, SourceIntakeOwnerErrorV1>;
    async fn resolve(
        &self,
        request_identity: &str,
    ) -> Result<Option<SourceIntakeTerminalAtomV1>, SourceIntakeOwnerErrorV1>;
}

#[async_trait]
impl SourceIntakeOwnerPort for SourceIntakeOwnerV1 {
    async fn run(
        &self,
        request: SourceIntakeOperationRequestV1,
    ) -> Result<Option<SourceIntakeTerminalAtomV1>, SourceIntakeOwnerErrorV1> {
        self.run(request).await
    }

    async fn resolve(
        &self,
        request_identity: &str,
    ) -> Result<Option<SourceIntakeTerminalAtomV1>, SourceIntakeOwnerErrorV1> {
        self.resolve(request_identity).await
    }
}

#[derive(Clone)]
struct SourceIntakeApiState {
    owner: Arc<dyn SourceIntakeOwnerPort>,
    token_digest: [u8; 32],
    #[cfg(feature = "sealed-source-intake-acceptance")]
    sealed_audit: SealedSourceIntakeAuditV1,
}

#[cfg(not(feature = "sealed-source-intake-acceptance"))]
pub(super) async fn production_router(
    product_edge: Arc<ProductEdgePostgresOwnerV1>,
    database_url: &str,
    token_digest: [u8; 32],
    request_proof_digest: String,
) -> anyhow::Result<Router> {
    let owner_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(8)
        .connect(database_url)
        .await?;
    Ok(router(SourceIntakeApiState {
        owner: Arc::new(SourceIntakeOwnerV1::production(
            product_edge,
            owner_pool,
            request_proof_digest,
        )),
        token_digest,
    }))
}

#[cfg(feature = "sealed-source-intake-acceptance")]
pub(super) async fn sealed_acceptance_router(
    product_edge: Arc<ProductEdgePostgresOwnerV1>,
    database_url: &str,
    token_digest: [u8; 32],
    request_proof_digest: String,
) -> anyhow::Result<Router> {
    let owner_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(8)
        .connect(database_url)
        .await?;
    install_sealed_source_intake_schema(&owner_pool).await?;
    let environment =
        SealedSourceIntakeEnvironmentV1::new(product_edge, owner_pool, request_proof_digest)
            .map_err(|_| anyhow::anyhow!("invalid sealed Source Intake environment"))?;
    let sealed_audit = environment.audit();
    Ok(router(SourceIntakeApiState {
        owner: Arc::new(SourceIntakeOwnerV1::sealed_acceptance(environment)),
        token_digest,
        sealed_audit,
    }))
}

#[cfg(feature = "sealed-source-intake-acceptance")]
async fn install_sealed_source_intake_schema(owner_pool: &sqlx::PgPool) -> anyhow::Result<()> {
    // Each acceptance run owns one disposable database. The transaction lock and sentinel make
    // process restart safe without treating this non-idempotent corpus as a production migrator.
    let mut transaction = owner_pool
        .begin()
        .await
        .context("begin sealed Source Intake schema bootstrap")?;
    sqlx::query(
        "SELECT pg_advisory_xact_lock(hashtextextended('vibe.sealed-source-intake-schema-v1', 0))",
    )
    .execute(&mut *transaction)
    .await
    .context("lock sealed Source Intake schema bootstrap")?;
    let installed: bool =
        sqlx::query_scalar("SELECT to_regclass('public.rd_source_intake_bindings_v1') IS NOT NULL")
            .fetch_one(&mut *transaction)
            .await
            .context("inspect sealed Source Intake schema bootstrap")?;

    if !installed {
        for (index, statement) in SOURCE_INTAKE_MIGRATION_SQL_V1.iter().enumerate() {
            sqlx::query(*statement)
                .execute(&mut *transaction)
                .await
                .with_context(|| {
                    format!("apply sealed Source Intake migration statement {index}")
                })?;
        }
    }
    transaction
        .commit()
        .await
        .context("commit sealed Source Intake schema bootstrap")
}

#[cfg(feature = "sealed-source-intake-acceptance")]
pub(super) async fn materialize_schema(database_url: &str) -> anyhow::Result<()> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(database_url)
        .await?;
    install_sealed_source_intake_schema(&pool).await
}

fn router(state: SourceIntakeApiState) -> Router {
    let router = Router::new()
        .route("/v1/source-intakes", post(submit))
        .route(
            "/v1/source-intakes/{request_identity}/resolve",
            post(resolve),
        );
    #[cfg(feature = "sealed-source-intake-acceptance")]
    let router = router.route(
        "/v1/source-intakes/sealed-acceptance/audit",
        axum::routing::get(sealed_acceptance_audit),
    );
    router
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .with_state(state)
}

#[cfg(feature = "sealed-source-intake-acceptance")]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
struct SealedSourceIntakeAuditProjectionV1 {
    physical_provider_invocations: u64,
}

#[cfg(feature = "sealed-source-intake-acceptance")]
async fn sealed_acceptance_audit(
    State(state): State<SourceIntakeApiState>,
    headers: HeaderMap,
) -> Response {
    match sealed_audit_projection(&headers, &state.token_digest, &state.sealed_audit) {
        Ok(projection) => (StatusCode::OK, Json(projection)).into_response(),
        Err(status) => status.into_response(),
    }
}

#[cfg(feature = "sealed-source-intake-acceptance")]
fn sealed_audit_projection(
    headers: &HeaderMap,
    token_digest: &[u8; 32],
    audit: &SealedSourceIntakeAuditV1,
) -> Result<SealedSourceIntakeAuditProjectionV1, StatusCode> {
    if !authorized(headers, token_digest) {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(SealedSourceIntakeAuditProjectionV1 {
        physical_provider_invocations: audit.physical_provider_invocations(),
    })
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EmptyObjectV1 {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct SourceIntakeUnknownV1 {
    request_identity: String,
    resolution: &'static str,
    next_legal_action: &'static str,
}

async fn submit(
    State(state): State<SourceIntakeApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let request_identity = parse_request_identity(&body);

    if !authorized(&headers, &state.token_digest) {
        return unknown_response(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            &request_identity,
        );
    }
    let request: SourceIntakeOperationRequestV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return unknown_response(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                &request_identity,
            );
        }
    };

    if request.validate().is_err() {
        return unknown_response(
            StatusCode::BAD_REQUEST,
            "MALFORMED_TYPED_REQUEST",
            &request.request_identity,
        );
    }
    let identity = request.request_identity.clone();
    owner_response(state.owner.run(request).await, &identity)
}

async fn resolve(
    State(state): State<SourceIntakeApiState>,
    Path(request_identity): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return unknown_response(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            &request_identity,
        );
    }

    if !valid_identity(&request_identity) || serde_json::from_slice::<EmptyObjectV1>(&body).is_err()
    {
        return unknown_response(
            StatusCode::BAD_REQUEST,
            "MALFORMED_TYPED_REQUEST",
            &request_identity,
        );
    }
    owner_response(
        state.owner.resolve(&request_identity).await,
        &request_identity,
    )
}

fn owner_response(
    result: Result<Option<SourceIntakeTerminalAtomV1>, SourceIntakeOwnerErrorV1>,
    request_identity: &str,
) -> Response {
    match result {
        Ok(Some(terminal)) => (StatusCode::OK, Json(terminal)).into_response(),
        Ok(None)
        | Err(
            SourceIntakeOwnerErrorV1::PolicyUnavailable | SourceIntakeOwnerErrorV1::ResponseLost,
        ) => unknown_response(
            StatusCode::ACCEPTED,
            "OWNER_OUTCOME_UNKNOWN",
            request_identity,
        ),
        Err(SourceIntakeOwnerErrorV1::Conflict) => unknown_response(
            StatusCode::CONFLICT,
            "CONFLICTING_SEMANTICS_FOR_REQUEST_IDENTITY",
            request_identity,
        ),
        Err(SourceIntakeOwnerErrorV1::Invalid) => unknown_response(
            StatusCode::BAD_REQUEST,
            "MALFORMED_TYPED_REQUEST",
            request_identity,
        ),
        Err(SourceIntakeOwnerErrorV1::Unavailable) => unknown_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "OWNER_OUTCOME_UNKNOWN",
            request_identity,
        ),
    }
}

fn unknown_response(status: StatusCode, code: &str, request_identity: &str) -> Response {
    let mut response = (
        status,
        Json(SourceIntakeUnknownV1 {
            request_identity: request_identity.to_string(),
            resolution: "SUBMITTED_OR_UNKNOWN",
            next_legal_action: "RESOLVE_SAME_REQUEST",
        }),
    )
        .into_response();

    if let Ok(value) = code.parse() {
        response.headers_mut().insert("x-rd-rejection-code", value);
    }
    response
}

fn parse_request_identity(body: &[u8]) -> String {
    serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|value| value.get("request_identity")?.as_str().map(str::to_string))
        .filter(|value| valid_identity(value))
        .unwrap_or_else(|| "INVALID_REQUEST_IDENTITY".to_string())
}

fn authorized(headers: &HeaderMap, expected_digest: &[u8; 32]) -> bool {
    let Some(token) = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
    else {
        return false;
    };
    let actual: [u8; 32] = Sha256::digest(token.as_bytes()).into();
    actual
        .iter()
        .zip(expected_digest)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn valid_identity(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_IDENTITY_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-._:/".contains(&byte))
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn token_comparison_and_request_identity_are_bounded() {
        let digest: [u8; 32] = Sha256::digest(b"secret").into();
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::AUTHORIZATION,
            "Bearer secret".parse().expect("header"),
        );
        assert!(authorized(&headers, &digest));
        assert_eq!(
            parse_request_identity(br#"{"request_identity":"source-1"}"#),
            "source-1"
        );
        assert_eq!(
            parse_request_identity(br#"{"request_identity":"bad identity"}"#),
            "INVALID_REQUEST_IDENTITY"
        );
    }

    #[rstest]
    fn acceptance_composition_is_compile_time_only() {
        let source = include_str!("source_intake.rs")
            .split("#[cfg(test)]")
            .next()
            .expect("production module");
        assert!(!source.contains("RD_OWNER_SOURCE_INTAKE_PROVIDER"));
        assert!(!source.contains("fixture_corpus"));
        assert!(source.contains("#[cfg(feature = \"sealed-source-intake-acceptance\")]\npub(super) async fn sealed_acceptance_router"));
    }

    #[cfg(feature = "sealed-source-intake-acceptance")]
    #[rstest]
    fn sealed_audit_route_is_authenticated_and_telemetry_only() {
        let source = include_str!("source_intake.rs")
            .split("#[cfg(test)]")
            .next()
            .expect("production module");
        assert!(source.contains("/v1/source-intakes/sealed-acceptance/audit"));
        assert!(source.contains("if !authorized(headers, token_digest)"));
        let projection = serde_json::to_value(SealedSourceIntakeAuditProjectionV1 {
            physical_provider_invocations: 1,
        })
        .expect("projection");
        assert_eq!(
            projection
                .as_object()
                .expect("object")
                .keys()
                .collect::<Vec<_>>(),
            vec!["physical_provider_invocations"]
        );
        assert!(projection.get("terminal").is_none());
        assert!(projection.get("receipt").is_none());
        assert!(projection.get("raw_payload").is_none());
    }

    #[cfg(feature = "sealed-source-intake-acceptance")]
    #[rstest]
    fn sealed_schema_bootstrap_is_transactional_and_precedes_environment_construction() {
        let source = include_str!("source_intake.rs")
            .split("#[cfg(test)]")
            .next()
            .expect("production module");
        let install_call = source
            .find("install_sealed_source_intake_schema(&owner_pool).await?")
            .expect("acceptance schema install call");
        let environment = source
            .find("let environment =")
            .expect("acceptance environment construction");
        assert!(install_call < environment);
        assert!(source.contains("let mut transaction = owner_pool"));
        assert!(source.contains("pg_advisory_xact_lock"));
        assert!(source.contains("to_regclass('public.rd_source_intake_bindings_v1') IS NOT NULL"));
        assert!(source.contains("if !installed"));
        assert!(source.contains("for (index, statement) in SOURCE_INTAKE_MIGRATION_SQL_V1"));
        assert!(source.contains(".execute(&mut *transaction)"));
        assert!(source.contains("transaction\n        .commit()"));
    }
}
