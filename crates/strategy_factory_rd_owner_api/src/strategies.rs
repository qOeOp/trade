//! `/v1/strategies`: the strategy catalog's routes, which the agent's `strategy` MCP server calls.
//!
//! A strategy is a statement an author writes, named by its content and bound to no Research
//! request (`vibe_strategy_factory::strategy_catalog_v1`). These routes validate, write, read,
//! revise and archive statements and nothing else: none reads market data, and none freezes a
//! Design, which a backtest run does under the Research goal it opens.

use std::sync::Arc;

use async_trait::async_trait;
use axum::{
    Json, Router,
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, value::RawValue};
use vibe_strategy_factory::{
    strategy_catalog_postgres_v1::{
        MAX_STRATEGY_LIST_V1, PostgresStrategyCatalogV1, StrategyCatalogErrorV1, StrategyRecordV1,
    },
    strategy_catalog_v1::{
        CanonicalStrategyStatementV1, StrategyIdentityV1, StrategyStatementV1,
        canonical_strategy_statement_v1,
    },
};

use crate::server::{authorized, insert_rejection_code};

/// The catalog operations these routes need, so their wire contract is testable without a store.
#[async_trait]
pub(super) trait StrategyCatalogPortV1: Send + Sync {
    async fn create(
        &self,
        spec: &CanonicalStrategyStatementV1,
    ) -> Result<StrategyRecordV1, StrategyCatalogErrorV1>;
    async fn revise(
        &self,
        predecessor: StrategyIdentityV1,
        spec: &CanonicalStrategyStatementV1,
    ) -> Result<StrategyRecordV1, StrategyCatalogErrorV1>;
    async fn get(
        &self,
        identity: StrategyIdentityV1,
    ) -> Result<Option<StrategyRecordV1>, StrategyCatalogErrorV1>;
    async fn list(
        &self,
        include_archived: bool,
        limit: u32,
    ) -> Result<Vec<StrategyRecordV1>, StrategyCatalogErrorV1>;
    async fn archive(
        &self,
        identity: StrategyIdentityV1,
    ) -> Result<StrategyRecordV1, StrategyCatalogErrorV1>;
}

#[async_trait]
impl StrategyCatalogPortV1 for PostgresStrategyCatalogV1 {
    async fn create(
        &self,
        spec: &CanonicalStrategyStatementV1,
    ) -> Result<StrategyRecordV1, StrategyCatalogErrorV1> {
        Self::create(self, spec).await
    }

    async fn revise(
        &self,
        predecessor: StrategyIdentityV1,
        spec: &CanonicalStrategyStatementV1,
    ) -> Result<StrategyRecordV1, StrategyCatalogErrorV1> {
        Self::revise(self, predecessor, spec).await
    }

    async fn get(
        &self,
        identity: StrategyIdentityV1,
    ) -> Result<Option<StrategyRecordV1>, StrategyCatalogErrorV1> {
        Self::get(self, identity).await
    }

    async fn list(
        &self,
        include_archived: bool,
        limit: u32,
    ) -> Result<Vec<StrategyRecordV1>, StrategyCatalogErrorV1> {
        Self::list(self, include_archived, limit).await
    }

    async fn archive(
        &self,
        identity: StrategyIdentityV1,
    ) -> Result<StrategyRecordV1, StrategyCatalogErrorV1> {
        Self::archive(self, identity).await
    }
}

/// The body of every route that takes a statement.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct StrategySpecRequestV1 {
    spec: StrategyStatementV1,
}

/// The list route's query.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct StrategyListQueryV1 {
    #[serde(default)]
    include_archived: bool,
    limit: Option<u32>,
}

/// One strategy on the wire. `spec` is the stored statement's bytes, carried as they are, so a
/// caller reads back exactly what the catalog holds and can hash it to the identity.
#[derive(Debug, Serialize)]
struct StrategyViewV1 {
    strategy_id: String,
    spec: Box<RawValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    predecessor_id: Option<String>,
    created_at_epoch_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    archived_at_epoch_ms: Option<u64>,
}

