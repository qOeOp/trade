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

#[cfg(feature = "sealed-source-intake-acceptance")]
const SOURCE_INTAKE_RELATIONS: &[&str] = &[
    "rd_research_source_provenance_v1",
    "rd_source_candidates_v1",
    "rd_source_intake_bindings_v1",
    "rd_source_intake_receipts_v1",
    "rd_source_raw_payloads_v1",
    "rd_source_raw_receipt_links_v1",
];

#[cfg(feature = "sealed-source-intake-acceptance")]
const SOURCE_INTAKE_RELATION_CUSTODY: &[&str] = &[
    "rd_research_source_provenance_v1:r:p:rd_owner",
    "rd_source_candidates_v1:r:p:rd_owner",
    "rd_source_intake_bindings_v1:r:p:rd_owner",
    "rd_source_intake_receipts_v1:r:p:rd_owner",
    "rd_source_raw_payloads_v1:r:p:rd_owner",
    "rd_source_raw_receipt_links_v1:r:p:rd_owner",
];

#[cfg(feature = "sealed-source-intake-acceptance")]
const SOURCE_INTAKE_COLUMN_SHAPE: &[&str] = &[
    "rd_research_source_provenance_v1:1:provenance_identity:text:true:false::",
    "rd_research_source_provenance_v1:2:receipt_identity:text:true:false::",
    "rd_research_source_provenance_v1:3:content_digest:text:true:false::",
    "rd_research_source_provenance_v1:4:provenance_json:jsonb:true:false::",
    "rd_research_source_provenance_v1:5:predecessor_provenance_identity:text:false:true::s",
    "rd_research_source_provenance_v1:6:canonical_source_origin:text:false:true::s",
    "rd_research_source_provenance_v1:7:source_class:text:false:true::s",
    "rd_research_source_provenance_v1:8:author_or_originating_system:text:false:true::s",
    "rd_research_source_provenance_v1:9:publication_time_epoch_ms:bigint:false:true::s",
    "rd_research_source_provenance_v1:10:revision_identity:text:false:true::s",
    "rd_research_source_provenance_v1:11:raw_content_digest:text:false:true::s",
    "rd_research_source_provenance_v1:12:retrieval_time_head_digest:text:false:true::s",
    "rd_research_source_provenance_v1:13:rights_policy_version:text:false:true::s",
    "rd_research_source_provenance_v1:14:retention_policy_version:text:false:true::s",
    "rd_research_source_provenance_v1:15:interpretation_status:text:false:true::s",
    "rd_source_candidates_v1:1:candidate_identity:text:true:false::",
    "rd_source_candidates_v1:2:provenance_identity:text:true:false::",
    "rd_source_candidates_v1:3:candidate_json:jsonb:true:false::",
    "rd_source_intake_bindings_v1:1:request_identity:text:true:false::",
    "rd_source_intake_bindings_v1:2:binding_identity:text:true:false::",
    "rd_source_intake_bindings_v1:3:binding_commit_identity:text:true:false::",
    "rd_source_intake_bindings_v1:4:binding_json:jsonb:true:false::",
    "rd_source_intake_bindings_v1:5:state:text:true:false::",
    "rd_source_intake_bindings_v1:6:binding_committed_at_epoch_ms:bigint:true:false::",
    "rd_source_intake_bindings_v1:7:product_edge_started_receipt_identity:text:false:false::",
    "rd_source_intake_bindings_v1:8:product_edge_started_json:jsonb:false:false::",
    "rd_source_intake_bindings_v1:9:invocation_identity:text:false:false::",
    "rd_source_intake_bindings_v1:10:terminal_receipt_identity:text:false:false::",
    "rd_source_intake_receipts_v1:1:receipt_identity:text:true:false::",
    "rd_source_intake_receipts_v1:2:request_identity:text:true:false::",
    "rd_source_intake_receipts_v1:3:terminal:text:true:false::",
    "rd_source_intake_receipts_v1:4:response_status:smallint:false:false::",
    "rd_source_intake_receipts_v1:5:response_header_digest:text:false:false::",
    "rd_source_intake_receipts_v1:6:content_digest:text:false:false::",
    "rd_source_intake_receipts_v1:7:receipt_json:jsonb:true:false::",
    "rd_source_intake_receipts_v1:8:attempt_identity:text:false:true::s",
    "rd_source_intake_receipts_v1:9:terminal_evidence_identity:text:false:true::s",
    "rd_source_intake_receipts_v1:10:terminal_evidence_digest:text:false:true::s",
    "rd_source_intake_receipts_v1:11:connected_address:inet:false:true::s",
    "rd_source_intake_receipts_v1:12:response_media_type:text:false:true::s",
    "rd_source_intake_receipts_v1:13:response_size_bytes:bigint:false:true::s",
    "rd_source_intake_receipts_v1:14:shared_time_head_digest:text:false:true::s",
    "rd_source_intake_receipts_v1:15:committed_at_epoch_ms:bigint:true:false::",
    "rd_source_raw_payloads_v1:1:content_digest:text:true:false::",
    "rd_source_raw_payloads_v1:2:raw_payload:bytea:true:false::",
    "rd_source_raw_receipt_links_v1:1:receipt_identity:text:true:false::",
    "rd_source_raw_receipt_links_v1:2:terminal:text:true:true::",
    "rd_source_raw_receipt_links_v1:3:content_digest:text:true:false::",
];

