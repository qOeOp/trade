//! PostgreSQL custody for Runtime-kernel native repair requests.

use std::{
    fmt::Display,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use thiserror::Error;
use vibe_data::owner::shared_time_evidence::{
    ClockHeadHandoff, SharedTimeEvidenceResolver, UntrustedClockHeadLocator,
};

use crate::{
    BacktestResultCustodyErrorV2, ExploratoryReplayResultLocatorV2,
    exploratory_replay::ExploratoryReplayRequestLocatorV2,
};

use super::{
    RuntimeKernelNativeRepairRequestErrorV1, RuntimeKernelNativeRepairRequestReadbackV1,
    admit_stored_runtime_kernel_native_repair_request_v1,
    issue_runtime_kernel_native_repair_request_v1,
};

const REQUESTED_EVENT_V1: &str = "RUNTIME_KERNEL_NATIVE_REPAIR_REQUESTED_V1";

/// Canonical schema owned by this custody boundary.
pub(crate) const TABLES: &[crate::schema_materialization::PublicTableSpec] = &[
    crate::schema_materialization::PublicTableSpec {
        name: "rd_runtime_kernel_native_repair_requests_v1",
        runtime_read_grantees: &[],
        columns: &[
            crate::schema_materialization::required("request_identity", "text"),
            crate::schema_materialization::required("request_digest", "text"),
            crate::schema_materialization::required("native_attempt_identity", "text"),
            crate::schema_materialization::required("correlation_identity", "text"),
            crate::schema_materialization::required("action_request_identity", "text"),
            crate::schema_materialization::required("decision_identity", "text"),
            crate::schema_materialization::required("replay_request_identity", "text"),
            crate::schema_materialization::required("result_identity", "text"),
            crate::schema_materialization::required("replay_attempt_identity", "text"),
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
            "u:native_attempt_identity:::false:false:true:",
            "u:correlation_identity:::false:false:true:",
            "u:action_request_identity:::false:false:true:",
            "u:decision_identity:::false:false:true:",
            "u:result_identity:::false:false:true:",
            "u:replay_attempt_identity:::false:false:true:",
        ],
        indexes: &[
            crate::schema_materialization::primary_index("request_identity"),
            crate::schema_materialization::unique_index("native_attempt_identity"),
            crate::schema_materialization::unique_index("correlation_identity"),
            crate::schema_materialization::unique_index("action_request_identity"),
            crate::schema_materialization::unique_index("decision_identity"),
            crate::schema_materialization::unique_index("result_identity"),
            crate::schema_materialization::unique_index("replay_attempt_identity"),
        ],
    },
];

/// Caller-owned identities and exact locators. They carry no repair, Result, Replay, or Time authority.
#[derive(Debug, Clone, Eq, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeKernelNativeRepairCompositionRequestV1 {
    pub action_request_identity: String,
    pub decision_identity: String,
    pub result_identity: String,
    pub replay_attempt_identity: String,
    pub replay: ExploratoryReplayRequestLocatorV2,
    pub shared_time_head: UntrustedClockHeadLocator,
}