/// A page of strategies on the wire. A struct rather than a `json!` value, which would parse each
/// `spec` into a map and write its keys back in another order than the bytes its identity hashes.
#[derive(Debug, Serialize)]
struct StrategyListV1 {
    strategies: Vec<StrategyViewV1>,
}

#[derive(Clone)]
struct StrategiesApiState {
    catalog: Arc<dyn StrategyCatalogPortV1>,
    token_digest: [u8; 32],
}

pub(super) fn router(catalog: Arc<PostgresStrategyCatalogV1>, token_digest: [u8; 32]) -> Router {
    strategies_router(catalog, token_digest)
}

fn strategies_router(catalog: Arc<dyn StrategyCatalogPortV1>, token_digest: [u8; 32]) -> Router {
    Router::new()
        .route("/v1/strategies", post(create_strategy).get(list_strategies))
        .route("/v1/strategies/validate", post(validate_strategy))
        .route("/v1/strategies/{strategy_id}", get(get_strategy))
        .route(
            "/v1/strategies/{strategy_id}/revisions",
            post(revise_strategy),
        )
        .route(
            "/v1/strategies/{strategy_id}/archive",
            post(archive_strategy),
        )
        .with_state(StrategiesApiState {
            catalog,
            token_digest,
        })
}

/// Authors a statement and reports whether the catalog would admit it, writing nothing.
async fn validate_strategy(
    State(state): State<StrategiesApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    match admitted_spec(&state, &headers, &body) {
        Ok(spec) => (
            StatusCode::OK,
            Json(json!({"result": "VALID", "strategy_id": spec.identity().to_string()})),
        )
            .into_response(),
        Err(refusal) => refusal.into_response(),
    }
}

async fn create_strategy(
    State(state): State<StrategiesApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let spec = match admitted_spec(&state, &headers, &body) {
        Ok(spec) => spec,
        Err(refusal) => return refusal.into_response(),
    };
    record_response(state.catalog.create(&spec).await)
}

async fn revise_strategy(
    State(state): State<StrategiesApiState>,
    Path(strategy_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let spec = match admitted_spec(&state, &headers, &body) {
        Ok(spec) => spec,
        Err(refusal) => return refusal.into_response(),
    };
    let Some(predecessor) = StrategyIdentityV1::parse(&strategy_id) else {
        return rejection(StatusCode::NOT_FOUND, "STRATEGY_UNKNOWN", None);
    };
    record_response(state.catalog.revise(predecessor, &spec).await)
}

async fn get_strategy(
    State(state): State<StrategiesApiState>,
    Path(strategy_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(StatusCode::FORBIDDEN, "UNAUTHORIZED_PRODUCT_EDGE", None);
    }
    let Some(identity) = StrategyIdentityV1::parse(&strategy_id) else {
        return rejection(StatusCode::NOT_FOUND, "STRATEGY_UNKNOWN", None);
    };

    match state.catalog.get(identity).await {
        Ok(Some(record)) => record_response(Ok(record)),
        Ok(None) => rejection(StatusCode::NOT_FOUND, "STRATEGY_UNKNOWN", None),
        Err(e) => catalog_error(&e),
    }
}

async fn list_strategies(
    State(state): State<StrategiesApiState>,
    headers: HeaderMap,
    query: Result<Query<StrategyListQueryV1>, axum::extract::rejection::QueryRejection>,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(StatusCode::FORBIDDEN, "UNAUTHORIZED_PRODUCT_EDGE", None);
    }
    let Ok(Query(query)) = query else {
        return rejection(StatusCode::BAD_REQUEST, "MALFORMED_TYPED_REQUEST", None);
    };
    let limit = query.limit.unwrap_or(MAX_STRATEGY_LIST_V1);

    if limit == 0 || limit > MAX_STRATEGY_LIST_V1 {
        return rejection(
            StatusCode::BAD_REQUEST,
            "STRATEGY_LIST_LIMIT_OUT_OF_RANGE",
            None,
        );
    }

    match state.catalog.list(query.include_archived, limit).await {
        Ok(records) => match records.into_iter().map(view).collect::<Result<Vec<_>, _>>() {
            Ok(strategies) => (StatusCode::OK, Json(StrategyListV1 { strategies })).into_response(),
            Err(e) => catalog_error(&e),
        },
        Err(e) => catalog_error(&e),
    }
}