#[cfg(feature = "sealed-source-intake-acceptance")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SourceIntakeRelationFamilyState {
    FullyAbsent,
    Complete,
    Incompatible,
}

#[cfg(feature = "sealed-source-intake-acceptance")]
struct SourceIntakeRelationFamilyShape {
    relation_custody: Vec<String>,
    columns: Vec<String>,
}

#[cfg(feature = "sealed-source-intake-acceptance")]
fn classify_source_intake_relation_family(
    observed: &SourceIntakeRelationFamilyShape,
) -> SourceIntakeRelationFamilyState {
    if observed.relation_custody.is_empty() {
        SourceIntakeRelationFamilyState::FullyAbsent
    } else if observed.relation_custody.len() == SOURCE_INTAKE_RELATION_CUSTODY.len()
        && observed
            .relation_custody
            .iter()
            .map(String::as_str)
            .eq(SOURCE_INTAKE_RELATION_CUSTODY.iter().copied())
        && observed.columns.len() == SOURCE_INTAKE_COLUMN_SHAPE.len()
        && observed
            .columns
            .iter()
            .map(String::as_str)
            .eq(SOURCE_INTAKE_COLUMN_SHAPE.iter().copied())
    {
        SourceIntakeRelationFamilyState::Complete
    } else {
        SourceIntakeRelationFamilyState::Incompatible
    }
}

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
    require_sealed_source_intake_schema(&owner_pool).await?;
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
async fn inspect_source_intake_relation_family(
    connection: &mut sqlx::PgConnection,
) -> anyhow::Result<SourceIntakeRelationFamilyShape> {
    let (relation_custody, columns): (Vec<String>, Vec<String>) = sqlx::query_as(
        "SELECT
           ARRAY(
             SELECT relation.relname||':'||relation.relkind::pg_catalog.text||':'||
                    relation.relpersistence::pg_catalog.text||':'||
                    pg_catalog.pg_get_userbyid(relation.relowner)
               FROM pg_catalog.pg_class relation
               JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
              WHERE namespace.nspname='public' AND relation.relname=ANY($1)
              ORDER BY relation.relname
           ),
           ARRAY(
             SELECT relation.relname||':'||attribute.attnum||':'||attribute.attname||':'||
                    pg_catalog.format_type(attribute.atttypid,attribute.atttypmod)||':'||
                    attribute.attnotnull||':'||attribute.atthasdef||':'||
                    attribute.attidentity::pg_catalog.text||':'||
                    attribute.attgenerated::pg_catalog.text
               FROM pg_catalog.pg_class relation
               JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
               JOIN pg_catalog.pg_attribute attribute
                 ON attribute.attrelid=relation.oid
                AND attribute.attnum>0
                AND NOT attribute.attisdropped
              WHERE namespace.nspname='public' AND relation.relname=ANY($1)
              ORDER BY relation.relname,attribute.attnum
           )",
    )
    .bind(SOURCE_INTAKE_RELATIONS)
    .fetch_one(connection)
    .await
    .context("inspect sealed Source Intake relation family")?;
    Ok(SourceIntakeRelationFamilyShape {
        relation_custody,
        columns,
    })
}

#[cfg(feature = "sealed-source-intake-acceptance")]
async fn locked_sealed_source_intake_schema(
    owner_pool: &sqlx::PgPool,
    materialize_fully_absent: bool,
) -> anyhow::Result<()> {
    let mut transaction = owner_pool
        .begin()
        .await
        .context("begin sealed Source Intake schema validation")?;
    sqlx::query(
        "SELECT pg_advisory_xact_lock(hashtextextended('vibe.sealed-source-intake-schema-v1', 0))",
    )
    .execute(&mut *transaction)
    .await
    .context("lock sealed Source Intake schema validation")?;

    let observed_shape = inspect_source_intake_relation_family(&mut transaction).await?;
    match classify_source_intake_relation_family(&observed_shape) {
        SourceIntakeRelationFamilyState::Complete => {}
        SourceIntakeRelationFamilyState::FullyAbsent if materialize_fully_absent => {
            for (index, statement) in SOURCE_INTAKE_MIGRATION_SQL_V1.iter().enumerate() {
                sqlx::query(*statement)
                    .execute(&mut *transaction)
                    .await
                    .with_context(|| {
                        format!("apply sealed Source Intake migration statement {index}")
                    })?;
            }
            let materialized_shape =
                inspect_source_intake_relation_family(&mut transaction).await?;
            anyhow::ensure!(
                classify_source_intake_relation_family(&materialized_shape)
                    == SourceIntakeRelationFamilyState::Complete,
                "sealed Source Intake materialization did not produce the expected relation family"
            );
        }
        SourceIntakeRelationFamilyState::FullyAbsent => {
            anyhow::bail!("sealed Source Intake relation family is not materialized")
        }
        SourceIntakeRelationFamilyState::Incompatible => {
            anyhow::bail!("sealed Source Intake relation family is partial or malformed")
        }
    }
    transaction
        .commit()
        .await
        .context("commit sealed Source Intake schema validation")
}