#[derive(Debug, Error)]
pub enum RuntimeKernelNativeRepairPostgresErrorV1 {
    #[error("Runtime-kernel native repair composition locator is invalid")]
    InvalidLocator,
    #[error("Runtime-kernel native repair request is unavailable: {0}")]
    Request(#[from] RuntimeKernelNativeRepairRequestErrorV1),
    #[error("Runtime-kernel native repair custody is unavailable: {0}")]
    Unavailable(String),
}

/// Materializes the private, write-once R&D request table.
pub async fn migrate_runtime_kernel_native_repair_request_v1(
    pool: &PgPool,
) -> Result<(), RuntimeKernelNativeRepairPostgresErrorV1> {
    let table = &TABLES[0];
    crate::schema_materialization::materialize_public_table(
        pool,
        table.name,
        "CREATE TABLE IF NOT EXISTS rd_runtime_kernel_native_repair_requests_v1 (request_identity TEXT PRIMARY KEY, request_digest TEXT NOT NULL, native_attempt_identity TEXT NOT NULL UNIQUE, correlation_identity TEXT NOT NULL UNIQUE, action_request_identity TEXT NOT NULL UNIQUE REFERENCES rd_repair_action_requests_v1(action_request_identity), decision_identity TEXT NOT NULL UNIQUE, replay_request_identity TEXT NOT NULL, result_identity TEXT NOT NULL UNIQUE, replay_attempt_identity TEXT NOT NULL UNIQUE, request_json JSONB NOT NULL, receipt_json JSONB NOT NULL, request_storage_bytes BYTEA NOT NULL, request_storage_digest TEXT NOT NULL, receipt_storage_bytes BYTEA NOT NULL, receipt_storage_digest TEXT NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
    )
    .await
    .map_err(unavailable)?;
    sqlx::query("REVOKE ALL ON TABLE public.rd_runtime_kernel_native_repair_requests_v1 FROM PUBLIC, backtest_owner, product_edge_owner, qualification_owner, qualification_writer, operator_authorization_owner, operator_authorization_writer, portfolio_owner, market_data_owner, market_data_reader")
        .execute(pool)
        .await
        .map_err(unavailable)?;
    Ok(())
}

/// Re-resolves every supplied identity from Owner custody and atomically commits one request/outbox pair.
pub async fn compose_runtime_kernel_native_repair_request_v1<T>(
    pool: &PgPool,
    composition: RuntimeKernelNativeRepairCompositionRequestV1,
    shared_time_resolver: &T,
) -> Result<RuntimeKernelNativeRepairRequestReadbackV1, RuntimeKernelNativeRepairPostgresErrorV1>
where
    T: SharedTimeEvidenceResolver + ?Sized,
{
    validate_locator(&composition)?;
    let mut transaction = pool.begin().await.map_err(unavailable)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .execute(&mut *transaction)
        .await
        .map_err(unavailable)?;
    lock_composition_key(&mut transaction, &composition.action_request_identity).await?;
    let inputs = resolve_inputs(&mut transaction, &composition, shared_time_resolver).await?;
    let rows = load_rows(&mut transaction, &composition.action_request_identity).await?;

    let readback = if rows.is_empty() {
        let issued = issue_runtime_kernel_native_repair_request_v1(
            &inputs.action,
            &inputs.decision,
            inputs.replay.request(),
            inputs.result.result(),
            &inputs.shared_time,
            current_epoch_ms()?,
        )?;
        persist(&mut transaction, &issued).await?;
        verify_row_matches_expected(
            &load_rows(&mut transaction, &composition.action_request_identity).await?,
            &issued,
        )?;
        issued
    } else {
        admit_row(&rows, &inputs)?
    };
    verify_outbox(&mut transaction, &readback).await?;
    transaction.commit().await.map_err(unavailable)?;
    Ok(readback)
}

/// Resolves one request only after rechecking its full current Owner cut.
pub async fn resolve_runtime_kernel_native_repair_request_v1<T>(
    pool: &PgPool,
    composition: RuntimeKernelNativeRepairCompositionRequestV1,
    shared_time_resolver: &T,
) -> Result<
    Option<RuntimeKernelNativeRepairRequestReadbackV1>,
    RuntimeKernelNativeRepairPostgresErrorV1,
>
where
    T: SharedTimeEvidenceResolver + ?Sized,
{
    validate_locator(&composition)?;
    let mut transaction = pool.begin().await.map_err(unavailable)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .execute(&mut *transaction)
        .await
        .map_err(unavailable)?;
    let rows = load_rows(&mut transaction, &composition.action_request_identity).await?;
    if rows.is_empty() {
        transaction.commit().await.map_err(unavailable)?;
        return Ok(None);
    }
    let inputs = resolve_inputs(&mut transaction, &composition, shared_time_resolver).await?;
    let readback = admit_row(&rows, &inputs)?;
    verify_outbox(&mut transaction, &readback).await?;
    transaction.commit().await.map_err(unavailable)?;
    Ok(Some(readback))
}

struct ResolvedInputs {
    action: crate::repair_action::RepairActionRequestReadbackV1,
    decision: crate::iteration_decision::RepairInputIterationDecisionReadbackV1,
    replay: crate::exploratory_replay::SealedExploratoryReplayReadbackV2,
    result: crate::LockedExploratoryReplayResultV2,
    shared_time: ClockHeadHandoff,
}

async fn resolve_inputs<T>(
    transaction: &mut Transaction<'_, Postgres>,
    composition: &RuntimeKernelNativeRepairCompositionRequestV1,
    shared_time_resolver: &T,
) -> Result<ResolvedInputs, RuntimeKernelNativeRepairPostgresErrorV1>
where
    T: SharedTimeEvidenceResolver + ?Sized,
{
    let action = crate::iteration_decision_postgres::load_repair_action_in_transaction(
        transaction,
        &composition.decision_identity,
        None,
    )
    .await
    .map_err(unavailable)?
    .ok_or_else(|| unavailable("repair action custody is missing"))?;
    if action.request().action_request_identity() != composition.action_request_identity
        || action.request().result_identity() != composition.result_identity
    {
        return Err(unavailable("repair action locator mismatch"));
    }

    let decision = crate::iteration_decision_postgres::load_by_result_in_transaction(
        transaction,
        &composition.result_identity,
        None,
    )
    .await
    .map_err(unavailable)?
    .ok_or_else(|| unavailable("Iteration Decision custody is missing"))?;
    if decision.decision().decision_identity() != composition.decision_identity {
        return Err(unavailable("Iteration Decision locator mismatch"));
    }

    let replay_cut =
        crate::rd_owner_postgres_custody::resolve_native_replay_rd_cut_v2_in_transaction(
            transaction,
            &composition.replay,
        )
        .await
        .map_err(unavailable)?;
    if replay_cut.replay.locator() != composition.replay {
        return Err(unavailable("sealed Replay V2 locator mismatch"));
    }

    let result = crate::resolve_exploratory_replay_result_for_rd_in_transaction(
        transaction,
        ExploratoryReplayResultLocatorV2 {
            result_identity: &composition.result_identity,
            request_identity: &composition.replay.request_identity,
            attempt_identity: &composition.replay_attempt_identity,
        },
    )
    .await
    .map_err(|error: BacktestResultCustodyErrorV2| unavailable(error))?
    .ok_or_else(|| unavailable("locked terminal exploratory Result is missing"))?;
    let shared_time =
        resolve_exact_shared_time(shared_time_resolver, &composition.shared_time_head).await?;

    Ok(ResolvedInputs {
        action,
        decision,
        replay: replay_cut.replay,
        result,
        shared_time,
    })
}

async fn resolve_exact_shared_time<T>(
    resolver: &T,
    locator: &UntrustedClockHeadLocator,
) -> Result<ClockHeadHandoff, RuntimeKernelNativeRepairPostgresErrorV1>
where
    T: SharedTimeEvidenceResolver + ?Sized,
{
    let handoff = resolver
        .resolve_clock_head(locator)
        .await
        .map_err(unavailable)?;
    if handoff.locator() != locator {
        return Err(unavailable("Shared Time handoff locator mismatch"));
    }
    Ok(handoff)
}

async fn persist(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &RuntimeKernelNativeRepairRequestReadbackV1,
) -> Result<(), RuntimeKernelNativeRepairPostgresErrorV1> {
    let request = readback.request();
    let receipt = readback.receipt();
    let request_bytes = request.to_canonical_bytes()?;
    let receipt_bytes = receipt.to_canonical_bytes()?;
    let request_storage_digest = storage_digest(
        "rd.runtime-kernel-native-repair-request.storage.v1",
        &request_bytes,
    );
    let receipt_storage_digest = storage_digest(
        "rd.runtime-kernel-native-repair-request-receipt.storage.v1",
        &receipt_bytes,
    );
    sqlx::query("INSERT INTO rd_runtime_kernel_native_repair_requests_v1 (request_identity,request_digest,native_attempt_identity,correlation_identity,action_request_identity,decision_identity,replay_request_identity,result_identity,replay_attempt_identity,request_json,receipt_json,request_storage_bytes,request_storage_digest,receipt_storage_bytes,receipt_storage_digest,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)")
        .bind(request.request_identity())
        .bind(request.request_digest())
        .bind(request.native_attempt_identity())
        .bind(request.correlation_identity())
        .bind(request.action_request_identity())
        .bind(request.decision_identity())
        .bind(&request.replay_request_identity)
        .bind(request.result_identity())
        .bind(&request.replay_attempt_identity)
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

    let payload = RequestedOutboxV1::from_readback(readback);
    let payload_digest = canonical_digest(
        "rd.owner-outbox.runtime-kernel-native-repair-request.v1",
        &payload,
    )?;
    sqlx::query("INSERT INTO rd_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(outbox_event_identity(&payload_digest))
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
    rows: &[sqlx::postgres::PgRow],
    inputs: &ResolvedInputs,
) -> Result<RuntimeKernelNativeRepairRequestReadbackV1, RuntimeKernelNativeRepairPostgresErrorV1> {
    if rows.len() != 1 {
        return Err(unavailable("native repair request identity is not unique"));
    }
    let row = &rows[0];
    let request_bytes: Vec<u8> = row.try_get("request_storage_bytes").map_err(unavailable)?;
    let receipt_bytes: Vec<u8> = row.try_get("receipt_storage_bytes").map_err(unavailable)?;
    verify_storage_digests(row, &request_bytes, &receipt_bytes)?;
    let committed_at_epoch_ms = u64::try_from(
        row.try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(unavailable)?,
    )
    .map_err(unavailable)?;
    let readback = admit_stored_runtime_kernel_native_repair_request_v1(
        &request_bytes,
        &receipt_bytes,
        &inputs.action,
        &inputs.decision,
        inputs.replay.request(),
        inputs.result.result(),
        &inputs.shared_time,
        committed_at_epoch_ms,
    )?;
    verify_row_matches_expected(rows, &readback)?;
    Ok(readback)
}

fn verify_storage_digests(
    row: &sqlx::postgres::PgRow,
    request_bytes: &[u8],
    receipt_bytes: &[u8],
) -> Result<(), RuntimeKernelNativeRepairPostgresErrorV1> {
    if row
        .try_get::<String, _>("request_storage_digest")
        .map_err(unavailable)?
        != storage_digest(
            "rd.runtime-kernel-native-repair-request.storage.v1",
            request_bytes,
        )
        || row
            .try_get::<String, _>("receipt_storage_digest")
            .map_err(unavailable)?
            != storage_digest(
                "rd.runtime-kernel-native-repair-request-receipt.storage.v1",
                receipt_bytes,
            )
    {
        return Err(unavailable("native repair request storage digest mismatch"));
    }
    Ok(())
}

fn verify_row_matches_expected(
    rows: &[sqlx::postgres::PgRow],
    expected: &RuntimeKernelNativeRepairRequestReadbackV1,
) -> Result<(), RuntimeKernelNativeRepairPostgresErrorV1> {
    if rows.len() != 1 {
        return Err(unavailable(
            "committed native repair request readback is missing",
        ));
    }
    let row = &rows[0];
    let request = expected.request();
    let receipt = expected.receipt();
    let request_bytes = request.to_canonical_bytes()?;
    let receipt_bytes = receipt.to_canonical_bytes()?;
    verify_storage_digests(row, &request_bytes, &receipt_bytes)?;

    if row
        .try_get::<String, _>("request_identity")
        .map_err(unavailable)?
        != request.request_identity()
        || row
            .try_get::<String, _>("request_digest")
            .map_err(unavailable)?
            != request.request_digest()
        || row
            .try_get::<String, _>("native_attempt_identity")
            .map_err(unavailable)?
            != request.native_attempt_identity()
        || row
            .try_get::<String, _>("correlation_identity")
            .map_err(unavailable)?
            != request.correlation_identity()
        || row
            .try_get::<String, _>("action_request_identity")
            .map_err(unavailable)?
            != request.action_request_identity()
        || row
            .try_get::<String, _>("decision_identity")
            .map_err(unavailable)?
            != request.decision_identity()
        || row
            .try_get::<String, _>("replay_request_identity")
            .map_err(unavailable)?
            != request.replay_request_identity
        || row
            .try_get::<String, _>("result_identity")
            .map_err(unavailable)?
            != request.result_identity()
        || row
            .try_get::<String, _>("replay_attempt_identity")
            .map_err(unavailable)?
            != request.replay_attempt_identity
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
            .try_get::<Vec<u8>, _>("receipt_storage_bytes")
            .map_err(unavailable)?
            != receipt_bytes
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(unavailable)?
            != i64::try_from(receipt.committed_at_epoch_ms()).map_err(unavailable)?
    {
        return Err(unavailable("native repair request row/readback mismatch"));
    }
    Ok(())
}

async fn load_rows(
    transaction: &mut Transaction<'_, Postgres>,
    action_request_identity: &str,
) -> Result<Vec<sqlx::postgres::PgRow>, RuntimeKernelNativeRepairPostgresErrorV1> {
    sqlx::query("SELECT request_identity,request_digest,native_attempt_identity,correlation_identity,action_request_identity,decision_identity,replay_request_identity,result_identity,replay_attempt_identity,request_json,receipt_json,request_storage_bytes,request_storage_digest,receipt_storage_bytes,receipt_storage_digest,committed_at_epoch_ms FROM rd_runtime_kernel_native_repair_requests_v1 WHERE action_request_identity=$1 FOR SHARE")
        .bind(action_request_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(unavailable)
}

async fn verify_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &RuntimeKernelNativeRepairRequestReadbackV1,
) -> Result<(), RuntimeKernelNativeRepairPostgresErrorV1> {
    let request = readback.request();
    let rows = sqlx::query("SELECT event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms FROM rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind=$2 FOR SHARE")
        .bind(request.request_identity())
        .bind(REQUESTED_EVENT_V1)
        .fetch_all(&mut **transaction)
        .await
        .map_err(unavailable)?;
    if rows.len() != 1 {
        return Err(unavailable(
            "native repair request outbox custody is incomplete",
        ));
    }
    let expected = RequestedOutboxV1::from_readback(readback);
    let expected_payload_digest = canonical_digest(
        "rd.owner-outbox.runtime-kernel-native-repair-request.v1",
        &expected,
    )?;
    let row = &rows[0];
    verify_outbox_event_identity(
        &row.try_get::<String, _>("event_identity")
            .map_err(unavailable)?,
        &expected_payload_digest,
    )?;
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
            != expected_payload_digest
        || row
            .try_get::<serde_json::Value, _>("payload_json")
            .map_err(unavailable)?
            != serde_json::to_value(expected).map_err(unavailable)?
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(unavailable)?
            != i64::try_from(readback.receipt().committed_at_epoch_ms()).map_err(unavailable)?
    {
        return Err(unavailable(
            "native repair request outbox/readback mismatch",
        ));
    }
    Ok(())
}

fn outbox_event_identity(payload_digest: &str) -> String {
    format!(
        "rd-owner-outbox-runtime-kernel-native-repair-v1-{}",
        payload_digest.trim_start_matches("sha256:")
    )
}

fn verify_outbox_event_identity(
    actual: &str,
    payload_digest: &str,
) -> Result<(), RuntimeKernelNativeRepairPostgresErrorV1> {
    if actual == outbox_event_identity(payload_digest) {
        Ok(())
    } else {
        Err(unavailable(
            "native repair request outbox identity mismatch",
        ))
    }
}

#[derive(Serialize)]
struct RequestedOutboxV1 {
    schema_version: u16,
    request_identity: String,
    request_digest: String,
    receipt_identity: String,
    receipt_digest: String,
    native_attempt_identity: String,
    correlation_identity: String,
    action_request_identity: String,
    decision_identity: String,
    replay_request_identity: String,
    result_identity: String,
    replay_attempt_identity: String,
    category: crate::iteration_decision::IterationRepairCategoryV1,
    target: crate::iteration_decision::IterationRepairTargetV1,
    policy_identity: String,
    policy_digest: String,
    clock_head_identity: vibe_data::owner::source_binding::BindingDigest,
    clock_head_digest: vibe_data::owner::source_binding::BindingDigest,
}

impl RequestedOutboxV1 {
    fn from_readback(readback: &RuntimeKernelNativeRepairRequestReadbackV1) -> Self {
        let request = readback.request();
        let receipt = readback.receipt();
        Self {
            schema_version: 1,
            request_identity: request.request_identity().to_owned(),
            request_digest: request.request_digest().to_owned(),
            receipt_identity: receipt.receipt_identity().to_owned(),
            receipt_digest: receipt.receipt_digest().to_owned(),
            native_attempt_identity: request.native_attempt_identity().to_owned(),
            correlation_identity: request.correlation_identity().to_owned(),
            action_request_identity: request.action_request_identity().to_owned(),
            decision_identity: request.decision_identity().to_owned(),
            replay_request_identity: request.replay_request_identity.clone(),
            result_identity: request.result_identity().to_owned(),
            replay_attempt_identity: request.replay_attempt_identity.clone(),
            category: request.category(),
            target: request.target(),
            policy_identity: request.repair_policy().policy_identity().to_owned(),
            policy_digest: request.repair_policy().policy_digest().to_owned(),
            clock_head_identity: request.time_evidence().clock_head_identity,
            clock_head_digest: request.time_evidence().clock_head_digest,
        }
    }
}

fn validate_locator(
    composition: &RuntimeKernelNativeRepairCompositionRequestV1,
) -> Result<(), RuntimeKernelNativeRepairPostgresErrorV1> {
    let values = [
        composition.action_request_identity.as_str(),
        composition.decision_identity.as_str(),
        composition.result_identity.as_str(),
        composition.replay_attempt_identity.as_str(),
        composition.replay.request_identity.as_str(),
        composition.replay.meaning_digest.as_str(),
        composition.replay.receipt_identity.as_str(),
        composition.replay.seal_digest.as_str(),
    ];
    if values
        .into_iter()
        .all(|value| !value.is_empty() && value.len() <= 512)
    {
        Ok(())
    } else {
        Err(RuntimeKernelNativeRepairPostgresErrorV1::InvalidLocator)
    }
}

async fn lock_composition_key(
    transaction: &mut Transaction<'_, Postgres>,
    identity: &str,
) -> Result<(), RuntimeKernelNativeRepairPostgresErrorV1> {
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
) -> Result<String, RuntimeKernelNativeRepairPostgresErrorV1> {
    serde_json::to_vec(value)
        .map(|bytes| storage_digest(domain, &bytes))
        .map_err(unavailable)
}

fn current_epoch_ms() -> Result<u64, RuntimeKernelNativeRepairPostgresErrorV1> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(unavailable)
        .and_then(|duration| u64::try_from(duration.as_millis()).map_err(unavailable))
}

fn unavailable(error: impl Display) -> RuntimeKernelNativeRepairPostgresErrorV1 {
    RuntimeKernelNativeRepairPostgresErrorV1::Unavailable(error.to_string())
}

#[cfg(test)]
mod tests {
    use vibe_data::owner::source_binding::BindingDigest;
    #[cfg(feature = "sealed-strategy-input-acceptance")]
    use vibe_data::owner::{
        pit_snapshot::sealed_acceptance::issue_market_data_repair_evidence_v1,
        shared_time_evidence::{ClockHeadSuccessorReadback, SharedTimeEvidenceError},
    };