async fn archive_strategy(
    State(state): State<StrategiesApiState>,
    Path(strategy_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(StatusCode::FORBIDDEN, "UNAUTHORIZED_PRODUCT_EDGE", None);
    }
    let Some(identity) = StrategyIdentityV1::parse(&strategy_id) else {
        return rejection(StatusCode::NOT_FOUND, "STRATEGY_UNKNOWN", None);
    };
    record_response(state.catalog.archive(identity).await)
}

/// A refusal before the catalog is reached: its status, its code, and the author's message when
/// the author refused.
struct EarlyRefusal {
    status: StatusCode,
    code: &'static str,
    message: Option<String>,
}

impl EarlyRefusal {
    fn into_response(self) -> Response {
        rejection(self.status, self.code, self.message.as_deref())
    }
}

/// Authenticates the caller, reads the statement, and admits it into canonical form.
fn admitted_spec(
    state: &StrategiesApiState,
    headers: &HeaderMap,
    body: &[u8],
) -> Result<CanonicalStrategyStatementV1, EarlyRefusal> {
    if !authorized(headers, &state.token_digest) {
        return Err(EarlyRefusal {
            status: StatusCode::FORBIDDEN,
            code: "UNAUTHORIZED_PRODUCT_EDGE",
            message: None,
        });
    }
    let request: StrategySpecRequestV1 =
        serde_json::from_slice(body).map_err(|_| EarlyRefusal {
            status: StatusCode::BAD_REQUEST,
            code: "MALFORMED_TYPED_REQUEST",
            message: None,
        })?;
    canonical_strategy_statement_v1(&request.spec).map_err(|refusal| EarlyRefusal {
        status: StatusCode::UNPROCESSABLE_ENTITY,
        code: refusal.code(),
        message: Some(refusal.to_string()),
    })
}

fn record_response(result: Result<StrategyRecordV1, StrategyCatalogErrorV1>) -> Response {
    match result.and_then(view) {
        Ok(view) => (StatusCode::OK, Json(view)).into_response(),
        Err(e) => catalog_error(&e),
    }
}

fn view(record: StrategyRecordV1) -> Result<StrategyViewV1, StrategyCatalogErrorV1> {
    let spec = String::from_utf8(record.spec_bytes)
        .ok()
        .and_then(|text| RawValue::from_string(text).ok())
        .ok_or_else(|| StrategyCatalogErrorV1::Storage("a stored statement is not JSON".into()))?;
    Ok(StrategyViewV1 {
        strategy_id: record.identity.to_string(),
        spec,
        predecessor_id: record.predecessor.map(|identity| identity.to_string()),
        created_at_epoch_ms: record.created_at_epoch_ms,
        archived_at_epoch_ms: record.archived_at_epoch_ms,
    })
}

fn catalog_error(error: &StrategyCatalogErrorV1) -> Response {
    match error {
        StrategyCatalogErrorV1::Unknown => {
            rejection(StatusCode::NOT_FOUND, "STRATEGY_UNKNOWN", None)
        }
        StrategyCatalogErrorV1::Archived => {
            rejection(StatusCode::CONFLICT, "STRATEGY_ARCHIVED", None)
        }
        StrategyCatalogErrorV1::RevisionUnchanged => {
            rejection(StatusCode::CONFLICT, "STRATEGY_REVISION_UNCHANGED", None)
        }
        StrategyCatalogErrorV1::ExistsUnderAnotherLineage => rejection(
            StatusCode::CONFLICT,
            "STRATEGY_EXISTS_UNDER_ANOTHER_LINEAGE",
            None,
        ),
        StrategyCatalogErrorV1::Storage(_) => rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "RD_OWNER_CUSTODY_UNAVAILABLE",
            None,
        ),
    }
}

