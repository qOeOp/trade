//! The production custody store: signed append-only manifests, one signed current head per scope,
//! and immutable admission receipts, in PostgreSQL behind
//! `product/rd-workbench/postgres-init/20-deployment-store-custody.sh`.
//!
//! The custodian's principal can only read history, read the store clock, and record receipts; the
//! publisher's principal can only append a signed manifest and advance its head. Both reach the
//! store through that script's SECURITY DEFINER functions and hold no table privilege.

use std::sync::Arc;

use async_trait::async_trait;
use serde::{Serialize, de::DeserializeOwned};
use sqlx::{
    PgPool, Row,
    postgres::{PgPoolOptions, PgRow},
};
use thiserror::Error;
use vibe_postgres_connect::{PgPoolOptionsExt, PostgresTls, connect_options};

use super::{
    AdmissionCommitCut, AdmissionScope, AntiRollbackWitness, CustodyStore, ReceiptCommitError,
    ResolveHistoryError, ResolvedHistory, SealedDeploymentStoreAdmissionReceipt, SignedHead,
    SignedManifest, StoreHead, StoreManifest, digest_serializable, receipt_slot, seal_receipt_at,
};

const RESOLVE_HISTORY_SQL: &str = "SELECT entry_kind, generation, identity, entry_bytes, signer_identity, signature, read_cut_epoch_ms FROM deployment_store_custody_api.resolve_history_v1($1, $2, $3, $4, $5)";
const LOCK_HISTORY_SQL: &str = "SELECT entry_kind, generation, identity, entry_bytes, signer_identity, signature, read_cut_epoch_ms FROM deployment_store_custody_api.lock_history_v1($1, $2, $3, $4, $5)";
const ADMISSION_CUT_SQL: &str = "SELECT deployment_store_custody_api.admission_cut_v1()";
const RECORD_RECEIPT_SQL: &str = "SELECT receipt_identity, replay_identity, admitted_at_epoch_ms, receipt_bytes FROM deployment_store_custody_api.record_receipt_v1($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)";
const PUBLISH_SQL: &str = "SELECT deployment_store_custody_api.publish_v1($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)";

/// Why a custody store principal could not be connected or used. Secret-free.
#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub(super) enum CustodyStoreError {
    #[error("custody store connection options are invalid")]
    InvalidTarget,
    #[error("custody store is unavailable")]
    Unavailable,
    #[error("signed manifest and head do not describe one publication")]
    InconsistentPublication,
    #[error("custody store answered with an unknown publish outcome")]
    UnknownOutcome,
}

/// What a publish did to the custody store.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum PublishOutcomeV1 {
    /// The manifest was appended and the head now names it.
    Published,
    /// This exact manifest and head were already current; nothing was written.
    Replayed,
    /// The current head is not the one the publisher expected; nothing was written.
    HeadMismatch,
    /// Another manifest or head already holds this identity or generation; nothing was written.
    Conflict,
}

/// The custodian's view of the custody store.
pub(super) struct PostgresCustodyStore {
    pool: PgPool,
    witness: Arc<dyn AntiRollbackWitness>,
}

impl PostgresCustodyStore {
    /// Connects as the custodian principal. `witness` is the same anti-rollback witness the
    /// custodian consults: a commit re-observes it inside the store's transaction.
    ///
    /// # Errors
    ///
    /// Returns an error when the URL is not a PostgreSQL connection string or the store is
    /// unreachable.
    pub(super) async fn connect(
        custodian_database_url: &str,
        witness: Arc<dyn AntiRollbackWitness>,
    ) -> Result<Self, CustodyStoreError> {
        Ok(Self {
            pool: connect_pool(custodian_database_url).await?,
            witness,
        })
    }
}

#[async_trait]
impl CustodyStore for PostgresCustodyStore {
    async fn resolve_history(
        &self,
        scope: &AdmissionScope,
    ) -> Result<ResolvedHistory, ResolveHistoryError> {
        let rows = bind_scope(sqlx::query(RESOLVE_HISTORY_SQL), scope)
            .fetch_all(&self.pool)
            .await
            .map_err(|_| ResolveHistoryError::Unavailable)?;
        decode_history(&rows)
    }