    use super::*;

    fn composition() -> RuntimeKernelNativeRepairCompositionRequestV1 {
        RuntimeKernelNativeRepairCompositionRequestV1 {
            action_request_identity: "action-1".into(),
            decision_identity: "decision-1".into(),
            result_identity: "result-1".into(),
            replay_attempt_identity: "attempt-1".into(),
            replay: ExploratoryReplayRequestLocatorV2 {
                request_identity: "replay-1".into(),
                meaning_digest: "sha256:11".into(),
                receipt_identity: "receipt-1".into(),
                seal_digest: "sha256:22".into(),
            },
            shared_time_head: UntrustedClockHeadLocator::from_untrusted(
                BindingDigest::from_untrusted_bytes([1; 32]),
                BindingDigest::from_untrusted_bytes([2; 32]),
            ),
        }
    }

    #[test]
    fn composition_accepts_only_complete_bounded_identity_locators() {
        let valid = composition();
        assert!(validate_locator(&valid).is_ok());

        let mut missing = valid.clone();
        missing.replay.seal_digest.clear();
        assert!(matches!(
            validate_locator(&missing),
            Err(RuntimeKernelNativeRepairPostgresErrorV1::InvalidLocator)
        ));

        let mut oversized = valid;
        oversized.result_identity = "x".repeat(513);
        assert!(matches!(
            validate_locator(&oversized),
            Err(RuntimeKernelNativeRepairPostgresErrorV1::InvalidLocator)
        ));
    }