/// Every refusal names its code in the body and in `x-rd-rejection-code`, and an authoring
/// refusal also carries the author's own message, which names the field.
fn rejection(status: StatusCode, code: &str, message: Option<&str>) -> Response {
    let mut body = json!({"error": code});

    if let Some(message) = message {
        body["message"] = json!(message);
    }
    let mut response = (status, Json(body)).into_response();
    insert_rejection_code(&mut response, code);
    response
}

#[cfg(test)]
mod postgres_tests {
    use axum::body::Body;
    use axum::extract::Request;
    use sha2::{Digest as _, Sha256};
    use tower::ServiceExt;
    use vibe_postgres_connect::{PgPoolOptionsExt, PostgresTls};
    use vibe_strategy_factory::strategy_catalog_v1::stored_strategy_identity_v1;
    use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

    use super::*;

    const TOKEN: &str = "rd-owner-api-strategy-catalog-test";

    /// A read's statement, as the bytes the response carried.
    #[derive(Deserialize)]
    struct Served<'a> {
        #[serde(borrow)]
        spec: &'a RawValue,
    }

    /// A listed page, each statement as the bytes the response carried.
    #[derive(Deserialize)]
    struct Listed<'a> {
        #[serde(borrow)]
        strategies: Vec<ListedStrategy<'a>>,
    }

    #[derive(Deserialize)]
    struct ListedStrategy<'a> {
        strategy_id: String,
        #[serde(borrow)]
        spec: &'a RawValue,
    }

    /// A statement unique to this run, so a catalog that earlier runs left rows in cannot answer
    /// for it.
    fn statement(falsifier: &str) -> serde_json::Value {
        json!({
            "channel": {
                "scope": "EXACT_INSTRUMENT",
                "role_semantic_id": "research.input.close.daily.v1",
                "instrument": "BTCUSDT-PERP.BINANCE",
                "field_semantic_id": "MARKET_DATA.BAR.CLOSE.PRICE.V1",
                "timeframe": "1D",
                "unit": "PRICE",
                "scale": 2
            },
            "threshold": "100",
            "comparison": "GREATER",
            "when_true": {
                "position_intent_semantic_id": "kernel.position.enter.v1",
                "target_variant_semantic_id": "kernel.target.position.v1",
                "target_position_units": 1
            },
            "otherwise": {
                "position_intent_semantic_id": "kernel.position.exit.v1",
                "target_variant_semantic_id": "kernel.target.position.v1",
                "target_position_units": 0
            },
            "stop_loss_fraction": "0.02",
            "max_holding_bars": 5,
            "falsifier": falsifier
        })
    }

    async fn call(
        app: &Router,
        method: &str,
        uri: &str,
        token: Option<&str>,
        body: Option<serde_json::Value>,
    ) -> (StatusCode, serde_json::Value, Vec<u8>) {
        let mut request = Request::builder().method(method).uri(uri);

        if let Some(token) = token {
            request = request.header("authorization", format!("Bearer {token}"));
        }
        let request = match body {
            Some(body) => request
                .header("content-type", "application/json")
                .body(Body::from(body.to_string())),
            None => request.body(Body::empty()),
        }
        .unwrap();
        let response = app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
            .await
            .unwrap()
            .to_vec();
        let value = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        (status, value, bytes)
    }

    /// The catalog's whole surface over HTTP on the R&D Owner's PostgreSQL, with no market data
    /// and no Research request anywhere: a statement is validated, created, read back byte for
    /// byte, revised into a successor and archived, and every refusal the routes name is driven
    /// once.
    ///
    /// The byte-for-byte readback is checked by hashing: the `spec` a read returns must hash to
    /// the `strategy_id` it is read under, so a row whose stored bytes changed is refused rather
    /// than served, which the tamper step drives and then restores.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "requires the ordered chain's PostgreSQL"]
    async fn the_strategy_catalog_holds_a_statement_through_every_operation_over_http() {
        let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let rd_url = test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner);
        let rd_pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(2)
            .connect_url(rd_url, PostgresTls::Disabled)
            .await
            .unwrap();
        let catalog = Arc::new(PostgresStrategyCatalogV1::connect(rd_url).await.unwrap());
        let app = router(catalog, Sha256::digest(TOKEN.as_bytes()).into());
        let run = format!("{:x}", Sha256::digest(rd_url.as_bytes()))
            + &std::process::id().to_string()
            + &format!("{:?}", std::time::SystemTime::now());
        let falsifier = format!("the close never crosses the threshold, run {run}");
        let token = Some(TOKEN);

        // Refused before anything is read: no credential, a body that is not a request, and a
        // statement the family does not author, each by name and writing nothing.
        let (status, body, _) = call(
            &app,
            "POST",
            "/v1/strategies",
            None,
            Some(json!({"spec": statement(&falsifier)})),
        )
        .await;
        assert_eq!(
            (status, body["error"].as_str()),
            (StatusCode::FORBIDDEN, Some("UNAUTHORIZED_PRODUCT_EDGE"))
        );
        let (status, body, _) = call(
            &app,
            "POST",
            "/v1/strategies/validate",
            token,
            Some(json!({"statement": {}})),
        )
        .await;
        assert_eq!(
            (status, body["error"].as_str()),
            (StatusCode::BAD_REQUEST, Some("MALFORMED_TYPED_REQUEST"))
        );
        let mut zero_bars = statement(&falsifier);
        zero_bars["max_holding_bars"] = json!(0);
        let (status, body, _) = call(
            &app,
            "POST",
            "/v1/strategies/validate",
            token,
            Some(json!({"spec": zero_bars})),
        )
        .await;
        assert_eq!(
            (status, body["error"].as_str()),
            (
                StatusCode::UNPROCESSABLE_ENTITY,
                Some("SINGLE_THRESHOLD_MAX_HOLDING_BARS_ZERO")
            )
        );

        // Validate names the strategy without writing it; create writes it under that name.
        let (status, validated, _) = call(
            &app,
            "POST",
            "/v1/strategies/validate",
            token,
            Some(json!({"spec": statement(&falsifier)})),
        )
        .await;
        assert_eq!(
            (status, validated["result"].as_str()),
            (StatusCode::OK, Some("VALID"))
        );
        let id = validated["strategy_id"].as_str().unwrap().to_owned();
        let (status, _, _) = call(&app, "GET", &format!("/v1/strategies/{id}"), token, None).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "validate writes nothing");

        let (status, created, _) = call(
            &app,
            "POST",
            "/v1/strategies",
            token,
            Some(json!({"spec": statement(&falsifier)})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(created["strategy_id"].as_str(), Some(id.as_str()));
        assert!(created.get("predecessor_id").is_none());
        let (_, again, _) = call(
            &app,
            "POST",
            "/v1/strategies",
            token,
            Some(json!({"spec": statement(&falsifier)})),
        )
        .await;
        assert_eq!(again, created, "the same statement is the same strategy");

        // Read back byte for byte: the spec served is the bytes that hash to the id.
        let (status, read, raw) =
            call(&app, "GET", &format!("/v1/strategies/{id}"), token, None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(read, created);
        let served: Served<'_> = serde_json::from_slice(&raw).unwrap();
        assert_eq!(
            stored_strategy_identity_v1(served.spec.get().as_bytes())
                .map(|identity| identity.to_string()),
            Some(id.clone()),
            "the spec served is exactly the bytes its identity hashes"
        );

        // Revise into a successor that names its predecessor.
        let mut revised = statement(&falsifier);
        revised["max_holding_bars"] = json!(6);
        let (status, successor, _) = call(
            &app,
            "POST",
            &format!("/v1/strategies/{id}/revisions"),
            token,
            Some(json!({"spec": revised.clone()})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(successor["predecessor_id"].as_str(), Some(id.as_str()));
        let successor_id = successor["strategy_id"].as_str().unwrap().to_owned();
        assert_ne!(successor_id, id);

        // Revision refusals: the same statement, a statement already under another lineage, and
        // an unknown predecessor.
        let (status, body, _) = call(
            &app,
            "POST",
            &format!("/v1/strategies/{id}/revisions"),
            token,
            Some(json!({"spec": statement(&falsifier)})),
        )
        .await;
        assert_eq!(
            (status, body["error"].as_str()),
            (StatusCode::CONFLICT, Some("STRATEGY_REVISION_UNCHANGED"))
        );
        let (status, body, _) = call(
            &app,
            "POST",
            &format!("/v1/strategies/{successor_id}/revisions"),
            token,
            Some(json!({"spec": statement(&falsifier)})),
        )
        .await;
        assert_eq!(
            (status, body["error"].as_str()),
            (
                StatusCode::CONFLICT,
                Some("STRATEGY_EXISTS_UNDER_ANOTHER_LINEAGE")
            )
        );
        let unknown = format!("sha256:{}", "0".repeat(64));
        let (status, body, _) = call(
            &app,
            "POST",
            &format!("/v1/strategies/{unknown}/revisions"),
            token,
            Some(json!({"spec": revised})),
        )
        .await;
        assert_eq!(
            (status, body["error"].as_str()),
            (StatusCode::NOT_FOUND, Some("STRATEGY_UNKNOWN"))
        );

        // List shows both; archiving keeps the strategy readable and refuses its revision.
        let (status, listed, raw) =
            call(&app, "GET", "/v1/strategies?limit=500", token, None).await;
        assert_eq!(status, StatusCode::OK);
        let page: Listed<'_> = serde_json::from_slice(&raw).unwrap();

        for strategy in &page.strategies {
            assert_eq!(
                stored_strategy_identity_v1(strategy.spec.get().as_bytes())
                    .map(|identity| identity.to_string()),
                Some(strategy.strategy_id.clone()),
                "a listed spec is exactly the bytes its identity hashes"
            );
        }
        let ids = listed["strategies"]
            .as_array()
            .unwrap()
            .iter()
            .map(|strategy| strategy["strategy_id"].as_str().unwrap().to_owned())
            .collect::<Vec<_>>();
        assert!(ids.contains(&id) && ids.contains(&successor_id));
        let (status, body, _) = call(&app, "GET", "/v1/strategies?limit=501", token, None).await;
        assert_eq!(
            (status, body["error"].as_str()),
            (
                StatusCode::BAD_REQUEST,
                Some("STRATEGY_LIST_LIMIT_OUT_OF_RANGE")
            )
        );

        let (status, archived, _) = call(
            &app,
            "POST",
            &format!("/v1/strategies/{id}/archive"),
            token,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(archived["archived_at_epoch_ms"].as_u64().is_some());
        let (_, archived_again, _) = call(
            &app,
            "POST",
            &format!("/v1/strategies/{id}/archive"),
            token,
            None,
        )
        .await;
        assert_eq!(
            archived_again, archived,
            "archiving again reads back the first archiving"
        );
        let (status, read_archived, _) =
            call(&app, "GET", &format!("/v1/strategies/{id}"), token, None).await;
        assert_eq!((status, &read_archived), (StatusCode::OK, &archived));
        let mut third = statement(&falsifier);
        third["max_holding_bars"] = json!(7);
        let (status, body, _) = call(
            &app,
            "POST",
            &format!("/v1/strategies/{id}/revisions"),
            token,
            Some(json!({"spec": third})),
        )
        .await;
        assert_eq!(
            (status, body["error"].as_str()),
            (StatusCode::CONFLICT, Some("STRATEGY_ARCHIVED"))
        );
        let (_, listed, _) = call(&app, "GET", "/v1/strategies?limit=500", token, None).await;
        assert!(
            !listed["strategies"]
                .as_array()
                .unwrap()
                .iter()
                .any(|strategy| strategy["strategy_id"].as_str() == Some(id.as_str())),
            "an archived strategy is listed only when asked for"
        );
        let (_, listed, _) = call(
            &app,
            "GET",
            "/v1/strategies?include_archived=true&limit=500",
            token,
            None,
        )
        .await;
        assert!(
            listed["strategies"]
                .as_array()
                .unwrap()
                .iter()
                .any(|strategy| strategy["strategy_id"].as_str() == Some(id.as_str()))
        );

        // A stored statement whose bytes no longer hash to its identity is refused, not served;
        // the exact bytes are restored before anything else reads the table.
        let identity = StrategyIdentityV1::parse(&successor_id).unwrap();
        let original: Vec<u8> = sqlx::query_scalar(
            "SELECT spec_bytes FROM rd_strategy_specs_v1 WHERE strategy_identity=$1",
        )
        .bind(identity.as_bytes().as_slice())
        .fetch_one(&rd_pool)
        .await
        .unwrap();
        let mut tampered = original.clone();
        tampered.push(b' ');
        sqlx::query("UPDATE rd_strategy_specs_v1 SET spec_bytes=$2 WHERE strategy_identity=$1")
            .bind(identity.as_bytes().as_slice())
            .bind(&tampered)
            .execute(&rd_pool)
            .await
            .unwrap();
        let (status, body, _) = call(
            &app,
            "GET",
            &format!("/v1/strategies/{successor_id}"),
            token,
            None,
        )
        .await;
        sqlx::query("UPDATE rd_strategy_specs_v1 SET spec_bytes=$2 WHERE strategy_identity=$1")
            .bind(identity.as_bytes().as_slice())
            .bind(&original)
            .execute(&rd_pool)
            .await
            .unwrap();
        assert_eq!(
            (status, body["error"].as_str()),
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Some("RD_OWNER_CUSTODY_UNAVAILABLE")
            )
        );
        let (status, restored, _) = call(
            &app,
            "GET",
            &format!("/v1/strategies/{successor_id}"),
            token,
            None,
        )
        .await;
        assert_eq!((status, &restored), (StatusCode::OK, &successor));

        // An authoring-language document is a strategy too: validated and created on the same
        // routes, under an identity of its own, and read back as the bytes that hash to it. The
        // falsifier is unique to this run, so no earlier run's row answers for it.
        let mut document: serde_json::Value = serde_json::from_str(include_str!(
            "../../strategy_factory/test_data/strategy_authoring_v1/t0-daily-trend.json"
        ))
        .unwrap();
        document["falsifier"] = json!(format!("T0 earns nothing over random entries, run {run}"));
        let (status, validated, _) = call(
            &app,
            "POST",
            "/v1/strategies/validate",
            token,
            Some(json!({"spec": document.clone()})),
        )
        .await;
        assert_eq!(
            (status, validated["result"].as_str()),
            (StatusCode::OK, Some("VALID"))
        );
        let (status, created, _) = call(
            &app,
            "POST",
            "/v1/strategies",
            token,
            Some(json!({"spec": document})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(created["strategy_id"], validated["strategy_id"]);
        let document_id = created["strategy_id"].as_str().unwrap().to_owned();
        let (status, _, raw) = call(
            &app,
            "GET",
            &format!("/v1/strategies/{document_id}"),
            token,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let served: Served<'_> = serde_json::from_slice(&raw).unwrap();
        assert_eq!(
            stored_strategy_identity_v1(served.spec.get().as_bytes())
                .map(|identity| identity.to_string()),
            Some(document_id),
            "the document served is exactly the bytes its identity hashes"
        );
    }
}
