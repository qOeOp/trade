//! Atomic PostgreSQL persistence for Backtest-owned Replay V2 results.
//!
//! This module assumes an independently admitted, pre-existing topology. It performs no DDL and
//! does not install or validate the future R&D `SECURITY DEFINER` read facade.

use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};
use thiserror::Error;
use vibe_backtest_owner_contracts::ReplayResultDtoV2;

use crate::{
    CanonicalDigestV2, OpaqueIdentityV2, ReplayNamespaceV2, ReplayTerminalV2,
    SealedReplayResultV2,
};

const RESULT_STORAGE_DOMAIN: &str = "vibe.backtest.replay-result-storage.v2";
const RECEIPT_STORAGE_DOMAIN: &str = "vibe.backtest.result-receipt-storage.v1";
const OUTBOX_STORAGE_DOMAIN: &str = "vibe.backtest.result-outbox-storage.v1";
const RECEIPT_DIGEST_DOMAIN: &str = "vibe.backtest.result-receipt.v1";
const OUTBOX_PAYLOAD_DIGEST_DOMAIN: &str = "vibe.backtest.result-outbox-payload.v1";
const OUTBOX_EVENT_DIGEST_DOMAIN: &str = "vibe.backtest.result-outbox-event.v1";
const EVENT_KIND: &str = "EXPLORATORY_BACKTEST_RESULT_COMMITTED_V1";

const READ_AGGREGATE: &str = r#"
SELECT result.result_identity,result.result_digest,result.request_identity,
       result.request_meaning_digest,result.attempt_identity,result.terminal,
       result.canonical_bytes,result.canonical_bytes_blake3,
       receipt.receipt_identity,receipt.receipt_digest,
       receipt.request_identity AS receipt_request_identity,
       receipt.request_meaning_digest AS receipt_request_meaning_digest,
       receipt.result_digest AS receipt_result_digest,receipt.namespace AS receipt_namespace,
       receipt.outbox_event_identity,receipt.committed_at_epoch_ms AS receipt_committed_at_epoch_ms,
       receipt.canonical_bytes AS receipt_canonical_bytes,
       receipt.canonical_bytes_blake3 AS receipt_canonical_bytes_blake3,
       outbox.event_identity,outbox.event_digest,outbox.receipt_identity AS outbox_receipt_identity,
       outbox.request_identity AS outbox_request_identity,
       outbox.request_meaning_digest AS outbox_request_meaning_digest,
       outbox.result_digest AS outbox_result_digest,outbox.namespace AS outbox_namespace,
       outbox.payload_digest,outbox.committed_at_epoch_ms AS outbox_committed_at_epoch_ms,
       outbox.canonical_bytes AS outbox_canonical_bytes,
       outbox.canonical_bytes_blake3 AS outbox_canonical_bytes_blake3
FROM public.backtest_replay_results_v2 result
LEFT JOIN public.backtest_replay_result_receipts_v1 receipt USING(result_identity)
LEFT JOIN public.backtest_replay_result_outbox_v1 outbox USING(result_identity)
"#;

/// A complete, integrity-checked Result/receipt/outbox aggregate read by Backtest Owner.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplayResultReadbackV2 {
    result: ReplayResultDtoV2,
    result_canonical_bytes: Vec<u8>,
    receipt_canonical_bytes: Vec<u8>,
    outbox_canonical_bytes: Vec<u8>,
}

impl ReplayResultReadbackV2 {
    /// Returns the validated but still forgeable Result wire.
    #[must_use]
    pub const fn result(&self) -> &ReplayResultDtoV2 {
        &self.result
    }

    /// Returns the exact persisted Result bytes.
    #[must_use]
    pub fn result_canonical_bytes(&self) -> &[u8] {
        &self.result_canonical_bytes
    }

    /// Returns the exact persisted Backtest receipt bytes.
    #[must_use]
    pub fn receipt_canonical_bytes(&self) -> &[u8] {
        &self.receipt_canonical_bytes
    }

    /// Returns the exact persisted Backtest outbox bytes.
    #[must_use]
    pub fn outbox_canonical_bytes(&self) -> &[u8] {
        &self.outbox_canonical_bytes
    }
}

