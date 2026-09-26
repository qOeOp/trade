//! Writes, or reuses, the sample of one binding's row inside the caller's Owner transaction.
//!
//! A sample is keyed by the row it reads: its series and its slot, which the snapshot's fact digest
//! keys. Nothing about the binding enters it. A binding reads a sample through its own timeframe
//! projection, and this module attaches that projection to the sample, so every binding that reads
//! one row of one snapshot shares that row's one sample and the sample is never written twice.
//!
//! A series is one append chain shared by every snapshot, binding and Design that reads it. The
//! writer therefore locks and reads the series head and the row's slot head in the caller's
//! transaction before it prepares anything: a slot that already holds a sample is reused after
//! proving the stored fact is exactly this row's, and a new row is prepared against the series head
//! it will succeed.

use sqlx::{Postgres, Transaction};

use super::{
    PreparedSampleCustodyV1, SampleCustodyErrorV1, commit_sample_custody_in_transaction_v1,
    load_sample_custody, sample_advisory_key, store_timeframe_projection_receipt_in_transaction_v1,
};
use crate::owner::{
    sample_fact::{
        SampleFactHeadsV1, StoredSampleReadbackV1, TimeframeProjectionReceiptV1,
        prepare_sample_commit_from_source_v1, verify_stored_sample_readback_v1,
    },
    strategy_input_binding::SampleSourceV1,
};

pub(super) const SCHEMA_V1: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS market_data_private.sample_projection_attachments_v1 (sample_identity BYTEA NOT NULL REFERENCES market_data_private.sample_facts_v1(sample_identity), projection_receipt_digest BYTEA NOT NULL REFERENCES market_data_private.timeframe_projection_receipts_v1(receipt_digest), PRIMARY KEY (sample_identity, projection_receipt_digest))",
    "REVOKE ALL ON TABLE market_data_private.sample_projection_attachments_v1 FROM PUBLIC",
];

/// Returns the sample of `source`'s row, writing it only if its slot holds none, and attaches
/// `timeframe` to it.
///
/// Runs in the caller's Owner transaction and never commits it. The same row under the same
/// projection returns the stored sample and writes nothing; under another binding's projection of
/// the same timeframe it returns the stored sample and records that attachment only.
///
/// # Errors
///
/// - [`SampleCustodyErrorV1::ProjectionConflict`] when `timeframe` is not `source`'s binding's
///   projection, differs from the one that binding already stored, or names another timeframe than
///   the stored sample.
/// - [`SampleCustodyErrorV1::IdentityConflict`] when the row's slot holds a sample that is not this
///   row's.
/// - [`SampleCustodyErrorV1::StoreUnavailable`] when the store cannot be read or written, or holds
///   custody that does not verify.
pub(super) async fn commit_or_reuse_source_sample_in_transaction_v1(
    transaction: &mut Transaction<'_, Postgres>,
    source: &SampleSourceV1<'_>,
    timeframe: &TimeframeProjectionReceiptV1,
) -> Result<StoredSampleReadbackV1, SampleCustodyErrorV1> {
    if timeframe.binding_receipt_digest() != *source.binding_digest.as_bytes() {
        return Err(SampleCustodyErrorV1::ProjectionConflict);
    }
    store_timeframe_projection_receipt_in_transaction_v1(
        transaction,
        timeframe.digest(),
        timeframe.binding_receipt_digest(),
        timeframe.canonical_bytes(),
    )
    .await?;

    // Preparing against no heads only derives the row's keys: its series, and its slot as the root
    // slot a first sample of this row would take. The fact written, if any, is prepared below.
    let keys = prepare_sample_commit_from_source_v1(source, timeframe, no_heads())
        .map_err(|_| SampleCustodyErrorV1::InvalidInput)?;
    let series = keys.fact().series_identity();
    let slot = keys.fact().slot_identity();
    let mut locks = [sample_advisory_key(series), sample_advisory_key(slot)];
    locks.sort_unstable();

    for lock in locks {
        sqlx::query("SELECT pg_advisory_xact_lock($1)")
            .bind(lock)
            .execute(&mut **transaction)
            .await
            .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
    }

    let stored = if let Some(existing) = head_sample(transaction, SLOT_HEAD_SQL, slot).await? {
        let stored = load_sample_readback(transaction, existing).await?;
        verify_is_this_rows_sample(transaction, source, timeframe, &stored).await?;
        stored
    } else {
        let series_head = match head_sample(transaction, SERIES_HEAD_SQL, series).await? {
            Some(head) => Some(load_sample_readback(transaction, head).await?),
            None => None,
        };
        let prepared = prepare_sample_commit_from_source_v1(
            source,
            timeframe,
            SampleFactHeadsV1 {
                series: series_head.as_ref(),
                slot: None,
            },
        )
        .map_err(|_| SampleCustodyErrorV1::InvalidInput)?;
        let custody = PreparedSampleCustodyV1::from_prepared_contract(&prepared);
        let written = commit_sample_custody_in_transaction_v1(transaction, &custody, false).await?;
        verify_stored_sample_readback_v1(
            prepared.fact_canonical_bytes(),
            prepared.fact_digest(),
            &written.receipt_bytes,
            written.receipt_digest,
        )
        .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?
    };
    attach_projection(transaction, &stored, timeframe).await?;
    Ok(stored)
}

