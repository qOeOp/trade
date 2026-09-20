use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::Deserialize;
use sqlx::{Postgres, Transaction};
use vibe_backtest_owner_contracts::{
    ProtectedReplayAttemptFrontierDtoV1, ProtectedReplayAttemptFrontierLocatorV1,
    ProtectedReplayAttemptFrontierOutboxDtoV1, ProtectedReplayAttemptFrontierReceiptDtoV1,
    ProtectedReplayResultDtoV1, ProtectedReplayResultDtoV2, ProtectedReplayResultDtoV3,
    ProtectedResultOutboxDtoV1, ProtectedResultReceiptDtoV1,
    protected_replay_attempt_frontier_custody_wires_v1, protected_result_custody_wires_v1,
    protected_result_custody_wires_v2, protected_result_custody_wires_v3,
};

use crate::BacktestResultCustodyErrorV2;

const RESULT_STORAGE_DOMAIN: &str = "vibe.backtest.protected-replay-result-storage.v1";
const RECEIPT_STORAGE_DOMAIN: &str = "vibe.backtest.protected-result-receipt-storage.v1";
const OUTBOX_STORAGE_DOMAIN: &str = "vibe.backtest.protected-result-outbox-storage.v1";
const FRONTIER_STORAGE_DOMAIN: &str = "vibe.backtest.protected-attempt-frontier-storage.v1";
const FRONTIER_RECEIPT_STORAGE_DOMAIN: &str =
    "vibe.backtest.protected-attempt-frontier-receipt-storage.v1";
const FRONTIER_OUTBOX_STORAGE_DOMAIN: &str =
    "vibe.backtest.protected-attempt-frontier-outbox-storage.v1";
#[allow(
    clippy::needless_raw_string_hashes,
    clippy::needless_raw_strings,
    reason = "the migration-source oracle intentionally preserves the SQL body verbatim"
)]
const FUNCTION_SOURCE: &str = r#"
DECLARE locked jsonb;
BEGIN
  IF session_user <> 'qualification_writer'
     OR current_user <> 'backtest_custodian'
     OR pg_catalog.current_setting('transaction_isolation') <> 'serializable'
  THEN
    RETURN NULL;
  END IF;
  SELECT pg_catalog.jsonb_build_object(
           'schema_version',1,
           'result',pg_catalog.jsonb_build_object(
             'bytes_base64',pg_catalog.replace(pg_catalog.encode(result.canonical_bytes,'base64'),pg_catalog.chr(10),''),
             'storage_digest',result.storage_digest),
           'receipt',pg_catalog.jsonb_build_object(
             'bytes_base64',pg_catalog.replace(pg_catalog.encode(receipt.canonical_bytes,'base64'),pg_catalog.chr(10),''),
             'storage_digest',receipt.storage_digest),
           'outbox',pg_catalog.jsonb_build_object(
             'bytes_base64',pg_catalog.replace(pg_catalog.encode(outbox.canonical_bytes,'base64'),pg_catalog.chr(10),''),
             'storage_digest',outbox.storage_digest)
         ) INTO STRICT locked
    FROM public.backtest_protected_replay_results_v1 result
    JOIN public.backtest_protected_replay_result_receipts_v1 receipt USING(result_identity)
    JOIN public.backtest_protected_replay_result_outbox_v1 outbox USING(result_identity)
   WHERE result.result_identity=p_result_identity
     AND result.request_identity=p_request_identity
     AND result.attempt_identity=p_attempt_identity
     AND receipt.request_identity=result.request_identity
     AND receipt.request_digest=result.request_digest
     AND receipt.result_digest=result.result_digest
     AND outbox.receipt_identity=receipt.receipt_identity
     AND outbox.request_identity=result.request_identity
     AND outbox.request_digest=result.request_digest
     AND outbox.result_digest=result.result_digest
   FOR SHARE OF result,receipt,outbox;
  RETURN locked;
EXCEPTION WHEN no_data_found OR too_many_rows OR data_exception THEN
  RETURN NULL;