/// Fail-closed errors from canonical Backtest Result persistence.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum PostgresReplayResultOwnerErrorV2 {
    #[error("canonical backtest_owner PostgreSQL custody is unavailable")]
    CustodyUnavailable,
    #[error("only sealed exploratory terminal Replay V2 results are admitted")]
    ResultNotAdmitted,
    #[error("the Replay V2 identity or attempt is already bound to different bytes")]
    ConflictingResult,
    #[error("Backtest Replay V2 persistence is unavailable")]
    StorageUnavailable,
    #[error("the persisted Replay V2 aggregate failed integrity validation")]
    CorruptReadback,
}

/// The Backtest-owned writer over an independently admitted PostgreSQL topology.
#[derive(Debug, Clone)]
pub struct PostgresReplayResultOwnerV2 {
    pool: PgPool,
}

impl PostgresReplayResultOwnerV2 {
    /// Adopts a pre-existing admitted pool after verifying its exact session principal.
    ///
    /// This does not admit table shape, ACLs, or the future R&D read function. Those remain a
    /// separate topology acceptance concern and this constructor performs no repair or DDL.
    ///
    /// # Errors
    ///
    /// Returns an error unless both `session_user` and `current_user` are `backtest_owner`.
    pub async fn from_admitted_pool(
        pool: PgPool,
    ) -> Result<Self, PostgresReplayResultOwnerErrorV2> {
        validate_pool_principal(&pool).await?;
        Ok(Self { pool })
    }

    /// Atomically commits one sealed exploratory Result, receipt, and outbox event.
    ///
    /// A byte-identical retry joins the existing aggregate. The same Result identity or replay
    /// attempt with different bytes fails without modifying the existing rows.
    ///
    /// # Errors
    ///
    /// Returns an error for non-exploratory/non-terminal input, custody drift, conflicts, storage
    /// failure, or an integrity-invalid readback.
    pub async fn commit_exploratory_replay_result_v2(
        &self,
        result: &SealedReplayResultV2,
    ) -> Result<ReplayResultReadbackV2, PostgresReplayResultOwnerErrorV2> {
        let result_bytes = result
            .to_canonical_bytes()
            .map_err(|_| PostgresReplayResultOwnerErrorV2::ResultNotAdmitted)?;
        let result_dto = ReplayResultDtoV2::from_canonical_bytes(&result_bytes)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::ResultNotAdmitted)?;
        validate_sealed_result(result, &result_dto)?;

        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        validate_transaction_principal(&mut transaction).await?;
        lock_attempt(&mut transaction, &result_dto).await?;

        let existing = read_matching_aggregate(&mut transaction, &result_dto).await?;
        if let Some(readback) = existing {
            return finish_existing(transaction, readback, &result_dto, &result_bytes).await;
        }