    async fn commit_receipt_if_current(
        &self,
        scope: &AdmissionScope,
        expected_cut: &AdmissionCommitCut,
        receipt: SealedDeploymentStoreAdmissionReceipt,
    ) -> Result<SealedDeploymentStoreAdmissionReceipt, ReceiptCommitError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| ReceiptCommitError::Unavailable)?;
        // The scope's lock is held from here to the end of the transaction: no publish can move the
        // head between this read and the receipt.
        let rows = bind_scope(sqlx::query(LOCK_HISTORY_SQL), scope)
            .fetch_all(&mut *transaction)
            .await
            .map_err(|_| ReceiptCommitError::Unavailable)?;
        let current = decode_history(&rows).map_err(|e| match e {
            ResolveHistoryError::Unavailable => ReceiptCommitError::Unavailable,
            ResolveHistoryError::InvalidHistory => ReceiptCommitError::HeadChanged,
        })?;

        if current.current_heads.len() != 1
            || digest_serializable(&current.current_heads[0])
                != expected_cut.signed_head_proof_identity
            || digest_serializable(&current.manifests) != expected_cut.signed_history_proof_identity
        {
            return Err(ReceiptCommitError::HeadChanged);
        }
        let observation = self
            .witness
            .observe(scope, &current.current_heads[0].head)
            .await
            .map_err(|()| ReceiptCommitError::Unavailable)?;

        if digest_serializable(&observation) != expected_cut.witness_proof_identity {
            return Err(ReceiptCommitError::HeadChanged);
        }
        let cut: i64 = sqlx::query_scalar(ADMISSION_CUT_SQL)
            .fetch_one(&mut *transaction)
            .await
            .map_err(|_| ReceiptCommitError::Unavailable)?;
        let cut = u64::try_from(cut).map_err(|_| ReceiptCommitError::Unavailable)?;

        if cut < expected_cut.not_before_epoch_ms || cut >= expected_cut.valid_through_epoch_ms {
            return Err(ReceiptCommitError::Expired);
        }
        let sealed = seal_receipt_at(receipt.clone(), cut);
        let receipt_bytes =
            serde_json::to_vec(&sealed).map_err(|_| ReceiptCommitError::Unavailable)?;
        let slot = receipt_slot(scope, expected_cut);
        let admitted_at = i64::try_from(cut).map_err(|_| ReceiptCommitError::Unavailable)?;
        let stored = sqlx::query(RECORD_RECEIPT_SQL)
            .bind(&slot)
            .bind(&scope.environment_identity)
            .bind(&scope.deployment_identity)
            .bind(&scope.consumer_owner)
            .bind(&scope.consumer_identity)
            .bind(&scope.backend)
            .bind(&sealed.receipt_identity)
            .bind(&sealed.replay_identity)
            .bind(admitted_at)
            .bind(&receipt_bytes)
            .fetch_one(&mut *transaction)
            .await
            .map_err(|_| ReceiptCommitError::Unavailable)?;
        let joined = joined_receipt(receipt, &sealed, &stored)?;
        transaction
            .commit()
            .await
            .map_err(|_| ReceiptCommitError::Unavailable)?;
        Ok(joined)
    }
}