    #[test]
    fn storage_and_outbox_domains_are_separated() {
        let bytes = br#"{"schema_version":1}"#;
        assert_ne!(
            storage_digest("rd.runtime-kernel-native-repair-request.storage.v1", bytes,),
            storage_digest(
                "rd.runtime-kernel-native-repair-request-receipt.storage.v1",
                bytes,
            )
        );
    }

    #[cfg(feature = "sealed-strategy-input-acceptance")]
    struct MismatchedSharedTimeResolver {
        handoff: ClockHeadHandoff,
    }

    #[cfg(feature = "sealed-strategy-input-acceptance")]
    #[async_trait::async_trait]
    impl SharedTimeEvidenceResolver for MismatchedSharedTimeResolver {
        async fn resolve_clock_head(
            &self,
            _locator: &UntrustedClockHeadLocator,
        ) -> Result<ClockHeadHandoff, SharedTimeEvidenceError> {
            Ok(self.handoff.clone())
        }

        async fn resolve_clock_successor(
            &self,
            _prior: &ClockHeadHandoff,
            _successor: &UntrustedClockHeadLocator,
        ) -> Result<ClockHeadSuccessorReadback, SharedTimeEvidenceError> {
            Err(SharedTimeEvidenceError::StoreUnavailable)
        }
    }