#[cfg(feature = "sealed-source-intake-acceptance")]
async fn require_sealed_source_intake_schema(owner_pool: &sqlx::PgPool) -> anyhow::Result<()> {
    locked_sealed_source_intake_schema(owner_pool, false).await
}

#[cfg(feature = "sealed-source-intake-acceptance")]
async fn materialize_sealed_source_intake_schema(owner_pool: &sqlx::PgPool) -> anyhow::Result<()> {
    locked_sealed_source_intake_schema(owner_pool, true).await
}

#[cfg(feature = "sealed-source-intake-acceptance")]
pub(super) async fn materialize_schema(database_url: &str) -> anyhow::Result<()> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(database_url)
        .await?;
    materialize_sealed_source_intake_schema(&pool).await
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
    fn sealed_runtime_validates_schema_without_materializing() {
        let source = include_str!("source_intake.rs")
            .split("#[cfg(test)]")
            .next()
            .expect("production module");
        let validation_call = source
            .find("require_sealed_source_intake_schema(&owner_pool).await?")
            .expect("acceptance schema validation call");
        let environment = source
            .find("let environment =")
            .expect("acceptance environment construction");
        assert!(validation_call < environment);
        let runtime_validation = source
            .split("async fn require_sealed_source_intake_schema")
            .nth(1)
            .expect("runtime validation function")
            .split("async fn materialize_sealed_source_intake_schema")
            .next()
            .expect("runtime validation body");
        assert!(
            runtime_validation.contains("locked_sealed_source_intake_schema(owner_pool, false)")
        );
        assert!(!runtime_validation.contains("SOURCE_INTAKE_MIGRATION_SQL_V1"));
    }

    #[cfg(feature = "sealed-source-intake-acceptance")]
    #[rstest]
    fn sealed_schema_family_decisions_fail_closed() {
        assert_eq!(
            classify_source_intake_relation_family(&SourceIntakeRelationFamilyShape {
                relation_custody: Vec::new(),
                columns: Vec::new(),
            }),
            SourceIntakeRelationFamilyState::FullyAbsent
        );
        assert_eq!(
            classify_source_intake_relation_family(&SourceIntakeRelationFamilyShape {
                relation_custody: vec![SOURCE_INTAKE_RELATION_CUSTODY[0].to_owned()],
                columns: vec![SOURCE_INTAKE_COLUMN_SHAPE[0].to_owned()],
            }),
            SourceIntakeRelationFamilyState::Incompatible
        );
        let complete = SourceIntakeRelationFamilyShape {
            relation_custody: SOURCE_INTAKE_RELATION_CUSTODY
                .iter()
                .map(|shape| (*shape).to_owned())
                .collect(),
            columns: SOURCE_INTAKE_COLUMN_SHAPE
                .iter()
                .map(|shape| (*shape).to_owned())
                .collect(),
        };
        assert_eq!(
            classify_source_intake_relation_family(&complete),
            SourceIntakeRelationFamilyState::Complete
        );
        let mut malformed = complete;
        malformed.columns[0].push_str(":unexpected");
        assert_eq!(
            classify_source_intake_relation_family(&malformed),
            SourceIntakeRelationFamilyState::Incompatible
        );
    }

    #[cfg(feature = "sealed-source-intake-acceptance")]
    #[rstest]
    fn sealed_schema_validation_is_transactional_and_materialization_is_explicit() {
        let source = include_str!("source_intake.rs")
            .split("#[cfg(test)]")
            .next()
            .expect("production module");
        assert!(source.contains("let mut transaction = owner_pool"));
        assert!(source.contains("pg_advisory_xact_lock"));
        assert!(
            source.contains(
                "SourceIntakeRelationFamilyState::FullyAbsent if materialize_fully_absent"
            )
        );
        assert!(source.contains("for (index, statement) in SOURCE_INTAKE_MIGRATION_SQL_V1"));
        assert!(source.contains(".execute(&mut *transaction)"));
        assert!(source.contains("relation family is partial or malformed"));
        assert!(source.contains("transaction\n        .commit()"));
    }
}