/// The receipt the slot now holds, rebuilt through the custodian's own sealing: a stored receipt
/// is never deserialized. Either the slot held nothing and holds `sealed` now, or it held the same
/// replay, sealed at its own admission, whose identity and bytes this rebuild must reproduce.
fn joined_receipt(
    unsealed: SealedDeploymentStoreAdmissionReceipt,
    sealed: &SealedDeploymentStoreAdmissionReceipt,
    stored: &PgRow,
) -> Result<SealedDeploymentStoreAdmissionReceipt, ReceiptCommitError> {
    let stored_identity: String = stored
        .try_get("receipt_identity")
        .map_err(|_| ReceiptCommitError::Unavailable)?;
    let stored_replay: String = stored
        .try_get("replay_identity")
        .map_err(|_| ReceiptCommitError::Unavailable)?;
    let stored_admitted_at: i64 = stored
        .try_get("admitted_at_epoch_ms")
        .map_err(|_| ReceiptCommitError::Unavailable)?;
    let stored_bytes: Vec<u8> = stored
        .try_get("receipt_bytes")
        .map_err(|_| ReceiptCommitError::Unavailable)?;

    if stored_replay != sealed.replay_identity {
        return Err(ReceiptCommitError::ConflictingReceipt);
    }
    let admitted_at =
        u64::try_from(stored_admitted_at).map_err(|_| ReceiptCommitError::ConflictingReceipt)?;
    let rebuilt = seal_receipt_at(unsealed, admitted_at);

    if rebuilt.receipt_identity != stored_identity
        || serde_json::to_vec(&rebuilt).ok().as_deref() != Some(stored_bytes.as_slice())
    {
        return Err(ReceiptCommitError::ConflictingReceipt);
    }
    Ok(rebuilt)
}

/// Appends one signed manifest and advances its scope's head to `head`, as the publisher
/// principal. `expected_previous_head` is the head the publisher saw, `None` for a scope's first
/// publication.
///
/// # Errors
///
/// Returns an error when the manifest and head do not describe one publication, the URL is not a
/// PostgreSQL connection string, or the store is unavailable.
pub(super) async fn publish_signed_v1(
    publisher_database_url: &str,
    manifest: &SignedManifest,
    head: &SignedHead,
    expected_previous_head: Option<&str>,
) -> Result<PublishOutcomeV1, CustodyStoreError> {
    let (m, h) = (&manifest.manifest, &head.head);

    if h.current_manifest_identity != m.manifest_identity
        || h.generation != m.generation
        || h.environment_identity != m.environment_identity
        || h.deployment_identity != m.deployment_identity
        || h.consumer_owner != m.consumer_owner
        || h.consumer_identity != m.consumer_identity
        || h.backend != m.backend
    {
        return Err(CustodyStoreError::InconsistentPublication);
    }
    let generation =
        i64::try_from(m.generation).map_err(|_| CustodyStoreError::InconsistentPublication)?;
    let manifest_bytes =
        serde_json::to_vec(m).map_err(|_| CustodyStoreError::InconsistentPublication)?;
    let head_bytes =
        serde_json::to_vec(h).map_err(|_| CustodyStoreError::InconsistentPublication)?;
    let pool = connect_pool(publisher_database_url).await?;
    let outcome: String = sqlx::query_scalar(PUBLISH_SQL)
        .bind(&m.environment_identity)
        .bind(&m.deployment_identity)
        .bind(&m.consumer_owner)
        .bind(&m.consumer_identity)
        .bind(&m.backend)
        .bind(expected_previous_head)
        .bind(generation)
        .bind(&m.manifest_identity)
        .bind(&manifest_bytes)
        .bind(&manifest.signer_identity)
        .bind(&manifest.signature)
        .bind(&h.head_identity)
        .bind(&head_bytes)
        .bind(&head.signer_identity)
        .bind(&head.signature)
        .fetch_one(&pool)
        .await
        .map_err(|_| CustodyStoreError::Unavailable)?;
    pool.close().await;

    match outcome.as_str() {
        "PUBLISHED" => Ok(PublishOutcomeV1::Published),
        "REPLAYED" => Ok(PublishOutcomeV1::Replayed),
        "HEAD_MISMATCH" => Ok(PublishOutcomeV1::HeadMismatch),
        "CONFLICT" => Ok(PublishOutcomeV1::Conflict),
        _ => Err(CustodyStoreError::UnknownOutcome),
    }
}

/// The custody store runs in the deployment's own PostgreSQL, which serves plaintext today.
async fn connect_pool(database_url: &str) -> Result<PgPool, CustodyStoreError> {
    let options = connect_options(database_url, PostgresTls::Disabled)
        .map_err(|_| CustodyStoreError::InvalidTarget)?;
    PgPoolOptions::new()
        .max_connections(2)
        .connect_stated(options)
        .await
        .map_err(|_| CustodyStoreError::Unavailable)
}

