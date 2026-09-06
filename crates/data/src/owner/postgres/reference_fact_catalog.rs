//! Transaction-bound storage for exact ReferenceFactCatalog entries.

#![allow(
    dead_code,
    reason = "the catalog is installed by the native reference composition slice"
)]

use sqlx::{Postgres, Row, Transaction};

use crate::owner::reference_fact_catalog::{
    ReferenceFactCatalogEntryV1, ReferenceFactCatalogErrorV1,
    UntrustedReferenceFactCatalogLocatorV1, decode_reference_fact_catalog_entry_v1,
};

pub(super) const REFERENCE_FACT_CATALOG_SCHEMA_V1: &[&str] = &[
    super::OWNER_SCHEMA_GUARD_V1,
    "REVOKE ALL ON SCHEMA market_data_private FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS market_data_private.reference_fact_catalog_entries_v1(entry_identity BYTEA PRIMARY KEY CHECK(octet_length(entry_identity)=32),entry_digest BYTEA UNIQUE NOT NULL CHECK(octet_length(entry_digest)=32),scope_identity BYTEA NOT NULL CHECK(octet_length(scope_identity)=32),lineage_root BYTEA NOT NULL CHECK(octet_length(lineage_root)=32),correction_sequence BIGINT NOT NULL CHECK(correction_sequence>0),predecessor_identity BYTEA NULL REFERENCES market_data_private.reference_fact_catalog_entries_v1(entry_identity),effective_from_ns TEXT NOT NULL,effective_until_ns TEXT NULL,entry_bytes BYTEA NOT NULL CHECK(octet_length(entry_bytes)>0),UNIQUE(lineage_root,correction_sequence))",
    "CREATE TABLE IF NOT EXISTS market_data_private.reference_fact_catalog_heads_v1(lineage_root BYTEA PRIMARY KEY CHECK(octet_length(lineage_root)=32),entry_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.reference_fact_catalog_entries_v1(entry_identity),correction_sequence BIGINT NOT NULL CHECK(correction_sequence>0))",
    "REVOKE ALL ON TABLE market_data_private.reference_fact_catalog_entries_v1,market_data_private.reference_fact_catalog_heads_v1 FROM PUBLIC",
];

pub(super) async fn install_reference_fact_catalog_schema_v1(
    tx: &mut Transaction<'_, Postgres>,
) -> Result<(), ReferenceFactCatalogErrorV1> {
    for statement in REFERENCE_FACT_CATALOG_SCHEMA_V1 {
        sqlx::query(*statement)
            .execute(&mut **tx)
            .await
            .map_err(store_error)?;
    }
    Ok(())
}