END
"#;
#[allow(
    clippy::needless_raw_string_hashes,
    clippy::needless_raw_strings,
    reason = "the migration-source oracle intentionally preserves the SQL body verbatim"
)]
const FRONTIER_FUNCTION_SOURCE: &str = r#"
DECLARE locked jsonb;
BEGIN
  IF session_user <> 'qualification_writer'
     OR current_user <> 'backtest_custodian'
     OR pg_catalog.current_setting('transaction_isolation') <> 'serializable'
  THEN
    RETURN NULL;
  END IF;
  SELECT pg_catalog.jsonb_build_object(
           'schema_version',1,
           'frontier',pg_catalog.jsonb_build_object(
             'bytes_base64',pg_catalog.replace(pg_catalog.encode(frontier.canonical_frontier_bytes,'base64'),pg_catalog.chr(10),''),
             'storage_digest',frontier.storage_digest,
             'mirror',frontier.frontier_json),
           'receipt',pg_catalog.jsonb_build_object(
             'bytes_base64',pg_catalog.replace(pg_catalog.encode(receipt.canonical_bytes,'base64'),pg_catalog.chr(10),''),
             'storage_digest',receipt.storage_digest),
           'outbox',pg_catalog.jsonb_build_object(
             'bytes_base64',pg_catalog.replace(pg_catalog.encode(outbox.canonical_bytes,'base64'),pg_catalog.chr(10),''),
             'storage_digest',outbox.storage_digest)
         ) INTO STRICT locked
    FROM public.backtest_protected_replay_attempt_frontiers_v1 frontier
    JOIN public.backtest_protected_replay_attempt_frontier_receipts_v1 receipt USING(frontier_identity)
    JOIN public.backtest_protected_replay_attempt_frontier_outbox_v1 outbox USING(frontier_identity)
   WHERE frontier.frontier_identity=p_frontier_identity
     AND frontier.frontier_digest=p_frontier_digest
     AND receipt.frontier_digest=frontier.frontier_digest
     AND receipt.request_set_identity=frontier.request_set_identity
     AND receipt.request_set_digest=frontier.request_set_digest
     AND outbox.receipt_identity=receipt.receipt_identity
     AND outbox.frontier_digest=frontier.frontier_digest
     AND outbox.request_set_identity=frontier.request_set_identity
     AND outbox.request_set_digest=frontier.request_set_digest
   FOR SHARE OF frontier,receipt,outbox;
  RETURN locked;
EXCEPTION WHEN no_data_found OR too_many_rows OR data_exception THEN
  RETURN NULL;
END
"#;

