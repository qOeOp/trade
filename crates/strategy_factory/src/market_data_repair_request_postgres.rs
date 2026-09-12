//! PostgreSQL custody for effect-free Market Data repair requests.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use thiserror::Error;
use vibe_data::owner::{
    instrument_master_v2::InstrumentMasterResolverV2,
    instrument_master_v2_postgres::InstrumentMasterV2PostgresOwner,
    native_replay_scheduling_v1::NativeReplaySchedulingResolverV1,
    shared_time_evidence::{SharedTimeEvidenceResolver, UntrustedClockHeadLocator},
};

use crate::{
    BacktestResultCustodyErrorV2, ExploratoryReplayResultLocatorV2,
    develop_composer_postgres_v2::DevelopComposerSealedReadPortV2,
    exploratory_replay::ExploratoryReplayRequestLocatorV2,
    market_data_repair_request::{
        MarketDataRepairRequestErrorV1, MarketDataRepairRequestReadbackV1,
        admit_stored_market_data_repair_request_v1, issue_market_data_repair_request_v1,
    },
    native_replay_initial_owner_inputs_v1::resolve_native_replay_initial_owner_inputs_v1,
    native_replay_preparation_inputs_v2::{
        NativeReplayPreparationInputsV2, resolve_native_replay_preparation_inputs_v2_in_transaction,
    },
    strategy_plan_v2::StrategyPlanV2,
};

const REQUESTED_EVENT_V1: &str = "MARKET_DATA_REPAIR_REQUESTED_V1";

pub(crate) const TABLES: &[crate::schema_materialization::PublicTableSpec] = &[
    crate::schema_materialization::PublicTableSpec {
        name: "rd_market_data_repair_requests_v1",
        runtime_read_grantees: &[],
        columns: &[
            crate::schema_materialization::required("request_identity", "text"),
            crate::schema_materialization::required("action_request_identity", "text"),
            crate::schema_materialization::required("decision_identity", "text"),
            crate::schema_materialization::required("result_identity", "text"),
            crate::schema_materialization::required("request_digest", "text"),
            crate::schema_materialization::required("request_json", "jsonb"),
            crate::schema_materialization::required("receipt_json", "jsonb"),
            crate::schema_materialization::required("request_storage_bytes", "bytea"),
            crate::schema_materialization::required("request_storage_digest", "text"),
            crate::schema_materialization::required("receipt_storage_bytes", "bytea"),
            crate::schema_materialization::required("receipt_storage_digest", "text"),
            crate::schema_materialization::required("committed_at_epoch_ms", "bigint"),
        ],
        constraints: &[
            "f:action_request_identity:public.rd_repair_action_requests_v1(action_request_identity):a:a:s:false:false:true:",
            "p:request_identity:::false:false:true:",
            "u:action_request_identity:::false:false:true:",
            "u:decision_identity:::false:false:true:",
            "u:result_identity:::false:false:true:",
        ],
        indexes: &[
            crate::schema_materialization::primary_index("request_identity"),
            crate::schema_materialization::unique_index("action_request_identity"),
            crate::schema_materialization::unique_index("decision_identity"),
            crate::schema_materialization::unique_index("result_identity"),
        ],
    },
];

#[derive(Debug, Clone, Eq, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MarketDataRepairCompositionRequestV1 {
    pub action_request_identity: String,
    pub decision_identity: String,
    pub result_identity: String,
    pub attempt_identity: String,
    pub replay: ExploratoryReplayRequestLocatorV2,
    pub shared_time_head: UntrustedClockHeadLocator,
}