    #[cfg(feature = "sealed-strategy-input-acceptance")]
    #[tokio::test]
    async fn resolver_cannot_substitute_a_different_valid_shared_time_head() {
        let evidence =
            issue_market_data_repair_evidence_v1().expect("sealed Shared Time acceptance fixture");
        let resolver = MismatchedSharedTimeResolver {
            handoff: evidence.shared_time(),
        };
        let requested = UntrustedClockHeadLocator::from_untrusted(
            BindingDigest::from_untrusted_bytes([91; 32]),
            BindingDigest::from_untrusted_bytes([92; 32]),
        );

        let error = resolve_exact_shared_time(&resolver, &requested)
            .await
            .expect_err("resolver substitution must fail closed");
        assert!(matches!(
            error,
            RuntimeKernelNativeRepairPostgresErrorV1::Unavailable(message)
                if message == "Shared Time handoff locator mismatch"
        ));
    }

    #[test]
    fn outbox_event_identity_tamper_fails_the_canonical_oracle() {
        let payload_digest = format!("sha256:{}", "a".repeat(64));
        let expected = outbox_event_identity(&payload_digest);
        assert!(verify_outbox_event_identity(&expected, &payload_digest).is_ok());

        let tampered = format!("{expected}-tampered");
        assert!(matches!(
            verify_outbox_event_identity(&tampered, &payload_digest),
            Err(RuntimeKernelNativeRepairPostgresErrorV1::Unavailable(message))
                if message == "native repair request outbox identity mismatch"
        ));
    }