pub(super) async fn admit_reference_fact_catalog_entry_v1(
    tx: &mut Transaction<'_, Postgres>,
    entry: &ReferenceFactCatalogEntryV1,
) -> Result<ReferenceFactCatalogEntryV1, ReferenceFactCatalogErrorV1> {
    let locator = entry.locator();
    advisory_lock(tx, locator.entry_identity).await?;
    if let Some(stored) = resolve_reference_fact_catalog_entry_v1(tx, locator).await? {
        if stored.canonical_bytes() != entry.canonical_bytes() {
            return Err(ReferenceFactCatalogErrorV1::RequestConflict);
        }
        return Ok(stored);
    }
    let head: Option<(Vec<u8>, i64)> = sqlx::query_as(
        "SELECT entry_identity,correction_sequence FROM market_data_private.reference_fact_catalog_heads_v1 WHERE lineage_root=$1 FOR UPDATE",
    )
    .bind(entry.lineage_root().as_bytes().as_slice())
    .fetch_optional(&mut **tx).await.map_err(store_error)?;
    match (
        head,
        entry.predecessor_identity(),
        entry.correction_sequence(),
    ) {
        (None, None, 1) => {}
        (Some((identity, sequence)), Some(predecessor), next)
            if identity == predecessor.as_bytes().as_slice()
                && u64::try_from(sequence).ok().and_then(|v| v.checked_add(1)) == Some(next) => {}
        _ => return Err(ReferenceFactCatalogErrorV1::RequestConflict),
    }
    sqlx::query("INSERT INTO market_data_private.reference_fact_catalog_entries_v1(entry_identity,entry_digest,scope_identity,lineage_root,correction_sequence,predecessor_identity,effective_from_ns,effective_until_ns,entry_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)")
        .bind(entry.identity().as_bytes().as_slice()).bind(entry.digest().as_bytes().as_slice())
        .bind(entry.scope_identity().as_bytes().as_slice()).bind(entry.lineage_root().as_bytes().as_slice())
        .bind(i64::try_from(entry.correction_sequence()).map_err(|_| ReferenceFactCatalogErrorV1::CapacityExceeded)?)
        .bind(entry.predecessor_identity().map(|v| v.as_bytes().to_vec()))
        .bind(entry.effective_from_ns().to_string()).bind(entry.effective_until_ns().map(|v| v.to_string()))
        .bind(entry.canonical_bytes()).execute(&mut **tx).await.map_err(store_error)?;
    sqlx::query("INSERT INTO market_data_private.reference_fact_catalog_heads_v1(lineage_root,entry_identity,correction_sequence) VALUES($1,$2,$3) ON CONFLICT(lineage_root) DO UPDATE SET entry_identity=EXCLUDED.entry_identity,correction_sequence=EXCLUDED.correction_sequence")
        .bind(entry.lineage_root().as_bytes().as_slice()).bind(entry.identity().as_bytes().as_slice())
        .bind(i64::try_from(entry.correction_sequence()).map_err(|_| ReferenceFactCatalogErrorV1::CapacityExceeded)?)
        .execute(&mut **tx).await.map_err(store_error)?;
    resolve_reference_fact_catalog_entry_v1(tx, locator)
        .await?
        .ok_or(ReferenceFactCatalogErrorV1::StoreUntrusted)
}

pub(super) async fn resolve_reference_fact_catalog_entry_v1(
    tx: &mut Transaction<'_, Postgres>,
    locator: UntrustedReferenceFactCatalogLocatorV1,
) -> Result<Option<ReferenceFactCatalogEntryV1>, ReferenceFactCatalogErrorV1> {
    if locator.entry_identity != locator.entry_digest {
        return Err(ReferenceFactCatalogErrorV1::DependencyMismatch);
    }
    let row = sqlx::query("SELECT entry_digest,entry_bytes FROM market_data_private.reference_fact_catalog_entries_v1 WHERE entry_identity=$1 FOR SHARE")
        .bind(locator.entry_identity.as_bytes().as_slice()).fetch_optional(&mut **tx).await.map_err(store_error)?;
    let Some(row) = row else {
        return Ok(None);
    };
    let digest: Vec<u8> = row.try_get("entry_digest").map_err(store_error)?;
    let bytes: Vec<u8> = row.try_get("entry_bytes").map_err(store_error)?;
    if digest != locator.entry_digest.as_bytes().as_slice() {
        return Err(ReferenceFactCatalogErrorV1::StoreUntrusted);
    }
    let entry = decode_reference_fact_catalog_entry_v1(&bytes)?;
    if entry.identity() != locator.entry_identity {
        return Err(ReferenceFactCatalogErrorV1::StoreUntrusted);
    }
    Ok(Some(entry))
}

async fn advisory_lock(
    tx: &mut Transaction<'_, Postgres>,
    id: crate::owner::source_binding::BindingDigest,
) -> Result<(), ReferenceFactCatalogErrorV1> {
    let mut bytes = [0_u8; 8];
    bytes.copy_from_slice(&id.as_bytes()[..8]);
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(i64::from_be_bytes(bytes))
        .execute(&mut **tx)
        .await
        .map_err(store_error)?;
    Ok(())
}
fn store_error<E: std::fmt::Debug>(_: E) -> ReferenceFactCatalogErrorV1 {
    ReferenceFactCatalogErrorV1::StoreUnavailable
}