#[derive(Debug, Clone, Copy)]
pub struct ProtectedReplayResultLocatorV1<'a> {
    pub result_identity: &'a str,
    pub request_identity: &'a str,
    pub attempt_identity: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LockedProtectedReplayResultV1 {
    result: ProtectedReplayResultDtoV1,
    result_canonical_bytes: Vec<u8>,
    receipt_canonical_bytes: Vec<u8>,
    outbox_canonical_bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LockedProtectedReplayResultV2 {
    result: ProtectedReplayResultDtoV2,
    result_canonical_bytes: Vec<u8>,
    receipt_canonical_bytes: Vec<u8>,
    outbox_canonical_bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LockedProtectedReplayResultV3 {
    result: ProtectedReplayResultDtoV3,
    result_canonical_bytes: Vec<u8>,
    receipt_canonical_bytes: Vec<u8>,
    outbox_canonical_bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LockedProtectedReplayAttemptFrontierV1 {
    frontier: ProtectedReplayAttemptFrontierDtoV1,
    frontier_canonical_bytes: Vec<u8>,
    receipt_canonical_bytes: Vec<u8>,
    outbox_canonical_bytes: Vec<u8>,
}

impl LockedProtectedReplayAttemptFrontierV1 {
    pub const fn frontier(&self) -> &ProtectedReplayAttemptFrontierDtoV1 {
        &self.frontier
    }
    pub fn frontier_canonical_bytes(&self) -> &[u8] {
        &self.frontier_canonical_bytes
    }
    pub fn receipt_canonical_bytes(&self) -> &[u8] {
        &self.receipt_canonical_bytes
    }
    pub fn outbox_canonical_bytes(&self) -> &[u8] {
        &self.outbox_canonical_bytes
    }
}

impl LockedProtectedReplayResultV3 {
    pub const fn result(&self) -> &ProtectedReplayResultDtoV3 {
        &self.result
    }
    pub fn result_canonical_bytes(&self) -> &[u8] {
        &self.result_canonical_bytes
    }
    pub fn receipt_canonical_bytes(&self) -> &[u8] {
        &self.receipt_canonical_bytes
    }
    pub fn outbox_canonical_bytes(&self) -> &[u8] {
        &self.outbox_canonical_bytes
    }
}

impl LockedProtectedReplayResultV2 {
    pub const fn result(&self) -> &ProtectedReplayResultDtoV2 {
        &self.result
    }
    pub fn result_canonical_bytes(&self) -> &[u8] {
        &self.result_canonical_bytes
    }
    pub fn receipt_canonical_bytes(&self) -> &[u8] {
        &self.receipt_canonical_bytes
    }
    pub fn outbox_canonical_bytes(&self) -> &[u8] {
        &self.outbox_canonical_bytes
    }
}

impl LockedProtectedReplayResultV1 {
    pub const fn result(&self) -> &ProtectedReplayResultDtoV1 {
        &self.result
    }
    pub fn result_canonical_bytes(&self) -> &[u8] {
        &self.result_canonical_bytes
    }
    pub fn receipt_canonical_bytes(&self) -> &[u8] {
        &self.receipt_canonical_bytes
    }
    pub fn outbox_canonical_bytes(&self) -> &[u8] {
        &self.outbox_canonical_bytes
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedEnvelopeV1 {
    schema_version: u16,
    result: LockedBytesV1,
    receipt: LockedBytesV1,
    outbox: LockedBytesV1,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedFrontierEnvelopeV1 {
    schema_version: u16,
    frontier: LockedMirroredBytesV1,
    receipt: LockedBytesV1,
    outbox: LockedBytesV1,
}

/// Sealed bytes whose JSON mirror the sealed API also returns; the mirror must decode to exactly
/// the canonical bytes or the readback is unavailable.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedMirroredBytesV1 {
    bytes_base64: String,
    storage_digest: String,
    mirror: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedBytesV1 {
    bytes_base64: String,
    storage_digest: String,
}

pub async fn resolve_protected_replay_result_for_qualification_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: ProtectedReplayResultLocatorV1<'_>,
) -> Result<Option<LockedProtectedReplayResultV1>, BacktestResultCustodyErrorV2> {
    validate_protected_replay_result_reader_topology_v1(transaction).await?;
    let (session_user, current_user, isolation): (String, String, String) = sqlx::query_as(
        "SELECT session_user,current_user,pg_catalog.current_setting('transaction_isolation')",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;

    if session_user != "qualification_writer"
        || current_user != "qualification_writer"
        || isolation != "serializable"
    {
        return Err(BacktestResultCustodyErrorV2::Unavailable);
    }
    let value: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT backtest_owner_api.resolve_protected_replay_result_v1($1,$2,$3)",
    )
    .bind(locator.result_identity)
    .bind(locator.request_identity)
    .bind(locator.attempt_identity)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    let Some(value) = value else { return Ok(None) };
    let envelope: LockedEnvelopeV1 =
        serde_json::from_value(value).map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    if envelope.schema_version != 1 {
        return Err(BacktestResultCustodyErrorV2::Unavailable);
    }
    let result_bytes = decode(&envelope.result, RESULT_STORAGE_DOMAIN)?;
    let receipt_bytes = decode(&envelope.receipt, RECEIPT_STORAGE_DOMAIN)?;
    let outbox_bytes = decode(&envelope.outbox, OUTBOX_STORAGE_DOMAIN)?;
    let result = ProtectedReplayResultDtoV1::from_canonical_bytes(&result_bytes)
        .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    let receipt: ProtectedResultReceiptDtoV1 = serde_json::from_slice(&receipt_bytes)
        .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    let outbox: ProtectedResultOutboxDtoV1 = serde_json::from_slice(&outbox_bytes)
        .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    let (expected_receipt, expected_receipt_bytes, expected_outbox, expected_outbox_bytes) =
        protected_result_custody_wires_v1(&result, receipt.committed_at_epoch_ms)
            .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;

    if result.result_identity != locator.result_identity
        || result.request_identity != locator.request_identity
        || result.attempt_identity != locator.attempt_identity
        || receipt != expected_receipt
        || outbox != expected_outbox
        || receipt_bytes != expected_receipt_bytes
        || outbox_bytes != expected_outbox_bytes
    {
        return Err(BacktestResultCustodyErrorV2::Unavailable);
    }
    Ok(Some(LockedProtectedReplayResultV1 {
        result,
        result_canonical_bytes: result_bytes,
        receipt_canonical_bytes: receipt_bytes,
        outbox_canonical_bytes: outbox_bytes,
    }))
}

pub async fn resolve_protected_replay_result_v2_for_qualification_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: ProtectedReplayResultLocatorV1<'_>,
) -> Result<Option<LockedProtectedReplayResultV2>, BacktestResultCustodyErrorV2> {
    validate_protected_replay_result_reader_topology_v1(transaction).await?;
    let (session_user, current_user, isolation): (String, String, String) = sqlx::query_as(
        "SELECT session_user,current_user,pg_catalog.current_setting('transaction_isolation')",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;

    if session_user != "qualification_writer"
        || current_user != "qualification_writer"
        || isolation != "serializable"
    {
        return Err(BacktestResultCustodyErrorV2::Unavailable);
    }
    let value: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT backtest_owner_api.resolve_protected_replay_result_v1($1,$2,$3)",
    )
    .bind(locator.result_identity)
    .bind(locator.request_identity)
    .bind(locator.attempt_identity)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    let Some(value) = value else { return Ok(None) };
    let envelope: LockedEnvelopeV1 =
        serde_json::from_value(value).map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    if envelope.schema_version != 1 {
        return Err(BacktestResultCustodyErrorV2::Unavailable);
    }
    let result_bytes = decode(&envelope.result, RESULT_STORAGE_DOMAIN)?;
    let receipt_bytes = decode(&envelope.receipt, RECEIPT_STORAGE_DOMAIN)?;
    let outbox_bytes = decode(&envelope.outbox, OUTBOX_STORAGE_DOMAIN)?;
    let result = ProtectedReplayResultDtoV2::from_canonical_bytes(&result_bytes)
        .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    let receipt: ProtectedResultReceiptDtoV1 = serde_json::from_slice(&receipt_bytes)
        .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    let outbox: ProtectedResultOutboxDtoV1 = serde_json::from_slice(&outbox_bytes)
        .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    let (expected_receipt, expected_receipt_bytes, expected_outbox, expected_outbox_bytes) =
        protected_result_custody_wires_v2(&result, receipt.committed_at_epoch_ms)
            .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;

    if result.result_identity != locator.result_identity
        || result.request_identity != locator.request_identity
        || result.attempt_identity != locator.attempt_identity
        || receipt != expected_receipt
        || outbox != expected_outbox
        || receipt_bytes != expected_receipt_bytes
        || outbox_bytes != expected_outbox_bytes
    {
        return Err(BacktestResultCustodyErrorV2::Unavailable);
    }
    Ok(Some(LockedProtectedReplayResultV2 {
        result,
        result_canonical_bytes: result_bytes,
        receipt_canonical_bytes: receipt_bytes,
        outbox_canonical_bytes: outbox_bytes,
    }))
}

pub async fn resolve_protected_replay_result_v3_for_qualification_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: ProtectedReplayResultLocatorV1<'_>,
) -> Result<Option<LockedProtectedReplayResultV3>, BacktestResultCustodyErrorV2> {
    validate_protected_replay_result_reader_topology_v1(transaction).await?;
    let (session_user, current_user, isolation): (String, String, String) = sqlx::query_as(
        "SELECT session_user,current_user,pg_catalog.current_setting('transaction_isolation')",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;

    if session_user != "qualification_writer"
        || current_user != "qualification_writer"
        || isolation != "serializable"
    {
        return Err(BacktestResultCustodyErrorV2::Unavailable);
    }
    let value: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT backtest_owner_api.resolve_protected_replay_result_v1($1,$2,$3)",
    )
    .bind(locator.result_identity)
    .bind(locator.request_identity)
    .bind(locator.attempt_identity)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    let Some(value) = value else { return Ok(None) };
    let envelope: LockedEnvelopeV1 =
        serde_json::from_value(value).map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    if envelope.schema_version != 1 {
        return Err(BacktestResultCustodyErrorV2::Unavailable);
    }
    let result_bytes = decode(&envelope.result, RESULT_STORAGE_DOMAIN)?;
    let receipt_bytes = decode(&envelope.receipt, RECEIPT_STORAGE_DOMAIN)?;
    let outbox_bytes = decode(&envelope.outbox, OUTBOX_STORAGE_DOMAIN)?;
    let result = ProtectedReplayResultDtoV3::from_canonical_bytes(&result_bytes)
        .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    let receipt: ProtectedResultReceiptDtoV1 = serde_json::from_slice(&receipt_bytes)
        .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    let outbox: ProtectedResultOutboxDtoV1 = serde_json::from_slice(&outbox_bytes)
        .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    let (expected_receipt, expected_receipt_bytes, expected_outbox, expected_outbox_bytes) =
        protected_result_custody_wires_v3(&result, receipt.committed_at_epoch_ms)
            .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;

    if result.result_identity != locator.result_identity
        || result.request_identity != locator.request_identity
        || result.attempt_identity != locator.attempt_identity
        || receipt != expected_receipt
        || outbox != expected_outbox
        || receipt_bytes != expected_receipt_bytes
        || outbox_bytes != expected_outbox_bytes
    {
        return Err(BacktestResultCustodyErrorV2::Unavailable);
    }
    Ok(Some(LockedProtectedReplayResultV3 {
        result,
        result_canonical_bytes: result_bytes,
        receipt_canonical_bytes: receipt_bytes,
        outbox_canonical_bytes: outbox_bytes,
    }))
}

pub async fn resolve_protected_replay_attempt_frontier_for_qualification_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &ProtectedReplayAttemptFrontierLocatorV1,
) -> Result<Option<LockedProtectedReplayAttemptFrontierV1>, BacktestResultCustodyErrorV2> {
    validate_protected_replay_result_reader_topology_v1(transaction).await?;
    let (session_user, current_user, isolation): (String, String, String) = sqlx::query_as(
        "SELECT session_user,current_user,pg_catalog.current_setting('transaction_isolation')",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;

    if session_user != "qualification_writer"
        || current_user != "qualification_writer"
        || isolation != "serializable"
    {
        return Err(BacktestResultCustodyErrorV2::Unavailable);
    }
    let value: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT backtest_owner_api.resolve_protected_replay_attempt_frontier_v1($1,$2)",
    )
    .bind(&locator.frontier_identity)
    .bind(&locator.frontier_digest)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    let Some(value) = value else { return Ok(None) };
    let envelope: LockedFrontierEnvelopeV1 =
        serde_json::from_value(value).map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    if envelope.schema_version != 1 {
        return Err(BacktestResultCustodyErrorV2::Unavailable);
    }
    let frontier_bytes = decode_mirrored(&envelope.frontier, FRONTIER_STORAGE_DOMAIN)?;
    let receipt_bytes = decode(&envelope.receipt, FRONTIER_RECEIPT_STORAGE_DOMAIN)?;
    let outbox_bytes = decode(&envelope.outbox, FRONTIER_OUTBOX_STORAGE_DOMAIN)?;
    let frontier = ProtectedReplayAttemptFrontierDtoV1::from_canonical_bytes(&frontier_bytes)
        .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    let receipt: ProtectedReplayAttemptFrontierReceiptDtoV1 =
        serde_json::from_slice(&receipt_bytes)
            .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    let outbox: ProtectedReplayAttemptFrontierOutboxDtoV1 =
        serde_json::from_slice(&outbox_bytes)
            .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    let (expected_receipt, expected_receipt_bytes, expected_outbox, expected_outbox_bytes) =
        protected_replay_attempt_frontier_custody_wires_v1(
            &frontier,
            receipt.committed_at_epoch_ms,
        )
        .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;

    if frontier.frontier_identity != locator.frontier_identity
        || frontier.frontier_digest != locator.frontier_digest
        || receipt.receipt_identity != locator.receipt_identity
        || receipt.receipt_digest != locator.receipt_digest
        || receipt != expected_receipt
        || outbox != expected_outbox
        || receipt_bytes != expected_receipt_bytes
        || outbox_bytes != expected_outbox_bytes
    {
        return Err(BacktestResultCustodyErrorV2::Unavailable);
    }
    Ok(Some(LockedProtectedReplayAttemptFrontierV1 {
        frontier,
        frontier_canonical_bytes: frontier_bytes,
        receipt_canonical_bytes: receipt_bytes,
        outbox_canonical_bytes: outbox_bytes,
    }))
}

pub async fn validate_protected_replay_result_writer_topology_v1(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), BacktestResultCustodyErrorV2> {
    super::acquire_topology_fence(transaction).await?;
    sqlx::query(
        "LOCK TABLE public.backtest_protected_replay_results_v1, public.backtest_protected_replay_result_receipts_v1, public.backtest_protected_replay_result_outbox_v1, public.backtest_protected_replay_attempt_frontiers_v1, public.backtest_protected_replay_attempt_frontier_receipts_v1, public.backtest_protected_replay_attempt_frontier_outbox_v1 IN ROW EXCLUSIVE MODE",
    )
    .execute(&mut **transaction)
    .await
    .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    validate_protected_topology(transaction, "backtest_owner").await
}

pub async fn validate_protected_replay_result_reader_topology_v1(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), BacktestResultCustodyErrorV2> {
    super::acquire_topology_fence(transaction).await?;
    validate_protected_topology(transaction, "qualification_writer").await
}

async fn validate_protected_topology(
    transaction: &mut Transaction<'_, Postgres>,
    expected_principal: &str,
) -> Result<(), BacktestResultCustodyErrorV2> {
    let exact: bool = sqlx::query_scalar(
        "WITH expected_function AS (
           SELECT procedure.oid
             FROM pg_catalog.pg_proc procedure
             JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace
            WHERE namespace.nspname='backtest_owner_api'
              AND procedure.proname='resolve_protected_replay_result_v1'
              AND procedure.proargtypes=ARRAY['pg_catalog.text'::pg_catalog.regtype,'pg_catalog.text'::pg_catalog.regtype,'pg_catalog.text'::pg_catalog.regtype]::pg_catalog.oidvector
         ), frontier_function AS (
           SELECT procedure.oid
             FROM pg_catalog.pg_proc procedure
             JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace
            WHERE namespace.nspname='backtest_owner_api'
              AND procedure.proname='resolve_protected_replay_attempt_frontier_v1'
              AND procedure.proargtypes=ARRAY['pg_catalog.text'::pg_catalog.regtype,'pg_catalog.text'::pg_catalog.regtype]::pg_catalog.oidvector
         )
         SELECT session_user=$2 AND current_user=$2
           AND (SELECT count(*)=1 AND bool_and(pg_catalog.pg_get_userbyid(procedure.proowner)='backtest_custodian' AND language.lanname='plpgsql' AND procedure.prokind='f' AND NOT procedure.proleakproof AND procedure.prorettype='jsonb'::pg_catalog.regtype AND procedure.pronargs=3 AND procedure.prosecdef AND procedure.proisstrict AND procedure.provolatile='v' AND procedure.proparallel='u' AND procedure.proconfig=ARRAY['search_path=pg_catalog']::text[] AND procedure.prosrc=$1) FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_language language ON language.oid=procedure.prolang WHERE procedure.oid=(SELECT oid FROM expected_function))
           AND (SELECT count(*)=4 FROM pg_catalog.pg_proc sibling JOIN pg_catalog.pg_namespace sibling_namespace ON sibling_namespace.oid=sibling.pronamespace WHERE sibling_namespace.nspname='backtest_owner_api')
           AND (SELECT count(*)=1 AND bool_and(pg_catalog.pg_get_userbyid(procedure.proowner)='backtest_custodian' AND language.lanname='plpgsql' AND procedure.prokind='f' AND NOT procedure.proleakproof AND procedure.prorettype='jsonb'::pg_catalog.regtype AND procedure.pronargs=2 AND procedure.prosecdef AND procedure.proisstrict AND procedure.provolatile='v' AND procedure.proparallel='u' AND procedure.proconfig=ARRAY['search_path=pg_catalog']::text[] AND procedure.prosrc=$3) FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_language language ON language.oid=procedure.prolang WHERE procedure.oid=(SELECT oid FROM frontier_function))
           AND (SELECT count(*)=2 AND bool_and(role.rolname IN ('rd_owner','qualification_writer') AND acl.privilege_type='USAGE' AND NOT acl.is_grantable AND pg_catalog.pg_get_userbyid(acl.grantor)='backtest_custodian') FROM pg_catalog.pg_namespace protected_namespace CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(protected_namespace.nspacl,pg_catalog.acldefault('n',protected_namespace.nspowner))) acl LEFT JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee WHERE protected_namespace.nspname='backtest_owner_api' AND acl.grantee<>protected_namespace.nspowner)
           AND (SELECT count(*)=1 AND bool_and(role.rolname='qualification_writer' AND acl.privilege_type='EXECUTE' AND NOT acl.is_grantable AND pg_catalog.pg_get_userbyid(acl.grantor)='backtest_custodian') FROM pg_catalog.pg_proc procedure CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(procedure.proacl,pg_catalog.acldefault('f',procedure.proowner))) acl LEFT JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee WHERE procedure.oid=(SELECT oid FROM expected_function) AND acl.grantee<>procedure.proowner)
           AND (SELECT count(*)=1 AND bool_and(role.rolname='qualification_writer' AND acl.privilege_type='EXECUTE' AND NOT acl.is_grantable AND pg_catalog.pg_get_userbyid(acl.grantor)='backtest_custodian') FROM pg_catalog.pg_proc procedure CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(procedure.proacl,pg_catalog.acldefault('f',procedure.proowner))) acl LEFT JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee WHERE procedure.oid=(SELECT oid FROM frontier_function) AND acl.grantee<>procedure.proowner)
           AND (SELECT count(*)=6 AND bool_and(pg_catalog.pg_get_userbyid(relation.relowner)='backtest_custodian' AND relation.relkind='r' AND relation.relpersistence='p' AND NOT relation.relrowsecurity AND NOT relation.relforcerowsecurity) FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace relation_namespace ON relation_namespace.oid=relation.relnamespace WHERE relation_namespace.nspname='public' AND relation.relname IN ('backtest_protected_replay_results_v1','backtest_protected_replay_result_receipts_v1','backtest_protected_replay_result_outbox_v1','backtest_protected_replay_attempt_frontiers_v1','backtest_protected_replay_attempt_frontier_receipts_v1','backtest_protected_replay_attempt_frontier_outbox_v1'))
           AND (SELECT count(*)=12 AND bool_and(role.rolname='backtest_owner' AND acl.privilege_type IN ('SELECT','INSERT') AND NOT acl.is_grantable AND pg_catalog.pg_get_userbyid(acl.grantor)='backtest_custodian') FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace relation_namespace ON relation_namespace.oid=relation.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(relation.relacl,pg_catalog.acldefault('r',relation.relowner))) acl LEFT JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee WHERE relation_namespace.nspname='public' AND relation.relname IN ('backtest_protected_replay_results_v1','backtest_protected_replay_result_receipts_v1','backtest_protected_replay_result_outbox_v1','backtest_protected_replay_attempt_frontiers_v1','backtest_protected_replay_attempt_frontier_receipts_v1','backtest_protected_replay_attempt_frontier_outbox_v1') AND acl.grantee<>relation.relowner)
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members membership WHERE membership.roleid IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('backtest_custodian','backtest_owner','rd_owner','qualification_writer')) OR membership.member IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('backtest_custodian','backtest_owner','rd_owner','qualification_writer')))
           AND pg_catalog.has_schema_privilege('qualification_writer','backtest_owner_api','USAGE')
           AND NOT pg_catalog.has_schema_privilege('qualification_writer','backtest_owner_api','CREATE')
           AND pg_catalog.has_function_privilege('qualification_writer',(SELECT oid FROM expected_function),'EXECUTE')
           AND pg_catalog.has_function_privilege('qualification_writer',(SELECT oid FROM frontier_function),'EXECUTE')
           AND NOT pg_catalog.has_function_privilege('rd_owner',(SELECT oid FROM expected_function),'EXECUTE')
           AND NOT pg_catalog.has_function_privilege('backtest_owner',(SELECT oid FROM expected_function),'EXECUTE')
           AND NOT pg_catalog.has_table_privilege('qualification_writer','public.backtest_protected_replay_results_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           AND NOT pg_catalog.has_table_privilege('qualification_writer','public.backtest_protected_replay_result_receipts_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           AND NOT pg_catalog.has_table_privilege('qualification_writer','public.backtest_protected_replay_result_outbox_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           AND NOT pg_catalog.has_table_privilege('qualification_writer','public.backtest_protected_replay_attempt_frontiers_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           AND NOT pg_catalog.has_table_privilege('qualification_writer','public.backtest_protected_replay_attempt_frontier_receipts_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           AND NOT pg_catalog.has_table_privilege('qualification_writer','public.backtest_protected_replay_attempt_frontier_outbox_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           AND NOT pg_catalog.has_table_privilege('rd_owner','public.backtest_protected_replay_results_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           AND NOT pg_catalog.has_table_privilege('backtest_owner','public.backtest_protected_replay_results_v1','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute attribute CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) acl WHERE attribute.attrelid IN ('public.backtest_protected_replay_results_v1'::pg_catalog.regclass,'public.backtest_protected_replay_result_receipts_v1'::pg_catalog.regclass,'public.backtest_protected_replay_result_outbox_v1'::pg_catalog.regclass,'public.backtest_protected_replay_attempt_frontiers_v1'::pg_catalog.regclass,'public.backtest_protected_replay_attempt_frontier_receipts_v1'::pg_catalog.regclass,'public.backtest_protected_replay_attempt_frontier_outbox_v1'::pg_catalog.regclass) AND attribute.attnum>0 AND NOT attribute.attisdropped)
        ",
    )
    .bind(FUNCTION_SOURCE)
    .bind(expected_principal)
    .bind(FRONTIER_FUNCTION_SOURCE)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    if !exact {
        return Err(BacktestResultCustodyErrorV2::Unavailable);
    }
    Ok(())
}

fn decode(value: &LockedBytesV1, domain: &str) -> Result<Vec<u8>, BacktestResultCustodyErrorV2> {
    let bytes = STANDARD
        .decode(&value.bytes_base64)
        .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    if digest(domain, &bytes) != value.storage_digest {
        return Err(BacktestResultCustodyErrorV2::Unavailable);
    }
    Ok(bytes)
}

fn decode_mirrored(
    value: &LockedMirroredBytesV1,
    domain: &str,
) -> Result<Vec<u8>, BacktestResultCustodyErrorV2> {
    let bytes = decode(
        &LockedBytesV1 {
            bytes_base64: value.bytes_base64.clone(),
            storage_digest: value.storage_digest.clone(),
        },
        domain,
    )?;

    if serde_json::from_slice::<serde_json::Value>(&bytes)
        .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?
        != value.mirror
    {
        return Err(BacktestResultCustodyErrorV2::Unavailable);
    }
    Ok(bytes)
}

fn digest(domain: &str, bytes: &[u8]) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain.as_bytes());
    hasher.update(&[0]);
    hasher.update(bytes);
    format!("blake3:{}", hasher.finalize().to_hex())
}