fn bind_scope<'q>(
    query: sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments>,
    scope: &'q AdmissionScope,
) -> sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments> {
    query
        .bind(&scope.environment_identity)
        .bind(&scope.deployment_identity)
        .bind(&scope.consumer_owner)
        .bind(&scope.consumer_identity)
        .bind(&scope.backend)
}

/// Decodes one history read. Every entry must be the exact bytes a signer signed: bytes that parse
/// but would not serialize back to themselves, or that name another identity or generation than
/// their row, are not a signed history.
fn decode_history(rows: &[PgRow]) -> Result<ResolvedHistory, ResolveHistoryError> {
    let mut manifests = Vec::new();
    let mut current_heads = Vec::new();
    let mut read_cut = None;

    for row in rows {
        let kind: String = row
            .try_get("entry_kind")
            .map_err(|_| ResolveHistoryError::Unavailable)?;
        let cut: i64 = row
            .try_get("read_cut_epoch_ms")
            .map_err(|_| ResolveHistoryError::Unavailable)?;
        let cut = u64::try_from(cut).map_err(|_| ResolveHistoryError::Unavailable)?;

        if read_cut.is_some_and(|seen| seen != cut) {
            return Err(ResolveHistoryError::Unavailable);
        }
        read_cut = Some(cut);

        if kind == "CUT" {
            continue;
        }
        let entry = SignedEntryRow::from_row(row)?;

        match kind.as_str() {
            "MANIFEST" => {
                let manifest: StoreManifest = decode_exact(&entry.bytes)?;

                if manifest.manifest_identity != entry.identity
                    || manifest.generation != entry.generation
                {
                    return Err(ResolveHistoryError::InvalidHistory);
                }
                manifests.push(SignedManifest {
                    manifest,
                    signer_identity: entry.signer_identity,
                    signature: entry.signature,
                });
            }
            "HEAD" => {
                let head: StoreHead = decode_exact(&entry.bytes)?;

                if head.head_identity != entry.identity || head.generation != entry.generation {
                    return Err(ResolveHistoryError::InvalidHistory);
                }
                current_heads.push(SignedHead {
                    head,
                    signer_identity: entry.signer_identity,
                    signature: entry.signature,
                });
            }
            _ => return Err(ResolveHistoryError::InvalidHistory),
        }
    }
    manifests.sort_by_key(|entry| entry.manifest.generation);
    Ok(ResolvedHistory {
        manifests,
        current_heads,
        read_cut_epoch_ms: read_cut.ok_or(ResolveHistoryError::Unavailable)?,
    })
}

struct SignedEntryRow {
    generation: u64,
    identity: String,
    bytes: Vec<u8>,
    signer_identity: String,
    signature: Vec<u8>,
}

impl SignedEntryRow {
    fn from_row(row: &PgRow) -> Result<Self, ResolveHistoryError> {
        let generation: i64 = row
            .try_get("generation")
            .map_err(|_| ResolveHistoryError::InvalidHistory)?;
        Ok(Self {
            generation: u64::try_from(generation)
                .map_err(|_| ResolveHistoryError::InvalidHistory)?,
            identity: row
                .try_get("identity")
                .map_err(|_| ResolveHistoryError::InvalidHistory)?,
            bytes: row
                .try_get("entry_bytes")
                .map_err(|_| ResolveHistoryError::InvalidHistory)?,
            signer_identity: row
                .try_get("signer_identity")
                .map_err(|_| ResolveHistoryError::InvalidHistory)?,
            signature: row
                .try_get("signature")
                .map_err(|_| ResolveHistoryError::InvalidHistory)?,
        })
    }
}

/// Parses `bytes` and requires that serializing the result reproduces them exactly, so the value
/// the custodian verifies is the message the signer signed.
fn decode_exact<T: Serialize + DeserializeOwned>(bytes: &[u8]) -> Result<T, ResolveHistoryError> {
    let value: T =
        serde_json::from_slice(bytes).map_err(|_| ResolveHistoryError::InvalidHistory)?;

    if serde_json::to_vec(&value).ok().as_deref() != Some(bytes) {
        return Err(ResolveHistoryError::InvalidHistory);
    }
    Ok(value)
}