    #[test]
    fn schema_declares_one_write_once_owner_row() {
        let table = &TABLES[0];
        assert_eq!(table.name, "rd_runtime_kernel_native_repair_requests_v1");
        assert!(
            table
                .constraints
                .iter()
                .any(|value| value.starts_with("p:request_identity"))
        );
        for column in [
            "native_attempt_identity",
            "correlation_identity",
            "action_request_identity",
            "decision_identity",
            "result_identity",
            "replay_attempt_identity",
        ] {
            assert!(
                table
                    .indexes
                    .iter()
                    .any(|index| index.keys.contains(column))
            );
        }
    }

    #[tokio::test]
    #[ignore = "requires the canonical disposable R&D Owner PostgreSQL topology"]
    async fn migration_materializes_private_runtime_kernel_request_custody() {
        use vibe_testkit::postgres::{
            CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1,
        };

        let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
            .await
            .expect("canonical disposable topology");
        let mutation = database.mutation();
        let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
        migrate_runtime_kernel_native_repair_request_v1(rd_pool)
            .await
            .expect("Runtime-kernel repair request migration");

        let columns: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='rd_runtime_kernel_native_repair_requests_v1'",
        )
        .fetch_one(rd_pool)
        .await
        .expect("schema readback");
        assert_eq!(
            columns,
            i64::try_from(TABLES[0].columns.len()).expect("column count")
        );

        let unauthorized: bool = sqlx::query_scalar(
            "SELECT has_table_privilege('backtest_owner','public.rd_runtime_kernel_native_repair_requests_v1','SELECT,INSERT,UPDATE,DELETE')",
        )
        .fetch_one(rd_pool)
        .await
        .expect("privilege readback");
        assert!(!unauthorized);
    }
}