        let result_storage_digest = storage_digest(RESULT_STORAGE_DOMAIN, &result_bytes);
        let inserted = sqlx::query(
            "INSERT INTO public.backtest_replay_results_v2(result_identity,result_digest,request_identity,request_meaning_digest,attempt_identity,terminal,canonical_bytes,canonical_bytes_blake3) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING",
        )
        .bind(result_dto.result_identity.as_str())
        .bind(result_dto.result_digest.as_str())
        .bind(result_dto.request_identity.as_str())
        .bind(result_dto.request_meaning_digest.as_str())
        .bind(result_dto.attempt_identity.as_str())
        .bind(terminal_text(result_dto.terminal))
        .bind(&result_bytes)
        .bind(&result_storage_digest)
        .execute(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;

        if inserted.rows_affected() == 0 {
            let existing = read_matching_aggregate(&mut transaction, &result_dto)
                .await?
                .ok_or(PostgresReplayResultOwnerErrorV2::ConflictingResult)?;
            return finish_existing(transaction, existing, &result_dto, &result_bytes).await;
        }

        let committed_at_epoch_ms: i64 = sqlx::query_scalar(
            "SELECT (pg_catalog.extract(epoch FROM transaction_timestamp())*1000)::bigint",
        )
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        let committed_at_epoch_ms = u64::try_from(committed_at_epoch_ms)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        let (receipt, receipt_bytes, outbox, outbox_bytes) =
            build_custody_wires(&result_dto, committed_at_epoch_ms)?;

        sqlx::query(
            "INSERT INTO public.backtest_replay_result_receipts_v1(result_identity,receipt_identity,receipt_digest,request_identity,request_meaning_digest,result_digest,namespace,outbox_event_identity,committed_at_epoch_ms,canonical_bytes,canonical_bytes_blake3) VALUES($1,$2,$3,$4,$5,$6,'EXPLORATORY',$7,$8,$9,$10)",
        )
        .bind(result_dto.result_identity.as_str())
        .bind(receipt.receipt_identity.as_str())
        .bind(receipt.receipt_digest.as_str())
        .bind(result_dto.request_identity.as_str())
        .bind(result_dto.request_meaning_digest.as_str())
        .bind(result_dto.result_digest.as_str())
        .bind(receipt.outbox_event_identity.as_str())
        .bind(i64::try_from(committed_at_epoch_ms).map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?)
        .bind(&receipt_bytes)
        .bind(storage_digest(RECEIPT_STORAGE_DOMAIN, &receipt_bytes))
        .execute(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;

        sqlx::query(
            "INSERT INTO public.backtest_replay_result_outbox_v1(result_identity,event_identity,event_digest,receipt_identity,request_identity,request_meaning_digest,result_digest,namespace,payload_digest,committed_at_epoch_ms,canonical_bytes,canonical_bytes_blake3) VALUES($1,$2,$3,$4,$5,$6,$7,'EXPLORATORY',$8,$9,$10,$11)",
        )
        .bind(result_dto.result_identity.as_str())
        .bind(outbox.event_identity.as_str())
        .bind(outbox.event_digest.as_str())
        .bind(receipt.receipt_identity.as_str())
        .bind(result_dto.request_identity.as_str())
        .bind(result_dto.request_meaning_digest.as_str())
        .bind(result_dto.result_digest.as_str())
        .bind(outbox.payload_digest.as_str())
        .bind(i64::try_from(committed_at_epoch_ms).map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?)
        .bind(&outbox_bytes)
        .bind(storage_digest(OUTBOX_STORAGE_DOMAIN, &outbox_bytes))
        .execute(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;

        let readback = read_matching_aggregate(&mut transaction, &result_dto)
            .await?
            .ok_or(PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
        if readback.result != result_dto || readback.result_canonical_bytes != result_bytes {
            return Err(PostgresReplayResultOwnerErrorV2::CorruptReadback);
        }
        validate_transaction_principal(&mut transaction).await?;
        transaction
            .commit()
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        Ok(readback)
    }

    /// Resolves an existing aggregate through the exact Backtest Owner session only.
    ///
    /// This method never creates, repairs, or recomposes custody.
    ///
    /// # Errors
    ///
    /// Returns an error for custody drift, storage failure, or incomplete/corrupt correlation.
    pub async fn resolve_existing_result_v2(
        &self,
        result_identity: &OpaqueIdentityV2,
    ) -> Result<Option<ReplayResultReadbackV2>, PostgresReplayResultOwnerErrorV2> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        validate_transaction_principal(&mut transaction).await?;
        let query = format!("{READ_AGGREGATE} WHERE result.result_identity=$1 FOR UPDATE OF result");
        let row = sqlx::query(sqlx::AssertSqlSafe(query))
            .bind(result_identity.as_str())
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        let readback = row.as_ref().map(decode_aggregate).transpose()?;
        validate_transaction_principal(&mut transaction).await?;
        transaction
            .commit()
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        Ok(readback)
    }
}

async fn validate_pool_principal(
    pool: &PgPool,
) -> Result<(), PostgresReplayResultOwnerErrorV2> {
    let principals: (String, String) = sqlx::query_as("SELECT session_user,current_user")
        .fetch_one(pool)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CustodyUnavailable)?;
    validate_principals(&principals)
}

async fn validate_transaction_principal(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), PostgresReplayResultOwnerErrorV2> {
    let principals: (String, String) = sqlx::query_as("SELECT session_user,current_user")
        .fetch_one(&mut **transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CustodyUnavailable)?;
    validate_principals(&principals)
}

fn validate_principals(
    (session_user, current_user): &(String, String),
) -> Result<(), PostgresReplayResultOwnerErrorV2> {
    if session_user == "backtest_owner" && current_user == "backtest_owner" {
        Ok(())
    } else {
        Err(PostgresReplayResultOwnerErrorV2::CustodyUnavailable)
    }
}

fn validate_sealed_result(
    sealed: &SealedReplayResultV2,
    dto: &ReplayResultDtoV2,
) -> Result<(), PostgresReplayResultOwnerErrorV2> {
    if sealed.namespace() != ReplayNamespaceV2::Exploratory
        || dto.namespace != ReplayNamespaceV2::Exploratory
        || sealed.terminal() == ReplayTerminalV2::InProgressOrUnknown
        || dto.terminal == ReplayTerminalV2::InProgressOrUnknown
        || sealed.result_identity() != &dto.result_identity
        || sealed.result_digest() != &dto.result_digest
        || sealed.request_identity() != &dto.request_identity
        || sealed.request_meaning_digest() != &dto.request_meaning_digest
        || sealed.attempt_identity() != &dto.attempt_identity
        || sealed.terminal() != dto.terminal
    {
        return Err(PostgresReplayResultOwnerErrorV2::ResultNotAdmitted);
    }
    Ok(())
}

async fn lock_attempt(
    transaction: &mut Transaction<'_, Postgres>,
    result: &ReplayResultDtoV2,
) -> Result<(), PostgresReplayResultOwnerErrorV2> {
    let lock_key = format!(
        "vibe.backtest.replay-result-attempt.v2\0{}\0{}",
        result.request_identity.as_str(),
        result.attempt_identity.as_str()
    );
    sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))")
        .bind(lock_key)
        .execute(&mut **transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
    Ok(())
}