#[derive(Debug, Error)]
pub enum MarketDataRepairPostgresErrorV1 {
    #[error("Market Data repair composition locator is invalid")]
    InvalidLocator,
    #[error("Market Data repair request is unavailable: {0}")]
    Request(#[from] MarketDataRepairRequestErrorV1),
    #[error("Market Data repair custody is unavailable: {0}")]
    Unavailable(String),
}

pub(crate) async fn migrate(pool: &PgPool) -> Result<(), MarketDataRepairPostgresErrorV1> {
    crate::schema_materialization::materialize_public_table(
        pool,
        "rd_market_data_repair_requests_v1",
        "CREATE TABLE IF NOT EXISTS rd_market_data_repair_requests_v1 (request_identity TEXT PRIMARY KEY, action_request_identity TEXT NOT NULL UNIQUE REFERENCES rd_repair_action_requests_v1(action_request_identity), decision_identity TEXT NOT NULL UNIQUE, result_identity TEXT NOT NULL UNIQUE, request_digest TEXT NOT NULL, request_json JSONB NOT NULL, receipt_json JSONB NOT NULL, request_storage_bytes BYTEA NOT NULL, request_storage_digest TEXT NOT NULL, receipt_storage_bytes BYTEA NOT NULL, receipt_storage_digest TEXT NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
    )
    .await
    .map_err(unavailable)
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn compose_market_data_repair_request_v1<P, M, T>(
    pool: &PgPool,
    request: MarketDataRepairCompositionRequestV1,
    composer: &P,
    instrument_master_owner: &InstrumentMasterV2PostgresOwner,
    market_data: &M,
    shared_time: &T,
) -> Result<MarketDataRepairRequestReadbackV1, MarketDataRepairPostgresErrorV1>
where
    P: DevelopComposerSealedReadPortV2 + ?Sized,
    M: NativeReplaySchedulingResolverV1 + ?Sized,
    T: SharedTimeEvidenceResolver + ?Sized,
{
    validate_locator(&request)?;
    let mut transaction = pool.begin().await.map_err(unavailable)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .execute(&mut *transaction)
        .await
        .map_err(unavailable)?;
    lock_composition_key(&mut transaction, &request.action_request_identity).await?;
    let inputs = resolve_inputs(
        &mut transaction,
        &request,
        composer,
        instrument_master_owner,
        market_data,
        shared_time,
    )
    .await?;
    let rows = load_rows(&mut transaction, &request.action_request_identity).await?;
    let readback = if rows.is_empty() {
        let issued = issue_market_data_repair_request_v1(
            &inputs.action,
            &inputs.decision,
            inputs.preparation.replay().request(),
            inputs.result.result(),
            inputs.source,
            inputs.shared_time,
            current_epoch_ms()?,
        )?;
        persist(&mut transaction, &issued).await?;
        verify_row_matches_issued(
            load_rows(&mut transaction, &request.action_request_identity).await?,
            &issued,
        )?;
        issued
    } else {
        admit_row(
            rows,
            &inputs.action,
            &inputs.decision,
            inputs.preparation.replay().request(),
            inputs.result.result(),
            inputs.source,
            inputs.shared_time,
        )?
    };
    verify_outbox(&mut transaction, &readback).await?;
    transaction.commit().await.map_err(unavailable)?;
    Ok(readback)
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn resolve_market_data_repair_request_v1<P, M, T>(
    pool: &PgPool,
    request: MarketDataRepairCompositionRequestV1,
    composer: &P,
    instrument_master_owner: &InstrumentMasterV2PostgresOwner,
    market_data: &M,
    shared_time: &T,
) -> Result<Option<MarketDataRepairRequestReadbackV1>, MarketDataRepairPostgresErrorV1>
where
    P: DevelopComposerSealedReadPortV2 + ?Sized,
    M: NativeReplaySchedulingResolverV1 + ?Sized,
    T: SharedTimeEvidenceResolver + ?Sized,
{
    validate_locator(&request)?;
    let mut transaction = pool.begin().await.map_err(unavailable)?;
    let rows = load_rows(&mut transaction, &request.action_request_identity).await?;
    if rows.is_empty() {
        transaction.commit().await.map_err(unavailable)?;
        return Ok(None);
    }
    let inputs = resolve_inputs(
        &mut transaction,
        &request,
        composer,
        instrument_master_owner,
        market_data,
        shared_time,
    )
    .await?;
    let readback = admit_row(
        rows,
        &inputs.action,
        &inputs.decision,
        inputs.preparation.replay().request(),
        inputs.result.result(),
        inputs.source,
        inputs.shared_time,
    )?;
    verify_outbox(&mut transaction, &readback).await?;
    transaction.commit().await.map_err(unavailable)?;
    Ok(Some(readback))
}

struct ResolvedInputs {
    action: crate::repair_action::RepairActionRequestReadbackV1,
    decision: crate::iteration_decision::RepairInputIterationDecisionReadbackV1,
    preparation: NativeReplayPreparationInputsV2,
    result: crate::LockedExploratoryReplayResultV2,
    source: vibe_data::owner::native_replay_scheduling_v1::MarketDataRepairSourceV1,
    shared_time: vibe_data::owner::shared_time_evidence::ClockHeadHandoff,
}

async fn resolve_inputs<P, M, T>(
    transaction: &mut Transaction<'_, Postgres>,
    request: &MarketDataRepairCompositionRequestV1,
    composer: &P,
    instrument_master_owner: &InstrumentMasterV2PostgresOwner,
    market_data: &M,
    shared_time_resolver: &T,
) -> Result<ResolvedInputs, MarketDataRepairPostgresErrorV1>
where
    P: DevelopComposerSealedReadPortV2 + ?Sized,
    M: NativeReplaySchedulingResolverV1 + ?Sized,
    T: SharedTimeEvidenceResolver + ?Sized,
{
    let action = crate::iteration_decision_postgres::load_repair_action_in_transaction(
        transaction,
        &request.decision_identity,
        None,
    )
    .await
    .map_err(|error| unavailable(error.to_string()))?
    .ok_or_else(|| unavailable("repair action custody is missing"))?;
    if action.request().action_request_identity() != request.action_request_identity
        || action.request().result_identity() != request.result_identity
    {
        return Err(unavailable("repair action locator mismatch"));
    }
    let decision = crate::iteration_decision_postgres::load_by_result_in_transaction(
        transaction,
        &request.result_identity,
        None,
    )
    .await
    .map_err(|error| unavailable(error.to_string()))?
    .ok_or_else(|| unavailable("Iteration Decision custody is missing"))?;
    let result = crate::resolve_exploratory_replay_result_for_rd_in_transaction(
        transaction,
        ExploratoryReplayResultLocatorV2 {
            result_identity: &request.result_identity,
            request_identity: &request.replay.request_identity,
            attempt_identity: &request.attempt_identity,
        },
    )
    .await
    .map_err(|error: BacktestResultCustodyErrorV2| unavailable(error.to_string()))?
    .ok_or_else(|| unavailable("locked exploratory Result is missing"))?;
    let preparation = resolve_native_replay_preparation_inputs_v2_in_transaction(
        transaction,
        &request.replay,
        composer,
    )
    .await
    .map_err(|error| unavailable(error.to_string()))?;
    let plan =
        StrategyPlanV2::decode_owner_resolution_projection(preparation.composer().plan_bytes())
            .map_err(|error| unavailable(error.to_string()))?;
    let instrument_master = instrument_master_owner
        .resolve_instrument_master_v2_for_native_replay_request(
            request.replay.request_identity.as_str(),
        )
        .await
        .map_err(|error| unavailable(error.to_string()))?;
    let source = resolve_native_replay_initial_owner_inputs_v1(
        &preparation,
        &plan,
        &instrument_master,
        market_data,
    )
    .await
    .map_err(|error| unavailable(error.to_string()))?
    .into_market_data_repair_source();
    let shared_time = shared_time_resolver
        .resolve_clock_head(&request.shared_time_head)
        .await
        .map_err(|error| unavailable(error.to_string()))?;
    Ok(ResolvedInputs {
        action,
        decision,
        preparation,
        result,
        source,
        shared_time,
    })
}

async fn persist(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &MarketDataRepairRequestReadbackV1,
) -> Result<(), MarketDataRepairPostgresErrorV1> {
    let request = readback.request();
    let receipt = readback.receipt();
    let request_bytes = request.to_canonical_bytes()?;
    let receipt_bytes = serde_json::to_vec(receipt).map_err(unavailable)?;
    let request_storage_digest =
        storage_digest("rd.market-data-repair-request.storage.v1", &request_bytes);
    let receipt_storage_digest = storage_digest(
        "rd.market-data-repair-request-receipt.storage.v1",
        &receipt_bytes,
    );
    sqlx::query("INSERT INTO rd_market_data_repair_requests_v1 (request_identity,action_request_identity,decision_identity,result_identity,request_digest,request_json,receipt_json,request_storage_bytes,request_storage_digest,receipt_storage_bytes,receipt_storage_digest,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)")
        .bind(request.request_identity())
        .bind(request.action_request_identity())
        .bind(request.decision_identity())
        .bind(request.result_identity())
        .bind(request.request_digest())
        .bind(serde_json::to_value(request).map_err(unavailable)?)
        .bind(serde_json::to_value(receipt).map_err(unavailable)?)
        .bind(request_bytes)
        .bind(request_storage_digest)
        .bind(receipt_bytes)
        .bind(receipt_storage_digest)
        .bind(i64::try_from(receipt.committed_at_epoch_ms()).map_err(unavailable)?)
        .execute(&mut **transaction)
        .await
        .map_err(unavailable)?;
    let payload = RequestedOutboxV1 {
        schema_version: 1,
        request_identity: request.request_identity().to_string(),
        request_digest: request.request_digest().to_string(),
        receipt_identity: receipt.receipt_identity().to_string(),
        receipt_digest: receipt.receipt_digest().to_string(),
        action_request_identity: request.action_request_identity().to_string(),
        decision_identity: request.decision_identity().to_string(),
        result_identity: request.result_identity().to_string(),
        category: request.category(),
        target: request.target(),
    };
    let payload_digest =
        canonical_digest("rd.owner-outbox.market-data-repair-request.v1", &payload)?;
    sqlx::query("INSERT INTO rd_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(format!("rd-owner-outbox-market-data-repair-v1-{}", payload_digest.trim_start_matches("sha256:")))
        .bind(request.request_identity())
        .bind(REQUESTED_EVENT_V1)
        .bind(payload_digest)
        .bind(serde_json::to_value(payload).map_err(unavailable)?)
        .bind(i64::try_from(receipt.committed_at_epoch_ms()).map_err(unavailable)?)
        .execute(&mut **transaction)
        .await
        .map_err(unavailable)?;
    Ok(())
}

fn admit_row(
    rows: Vec<sqlx::postgres::PgRow>,
    action: &crate::repair_action::RepairActionRequestReadbackV1,
    decision: &crate::iteration_decision::RepairInputIterationDecisionReadbackV1,
    replay: &vibe_backtest_owner_contracts::ReplayRequestV2,
    result: &vibe_backtest_owner_contracts::ReplayResultDtoV2,
    source: vibe_data::owner::native_replay_scheduling_v1::MarketDataRepairSourceV1,
    shared_time: vibe_data::owner::shared_time_evidence::ClockHeadHandoff,
) -> Result<MarketDataRepairRequestReadbackV1, MarketDataRepairPostgresErrorV1> {
    if rows.len() != 1 {
        return Err(unavailable("repair request identity is not unique"));
    }
    let row = &rows[0];
    let request_bytes: Vec<u8> = row.try_get("request_storage_bytes").map_err(unavailable)?;
    let receipt_bytes: Vec<u8> = row.try_get("receipt_storage_bytes").map_err(unavailable)?;
    if row
        .try_get::<String, _>("request_storage_digest")
        .map_err(unavailable)?
        != storage_digest("rd.market-data-repair-request.storage.v1", &request_bytes)
        || row
            .try_get::<String, _>("receipt_storage_digest")
            .map_err(unavailable)?
            != storage_digest(
                "rd.market-data-repair-request-receipt.storage.v1",
                &receipt_bytes,
            )
    {
        return Err(unavailable("repair request storage digest mismatch"));
    }
    let committed_at_epoch_ms = u64::try_from(
        row.try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(unavailable)?,
    )
    .map_err(unavailable)?;
    let readback = admit_stored_market_data_repair_request_v1(
        &request_bytes,
        &receipt_bytes,
        action,
        decision,
        replay,
        result,
        source,
        shared_time,
        committed_at_epoch_ms,
    )?;
    let request = readback.request();
    if row
        .try_get::<String, _>("request_identity")
        .map_err(unavailable)?
        != request.request_identity()
        || row
            .try_get::<String, _>("action_request_identity")
            .map_err(unavailable)?
            != request.action_request_identity()
        || row
            .try_get::<String, _>("decision_identity")
            .map_err(unavailable)?
            != request.decision_identity()
        || row
            .try_get::<String, _>("result_identity")
            .map_err(unavailable)?
            != request.result_identity()
        || row
            .try_get::<String, _>("request_digest")
            .map_err(unavailable)?
            != request.request_digest()
        || row
            .try_get::<serde_json::Value, _>("request_json")
            .map_err(unavailable)?
            != serde_json::to_value(request).map_err(unavailable)?
        || row
            .try_get::<serde_json::Value, _>("receipt_json")
            .map_err(unavailable)?
            != serde_json::to_value(readback.receipt()).map_err(unavailable)?
    {
        return Err(unavailable("repair request row/readback mismatch"));
    }
    Ok(readback)
}

#[cfg(test)]
pub(crate) async fn compose_with_sealed_owner_evidence_for_test_v1(
    pool: &PgPool,
    action_request_identity: &str,
    decision_identity: &str,
    replay: &vibe_backtest_owner_contracts::ReplayRequestV2,
    source: vibe_data::owner::native_replay_scheduling_v1::MarketDataRepairSourceV1,
    shared_time: vibe_data::owner::shared_time_evidence::ClockHeadHandoff,
) -> Result<MarketDataRepairRequestReadbackV1, MarketDataRepairPostgresErrorV1> {
    store_with_sealed_owner_evidence_for_test_v1(
        pool,
        action_request_identity,
        decision_identity,
        replay,
        source,
        shared_time,
        false,
    )
    .await?
    .ok_or_else(|| unavailable("Market Data repair request commit is missing"))
}

#[cfg(test)]
pub(crate) async fn resolve_with_sealed_owner_evidence_for_test_v1(
    pool: &PgPool,
    action_request_identity: &str,
    decision_identity: &str,
    replay: &vibe_backtest_owner_contracts::ReplayRequestV2,
    source: vibe_data::owner::native_replay_scheduling_v1::MarketDataRepairSourceV1,
    shared_time: vibe_data::owner::shared_time_evidence::ClockHeadHandoff,
) -> Result<Option<MarketDataRepairRequestReadbackV1>, MarketDataRepairPostgresErrorV1> {
    store_with_sealed_owner_evidence_for_test_v1(
        pool,
        action_request_identity,
        decision_identity,
        replay,
        source,
        shared_time,
        true,
    )
    .await
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
async fn store_with_sealed_owner_evidence_for_test_v1(
    pool: &PgPool,
    action_request_identity: &str,
    decision_identity: &str,
    replay: &vibe_backtest_owner_contracts::ReplayRequestV2,
    source: vibe_data::owner::native_replay_scheduling_v1::MarketDataRepairSourceV1,
    shared_time: vibe_data::owner::shared_time_evidence::ClockHeadHandoff,
    resolve_only: bool,
) -> Result<Option<MarketDataRepairRequestReadbackV1>, MarketDataRepairPostgresErrorV1> {
    let mut transaction = pool.begin().await.map_err(unavailable)?;
    if !resolve_only {
        lock_composition_key(&mut transaction, action_request_identity).await?;
    }
    let action = crate::iteration_decision_postgres::load_repair_action_in_transaction(
        &mut transaction,
        decision_identity,
        None,
    )
    .await
    .map_err(|error| unavailable(error.to_string()))?
    .ok_or_else(|| unavailable("repair action custody is missing"))?;
    if action.request().action_request_identity() != action_request_identity {
        return Err(unavailable("repair action locator mismatch"));
    }
    let result_identity = action.request().result_identity();
    let decision = crate::iteration_decision_postgres::load_by_result_in_transaction(
        &mut transaction,
        result_identity,
        None,
    )
    .await
    .map_err(|error| unavailable(error.to_string()))?
    .ok_or_else(|| unavailable("Iteration Decision custody is missing"))?;
    if decision.decision().decision_identity() != decision_identity {
        return Err(unavailable("Iteration Decision locator mismatch"));
    }
    let result = crate::resolve_exploratory_replay_result_for_rd_in_transaction(
        &mut transaction,
        ExploratoryReplayResultLocatorV2 {
            result_identity,
            request_identity: replay.request_identity().as_str(),
            attempt_identity: &decision.decision().evidence_cut().attempt_identity,
        },
    )
    .await
    .map_err(|error: BacktestResultCustodyErrorV2| unavailable(error.to_string()))?
    .ok_or_else(|| unavailable("locked exploratory Result is missing"))?;
    let rows = load_rows(&mut transaction, action_request_identity).await?;
    if resolve_only && rows.is_empty() {
        transaction.commit().await.map_err(unavailable)?;
        return Ok(None);
    }
    let readback = if rows.is_empty() {
        let issued = issue_market_data_repair_request_v1(
            &action,
            &decision,
            replay,
            result.result(),
            source,
            shared_time,
            current_epoch_ms()?,
        )?;
        persist(&mut transaction, &issued).await?;
        verify_row_matches_issued(
            load_rows(&mut transaction, action_request_identity).await?,
            &issued,
        )?;
        issued
    } else {
        admit_row(
            rows,
            &action,
            &decision,
            replay,
            result.result(),
            source,
            shared_time,
        )?
    };
    verify_outbox(&mut transaction, &readback).await?;
    transaction.commit().await.map_err(unavailable)?;
    Ok(Some(readback))
}

fn verify_row_matches_issued(
    rows: Vec<sqlx::postgres::PgRow>,
    issued: &MarketDataRepairRequestReadbackV1,
) -> Result<(), MarketDataRepairPostgresErrorV1> {
    if rows.len() != 1 {
        return Err(unavailable("committed repair request readback is missing"));
    }
    let row = &rows[0];
    let request = issued.request();
    let receipt = issued.receipt();
    let request_bytes = request.to_canonical_bytes()?;
    let receipt_bytes = serde_json::to_vec(receipt).map_err(unavailable)?;
    if row
        .try_get::<String, _>("request_identity")
        .map_err(unavailable)?
        != request.request_identity()
        || row
            .try_get::<String, _>("action_request_identity")
            .map_err(unavailable)?
            != request.action_request_identity()
        || row
            .try_get::<String, _>("decision_identity")
            .map_err(unavailable)?
            != request.decision_identity()
        || row
            .try_get::<String, _>("result_identity")
            .map_err(unavailable)?
            != request.result_identity()
        || row
            .try_get::<String, _>("request_digest")
            .map_err(unavailable)?
            != request.request_digest()
        || row
            .try_get::<serde_json::Value, _>("request_json")
            .map_err(unavailable)?
            != serde_json::to_value(request).map_err(unavailable)?
        || row
            .try_get::<serde_json::Value, _>("receipt_json")
            .map_err(unavailable)?
            != serde_json::to_value(receipt).map_err(unavailable)?
        || row
            .try_get::<Vec<u8>, _>("request_storage_bytes")
            .map_err(unavailable)?
            != request_bytes
        || row
            .try_get::<String, _>("request_storage_digest")
            .map_err(unavailable)?
            != storage_digest("rd.market-data-repair-request.storage.v1", &request_bytes)
        || row
            .try_get::<Vec<u8>, _>("receipt_storage_bytes")
            .map_err(unavailable)?
            != receipt_bytes
        || row
            .try_get::<String, _>("receipt_storage_digest")
            .map_err(unavailable)?
            != storage_digest(
                "rd.market-data-repair-request-receipt.storage.v1",
                &receipt_bytes,
            )
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(unavailable)?
            != i64::try_from(receipt.committed_at_epoch_ms()).map_err(unavailable)?
    {
        return Err(unavailable("committed repair request readback changed"));
    }
    Ok(())
}

async fn load_rows(
    transaction: &mut Transaction<'_, Postgres>,
    action_request_identity: &str,
) -> Result<Vec<sqlx::postgres::PgRow>, MarketDataRepairPostgresErrorV1> {
    sqlx::query("SELECT request_identity,action_request_identity,decision_identity,result_identity,request_digest,request_json,receipt_json,request_storage_bytes,request_storage_digest,receipt_storage_bytes,receipt_storage_digest,committed_at_epoch_ms FROM rd_market_data_repair_requests_v1 WHERE action_request_identity=$1 FOR SHARE")
        .bind(action_request_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(unavailable)
}

async fn verify_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &MarketDataRepairRequestReadbackV1,
) -> Result<(), MarketDataRepairPostgresErrorV1> {
    let request = readback.request();
    let receipt = readback.receipt();
    let rows = sqlx::query("SELECT aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms FROM rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind=$2 FOR SHARE")
        .bind(request.request_identity())
        .bind(REQUESTED_EVENT_V1)
        .fetch_all(&mut **transaction)
        .await
        .map_err(unavailable)?;
    if rows.len() != 1 {
        return Err(unavailable("repair request outbox custody is incomplete"));
    }
    let expected = RequestedOutboxV1 {
        schema_version: 1,
        request_identity: request.request_identity().to_string(),
        request_digest: request.request_digest().to_string(),
        receipt_identity: receipt.receipt_identity().to_string(),
        receipt_digest: receipt.receipt_digest().to_string(),
        action_request_identity: request.action_request_identity().to_string(),
        decision_identity: request.decision_identity().to_string(),
        result_identity: request.result_identity().to_string(),
        category: request.category(),
        target: request.target(),
    };
    let row = &rows[0];
    if row
        .try_get::<String, _>("aggregate_identity")
        .map_err(unavailable)?
        != request.request_identity()
        || row
            .try_get::<String, _>("event_kind")
            .map_err(unavailable)?
            != REQUESTED_EVENT_V1
        || row
            .try_get::<String, _>("payload_digest")
            .map_err(unavailable)?
            != canonical_digest("rd.owner-outbox.market-data-repair-request.v1", &expected)?
        || row
            .try_get::<serde_json::Value, _>("payload_json")
            .map_err(unavailable)?
            != serde_json::to_value(expected).map_err(unavailable)?
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(unavailable)?
            != i64::try_from(receipt.committed_at_epoch_ms()).map_err(unavailable)?
    {
        return Err(unavailable("repair request outbox/readback mismatch"));
    }
    Ok(())
}

#[derive(Serialize)]
struct RequestedOutboxV1 {
    schema_version: u16,
    request_identity: String,
    request_digest: String,
    receipt_identity: String,
    receipt_digest: String,
    action_request_identity: String,
    decision_identity: String,
    result_identity: String,
    category: crate::iteration_decision::IterationRepairCategoryV1,
    target: crate::iteration_decision::IterationRepairTargetV1,
}

fn validate_locator(
    request: &MarketDataRepairCompositionRequestV1,
) -> Result<(), MarketDataRepairPostgresErrorV1> {
    let values = [
        request.action_request_identity.as_str(),
        request.decision_identity.as_str(),
        request.result_identity.as_str(),
        request.attempt_identity.as_str(),
        request.replay.request_identity.as_str(),
        request.replay.meaning_digest.as_str(),
        request.replay.receipt_identity.as_str(),
        request.replay.seal_digest.as_str(),
    ];
    if values
        .into_iter()
        .all(|value| !value.is_empty() && value.len() <= 512)
    {
        Ok(())
    } else {
        Err(MarketDataRepairPostgresErrorV1::InvalidLocator)
    }
}

async fn lock_composition_key(
    transaction: &mut Transaction<'_, Postgres>,
    identity: &str,
) -> Result<(), MarketDataRepairPostgresErrorV1> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(identity)
        .execute(&mut **transaction)
        .await
        .map_err(unavailable)?;
    Ok(())
}

fn storage_digest(domain: &str, bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(domain.as_bytes());
    digest.update([0]);
    digest.update(bytes);
    format!("sha256:{:x}", digest.finalize())
}

fn canonical_digest(
    domain: &str,
    value: &impl Serialize,
) -> Result<String, MarketDataRepairPostgresErrorV1> {
    serde_json::to_vec(value)
        .map(|bytes| storage_digest(domain, &bytes))
        .map_err(unavailable)
}

fn current_epoch_ms() -> Result<u64, MarketDataRepairPostgresErrorV1> {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(unavailable)
        .and_then(|duration| u64::try_from(duration.as_millis()).map_err(unavailable))
}

fn unavailable(error: impl std::fmt::Display) -> MarketDataRepairPostgresErrorV1 {
    MarketDataRepairPostgresErrorV1::Unavailable(error.to_string())
}