const SLOT_HEAD_SQL: &str = "SELECT sample_identity FROM market_data_private.sample_correction_heads_v1 WHERE correction_slot_identity=$1 FOR UPDATE";
const SERIES_HEAD_SQL: &str = "SELECT sample_identity FROM market_data_private.sample_series_heads_v1 WHERE series_identity=$1 FOR UPDATE";

const fn no_heads() -> SampleFactHeadsV1<'static> {
    SampleFactHeadsV1 {
        series: None,
        slot: None,
    }
}

async fn head_sample(
    transaction: &mut Transaction<'_, Postgres>,
    sql: &'static str,
    key: [u8; 32],
) -> Result<Option<[u8; 32]>, SampleCustodyErrorV1> {
    let head: Option<Vec<u8>> = sqlx::query_scalar(sql)
        .bind(key.as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
    head.map(|bytes| {
        bytes
            .try_into()
            .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)
    })
    .transpose()
}

/// Loads and verifies one stored sample by its identity.
async fn load_sample_readback(
    transaction: &mut Transaction<'_, Postgres>,
    sample_identity: [u8; 32],
) -> Result<StoredSampleReadbackV1, SampleCustodyErrorV1> {
    let receipt: Vec<u8> = sqlx::query_scalar(
        "SELECT receipt_digest FROM market_data_private.sample_receipts_v1 WHERE sample_identity=$1",
    )
    .bind(sample_identity.as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?
    .ok_or(SampleCustodyErrorV1::StoreUnavailable)?;
    let receipt: [u8; 32] = receipt
        .try_into()
        .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
    let stored = load_sample_custody(transaction, receipt)
        .await?
        .ok_or(SampleCustodyErrorV1::StoreUnavailable)?;
    verify_stored_sample_readback_v1(
        &stored.prepared.fact_bytes,
        stored.prepared.fact_digest,
        &stored.prepared.receipt_bytes,
        stored.prepared.receipt_digest,
    )
    .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)
}

/// Proves the sample a slot holds is exactly the one this row prepares.
///
/// The stored fact is prepared again from this row against the series predecessor it names, and
/// must come out byte for byte. A slot of one snapshot's row holds no correction, so a stored
/// correction predecessor, or any other difference, is a sample of another row.
async fn verify_is_this_rows_sample(
    transaction: &mut Transaction<'_, Postgres>,
    source: &SampleSourceV1<'_>,
    timeframe: &TimeframeProjectionReceiptV1,
    stored: &StoredSampleReadbackV1,
) -> Result<(), SampleCustodyErrorV1> {
    let fact = stored.fact();
    if fact.correction_predecessor().is_some() {
        return Err(SampleCustodyErrorV1::IdentityConflict);
    }
    let predecessor = if fact.series_predecessor() == [0; 32] {
        None
    } else {
        Some(load_sample_readback(transaction, fact.series_predecessor()).await?)
    };
    let again = prepare_sample_commit_from_source_v1(
        source,
        timeframe,
        SampleFactHeadsV1 {
            series: predecessor.as_ref(),
            slot: None,
        },
    )
    .map_err(|_| SampleCustodyErrorV1::IdentityConflict)?;

    if again.fact_canonical_bytes() != fact.canonical_bytes()
        || again.sample_receipt_canonical_bytes() != stored.receipt().canonical_bytes()
    {
        return Err(SampleCustodyErrorV1::IdentityConflict);
    }
    Ok(())
}

/// Records that `timeframe`'s binding reads `stored`, once.
async fn attach_projection(
    transaction: &mut Transaction<'_, Postgres>,
    stored: &StoredSampleReadbackV1,
    timeframe: &TimeframeProjectionReceiptV1,
) -> Result<(), SampleCustodyErrorV1> {
    if stored.fact().timeframe_identity() != timeframe.timeframe_identity() {
        return Err(SampleCustodyErrorV1::ProjectionConflict);
    }
    sqlx::query("INSERT INTO market_data_private.sample_projection_attachments_v1(sample_identity,projection_receipt_digest) VALUES ($1,$2) ON CONFLICT (sample_identity, projection_receipt_digest) DO NOTHING")
        .bind(stored.fact().sample_identity().as_slice())
        .bind(timeframe.digest().as_slice())
        .execute(&mut **transaction)
        .await
        .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
    Ok(())
}