async fn read_matching_aggregate(
    transaction: &mut Transaction<'_, Postgres>,
    result: &ReplayResultDtoV2,
) -> Result<Option<ReplayResultReadbackV2>, PostgresReplayResultOwnerErrorV2> {
    let query = format!(
        "{READ_AGGREGATE} WHERE result.result_identity=$1 OR (result.request_identity=$2 AND result.attempt_identity=$3) FOR UPDATE OF result"
    );
    let rows = sqlx::query(sqlx::AssertSqlSafe(query))
        .bind(result.result_identity.as_str())
        .bind(result.request_identity.as_str())
        .bind(result.attempt_identity.as_str())
        .fetch_all(&mut **transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
    if rows.len() > 1 {
        return Err(PostgresReplayResultOwnerErrorV2::ConflictingResult);
    }
    rows.first().map(decode_aggregate).transpose()
}

async fn finish_existing(
    mut transaction: Transaction<'_, Postgres>,
    readback: ReplayResultReadbackV2,
    expected: &ReplayResultDtoV2,
    expected_bytes: &[u8],
) -> Result<ReplayResultReadbackV2, PostgresReplayResultOwnerErrorV2> {
    if &readback.result != expected || readback.result_canonical_bytes != expected_bytes {
        return Err(PostgresReplayResultOwnerErrorV2::ConflictingResult);
    }
    validate_transaction_principal(&mut transaction).await?;
    transaction
        .commit()
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
    Ok(readback)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ResultReceiptV1 {
    schema_version: u16,
    receipt_identity: OpaqueIdentityV2,
    receipt_digest: CanonicalDigestV2,
    request_identity: OpaqueIdentityV2,
    request_meaning_digest: CanonicalDigestV2,
    result_identity: OpaqueIdentityV2,
    result_digest: CanonicalDigestV2,
    namespace: ReplayNamespaceV2,
    outbox_event_identity: OpaqueIdentityV2,
    committed_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct ResultReceiptPreimageV1<'a> {
    schema_version: u16,
    receipt_identity: &'a OpaqueIdentityV2,
    request_identity: &'a OpaqueIdentityV2,
    request_meaning_digest: &'a CanonicalDigestV2,
    result_identity: &'a OpaqueIdentityV2,
    result_digest: &'a CanonicalDigestV2,
    namespace: ReplayNamespaceV2,
    outbox_event_identity: &'a OpaqueIdentityV2,
    committed_at_epoch_ms: u64,
}

impl ResultReceiptV1 {
    fn expected_digest(
        &self,
    ) -> Result<CanonicalDigestV2, PostgresReplayResultOwnerErrorV2> {
        digest_value(
            RECEIPT_DIGEST_DOMAIN,
            &ResultReceiptPreimageV1 {
                schema_version: self.schema_version,
                receipt_identity: &self.receipt_identity,
                request_identity: &self.request_identity,
                request_meaning_digest: &self.request_meaning_digest,
                result_identity: &self.result_identity,
                result_digest: &self.result_digest,
                namespace: self.namespace,
                outbox_event_identity: &self.outbox_event_identity,
                committed_at_epoch_ms: self.committed_at_epoch_ms,
            },
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ResultOutboxPayloadV1 {
    schema_version: u16,
    receipt_identity: OpaqueIdentityV2,
    receipt_digest: CanonicalDigestV2,
    request_identity: OpaqueIdentityV2,
    request_meaning_digest: CanonicalDigestV2,
    result_identity: OpaqueIdentityV2,
    result_digest: CanonicalDigestV2,
    namespace: ReplayNamespaceV2,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ResultOutboxV1 {
    schema_version: u16,
    event_identity: OpaqueIdentityV2,
    event_digest: CanonicalDigestV2,
    aggregate_identity: OpaqueIdentityV2,
    event_kind: OpaqueIdentityV2,
    payload_digest: CanonicalDigestV2,
    payload: ResultOutboxPayloadV1,
    committed_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct ResultOutboxPreimageV1<'a> {
    schema_version: u16,
    event_identity: &'a OpaqueIdentityV2,
    aggregate_identity: &'a OpaqueIdentityV2,
    event_kind: &'a OpaqueIdentityV2,
    payload_digest: &'a CanonicalDigestV2,
    payload: &'a ResultOutboxPayloadV1,
    committed_at_epoch_ms: u64,
}

impl ResultOutboxV1 {
    fn expected_payload_digest(
        &self,
    ) -> Result<CanonicalDigestV2, PostgresReplayResultOwnerErrorV2> {
        digest_value(OUTBOX_PAYLOAD_DIGEST_DOMAIN, &self.payload)
    }

    fn expected_event_digest(
        &self,
    ) -> Result<CanonicalDigestV2, PostgresReplayResultOwnerErrorV2> {
        digest_value(
            OUTBOX_EVENT_DIGEST_DOMAIN,
            &ResultOutboxPreimageV1 {
                schema_version: self.schema_version,
                event_identity: &self.event_identity,
                aggregate_identity: &self.aggregate_identity,
                event_kind: &self.event_kind,
                payload_digest: &self.payload_digest,
                payload: &self.payload,
                committed_at_epoch_ms: self.committed_at_epoch_ms,
            },
        )
    }
}

fn build_custody_wires(
    result: &ReplayResultDtoV2,
    committed_at_epoch_ms: u64,
) -> Result<
    (ResultReceiptV1, Vec<u8>, ResultOutboxV1, Vec<u8>),
    PostgresReplayResultOwnerErrorV2,
> {
    let suffix = result
        .result_digest
        .as_str()
        .strip_prefix("blake3:")
        .ok_or(PostgresReplayResultOwnerErrorV2::ResultNotAdmitted)?;
    let receipt_identity = typed_identity(format!("backtest-result-receipt-v1-{suffix}"))?;
    let event_identity = typed_identity(format!("backtest-result-outbox-v1-{suffix}"))?;
    let placeholder = typed_digest(format!("blake3:{}", "0".repeat(64)))?;
    let mut receipt = ResultReceiptV1 {
        schema_version: 1,
        receipt_identity: receipt_identity.clone(),
        receipt_digest: placeholder.clone(),
        request_identity: result.request_identity.clone(),
        request_meaning_digest: result.request_meaning_digest.clone(),
        result_identity: result.result_identity.clone(),
        result_digest: result.result_digest.clone(),
        namespace: ReplayNamespaceV2::Exploratory,
        outbox_event_identity: event_identity.clone(),
        committed_at_epoch_ms,
    };
    receipt.receipt_digest = receipt.expected_digest()?;
    let payload = ResultOutboxPayloadV1 {
        schema_version: 1,
        receipt_identity,
        receipt_digest: receipt.receipt_digest.clone(),
        request_identity: result.request_identity.clone(),
        request_meaning_digest: result.request_meaning_digest.clone(),
        result_identity: result.result_identity.clone(),
        result_digest: result.result_digest.clone(),
        namespace: ReplayNamespaceV2::Exploratory,
        committed_at_epoch_ms,
    };
    let mut outbox = ResultOutboxV1 {
        schema_version: 1,
        event_identity,
        event_digest: placeholder.clone(),
        aggregate_identity: result.result_identity.clone(),
        event_kind: typed_identity(EVENT_KIND.to_string())?,
        payload_digest: placeholder,
        payload,
        committed_at_epoch_ms,
    };
    outbox.payload_digest = outbox.expected_payload_digest()?;
    outbox.event_digest = outbox.expected_event_digest()?;
    let receipt_bytes = serde_json::to_vec(&receipt)
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
    let outbox_bytes = serde_json::to_vec(&outbox)
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
    Ok((receipt, receipt_bytes, outbox, outbox_bytes))
}

fn decode_aggregate(
    row: &sqlx::postgres::PgRow,
) -> Result<ReplayResultReadbackV2, PostgresReplayResultOwnerErrorV2> {
    let result_bytes: Vec<u8> = required(row, "canonical_bytes")?;
    let result = ReplayResultDtoV2::from_canonical_bytes(&result_bytes)
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    let receipt_bytes: Vec<u8> = required(row, "receipt_canonical_bytes")?;
    let receipt: ResultReceiptV1 = decode_canonical(&receipt_bytes)?;
    let outbox_bytes: Vec<u8> = required(row, "outbox_canonical_bytes")?;
    let outbox: ResultOutboxV1 = decode_canonical(&outbox_bytes)?;

    if result.result_identity.as_str() != required::<String>(row, "result_identity")?
        || result.result_digest.as_str() != required::<String>(row, "result_digest")?
        || result.request_identity.as_str() != required::<String>(row, "request_identity")?
        || result.request_meaning_digest.as_str()
            != required::<String>(row, "request_meaning_digest")?
        || result.attempt_identity.as_str() != required::<String>(row, "attempt_identity")?
        || terminal_text(result.terminal) != required::<String>(row, "terminal")?
        || storage_digest(RESULT_STORAGE_DOMAIN, &result_bytes)
            != required::<String>(row, "canonical_bytes_blake3")?
        || receipt.receipt_identity.as_str() != required::<String>(row, "receipt_identity")?
        || receipt.receipt_digest.as_str() != required::<String>(row, "receipt_digest")?
        || receipt.request_identity.as_str()
            != required::<String>(row, "receipt_request_identity")?
        || receipt.request_meaning_digest.as_str()
            != required::<String>(row, "receipt_request_meaning_digest")?
        || receipt.result_digest.as_str() != required::<String>(row, "receipt_result_digest")?
        || namespace_text(receipt.namespace) != required::<String>(row, "receipt_namespace")?
        || receipt.outbox_event_identity.as_str()
            != required::<String>(row, "outbox_event_identity")?
        || receipt.committed_at_epoch_ms
            != required_epoch(row, "receipt_committed_at_epoch_ms")?
        || storage_digest(RECEIPT_STORAGE_DOMAIN, &receipt_bytes)
            != required::<String>(row, "receipt_canonical_bytes_blake3")?
        || outbox.event_identity.as_str() != required::<String>(row, "event_identity")?
        || outbox.event_digest.as_str() != required::<String>(row, "event_digest")?
        || outbox.payload.receipt_identity.as_str()
            != required::<String>(row, "outbox_receipt_identity")?
        || outbox.payload.request_identity.as_str()
            != required::<String>(row, "outbox_request_identity")?
        || outbox.payload.request_meaning_digest.as_str()
            != required::<String>(row, "outbox_request_meaning_digest")?
        || outbox.payload.result_digest.as_str()
            != required::<String>(row, "outbox_result_digest")?
        || namespace_text(outbox.payload.namespace)
            != required::<String>(row, "outbox_namespace")?
        || outbox.payload_digest.as_str() != required::<String>(row, "payload_digest")?
        || outbox.committed_at_epoch_ms != required_epoch(row, "outbox_committed_at_epoch_ms")?
        || storage_digest(OUTBOX_STORAGE_DOMAIN, &outbox_bytes)
            != required::<String>(row, "outbox_canonical_bytes_blake3")?
        || receipt.schema_version != 1
        || outbox.schema_version != 1
        || outbox.payload.schema_version != 1
        || receipt.receipt_digest != receipt.expected_digest()?
        || outbox.payload_digest != outbox.expected_payload_digest()?
        || outbox.event_digest != outbox.expected_event_digest()?
        || receipt.request_identity != result.request_identity
        || receipt.request_meaning_digest != result.request_meaning_digest
        || receipt.result_identity != result.result_identity
        || receipt.result_digest != result.result_digest
        || receipt.namespace != ReplayNamespaceV2::Exploratory
        || receipt.outbox_event_identity != outbox.event_identity
        || outbox.aggregate_identity != result.result_identity
        || outbox.event_kind.as_str() != EVENT_KIND
        || outbox.payload.receipt_identity != receipt.receipt_identity
        || outbox.payload.receipt_digest != receipt.receipt_digest
        || outbox.payload.request_identity != result.request_identity
        || outbox.payload.request_meaning_digest != result.request_meaning_digest
        || outbox.payload.result_identity != result.result_identity
        || outbox.payload.result_digest != result.result_digest
        || outbox.payload.namespace != ReplayNamespaceV2::Exploratory
        || outbox.committed_at_epoch_ms != receipt.committed_at_epoch_ms
        || outbox.payload.committed_at_epoch_ms != receipt.committed_at_epoch_ms
    {
        return Err(PostgresReplayResultOwnerErrorV2::CorruptReadback);
    }

    Ok(ReplayResultReadbackV2 {
        result,
        result_canonical_bytes: result_bytes,
        receipt_canonical_bytes: receipt_bytes,
        outbox_canonical_bytes: outbox_bytes,
    })
}

fn decode_canonical<T>(bytes: &[u8]) -> Result<T, PostgresReplayResultOwnerErrorV2>
where
    T: for<'de> Deserialize<'de> + Serialize,
{
    let value: T = serde_json::from_slice(bytes)
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    if serde_json::to_vec(&value)
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?
        != bytes
    {
        return Err(PostgresReplayResultOwnerErrorV2::CorruptReadback);
    }
    Ok(value)
}

fn required<T>(
    row: &sqlx::postgres::PgRow,
    column: &str,
) -> Result<T, PostgresReplayResultOwnerErrorV2>
where
    for<'value> T: sqlx::Decode<'value, Postgres> + sqlx::Type<Postgres>,
{
    row.try_get(column)
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)
}

fn required_epoch(
    row: &sqlx::postgres::PgRow,
    column: &str,
) -> Result<u64, PostgresReplayResultOwnerErrorV2> {
    let value: i64 = required(row, column)?;
    u64::try_from(value).map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)
}

fn terminal_text(value: ReplayTerminalV2) -> &'static str {
    match value {
        ReplayTerminalV2::RunRejected => "RUN_REJECTED",
        ReplayTerminalV2::InProgressOrUnknown => "IN_PROGRESS_OR_UNKNOWN",
        ReplayTerminalV2::TerminalResult => "TERMINAL_RESULT",
        ReplayTerminalV2::InvalidReplayEvidence => "INVALID_REPLAY_EVIDENCE",
    }
}

fn namespace_text(value: ReplayNamespaceV2) -> &'static str {
    match value {
        ReplayNamespaceV2::Exploratory => "EXPLORATORY",
        ReplayNamespaceV2::Protected => "PROTECTED",
    }
}

fn storage_digest(domain: &str, bytes: &[u8]) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain.as_bytes());
    hasher.update(b"\0");
    hasher.update(bytes);
    format!("blake3:{}", hasher.finalize().to_hex())
}

fn digest_value<T: Serialize>(
    domain: &str,
    value: &T,
) -> Result<CanonicalDigestV2, PostgresReplayResultOwnerErrorV2> {
    let bytes = serde_json::to_vec(value)
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
    typed_digest(storage_digest(domain, &bytes))
}

fn typed_identity(
    value: String,
) -> Result<OpaqueIdentityV2, PostgresReplayResultOwnerErrorV2> {
    OpaqueIdentityV2::try_from(value)
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)
}

fn typed_digest(
    value: String,
) -> Result<CanonicalDigestV2, PostgresReplayResultOwnerErrorV2> {
    CanonicalDigestV2::try_from(value)
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)
}
