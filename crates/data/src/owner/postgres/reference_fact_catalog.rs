//! Transaction-bound storage for exact `ReferenceFactCatalog` entries.

#![allow(
    dead_code,
    reason = "the catalog is installed by the native reference composition slice"
)]

use std::collections::HashSet;

use sqlx::{Postgres, Row, Transaction};

use crate::owner::reference_fact_catalog::{
    ReferenceFactCatalogEntryV1, ReferenceFactCatalogErrorV1, ReferenceFactCatalogKindV1,
    UntrustedReferenceFactCatalogLocatorV1, decode_reference_fact_catalog_entry_v1,
};

pub(super) const REFERENCE_FACT_CATALOG_SCHEMA_V1: &[&str] = &[
    super::OWNER_SCHEMA_GUARD_V1,
    "REVOKE ALL ON SCHEMA market_data_private FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS market_data_private.reference_fact_catalog_entries_v1(entry_identity BYTEA PRIMARY KEY CHECK(octet_length(entry_identity)=32),entry_digest BYTEA UNIQUE NOT NULL CHECK(octet_length(entry_digest)=32),scope_identity BYTEA NOT NULL CHECK(octet_length(scope_identity)=32),lineage_root BYTEA NOT NULL CHECK(octet_length(lineage_root)=32),correction_sequence BIGINT NOT NULL CHECK(correction_sequence>0),predecessor_identity BYTEA NULL REFERENCES market_data_private.reference_fact_catalog_entries_v1(entry_identity),effective_from_ns TEXT NOT NULL,effective_until_ns TEXT NULL,entry_bytes BYTEA NOT NULL CHECK(octet_length(entry_bytes)>0),UNIQUE(scope_identity,lineage_root,correction_sequence))",
    "CREATE TABLE IF NOT EXISTS market_data_private.reference_fact_catalog_heads_v1(scope_identity BYTEA NOT NULL CHECK(octet_length(scope_identity)=32),lineage_root BYTEA NOT NULL CHECK(octet_length(lineage_root)=32),entry_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.reference_fact_catalog_entries_v1(entry_identity),correction_sequence BIGINT NOT NULL CHECK(correction_sequence>0),PRIMARY KEY(scope_identity,lineage_root))",
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
    sqlx::query("SAVEPOINT market_data_reference_fact_catalog_v1")
        .execute(&mut **tx)
        .await
        .map_err(store_error)?;
    let result = admit_inner(tx, entry).await;
    match result {
        Ok(stored) => {
            sqlx::query("RELEASE SAVEPOINT market_data_reference_fact_catalog_v1")
                .execute(&mut **tx)
                .await
                .map_err(store_error)?;
            Ok(stored)
        }
        Err(e) => {
            sqlx::query("ROLLBACK TO SAVEPOINT market_data_reference_fact_catalog_v1")
                .execute(&mut **tx)
                .await
                .map_err(store_error)?;
            sqlx::query("RELEASE SAVEPOINT market_data_reference_fact_catalog_v1")
                .execute(&mut **tx)
                .await
                .map_err(store_error)?;
            Err(e)
        }
    }
}

async fn admit_inner(
    tx: &mut Transaction<'_, Postgres>,
    entry: &ReferenceFactCatalogEntryV1,
) -> Result<ReferenceFactCatalogEntryV1, ReferenceFactCatalogErrorV1> {
    let locator = entry.locator();
    advisory_lock(
        tx,
        catalog_head_lock(entry.scope_identity(), entry.lineage_root()),
    )
    .await?;

    if let Some(stored) = resolve_reference_fact_catalog_entry_v1(tx, locator).await? {
        if stored.canonical_bytes() != entry.canonical_bytes() {
            return Err(ReferenceFactCatalogErrorV1::RequestConflict);
        }
        return Ok(stored);
    }
    let head: Option<(Vec<u8>, i64)> = sqlx::query_as(
        "SELECT entry_identity,correction_sequence FROM market_data_private.reference_fact_catalog_heads_v1 WHERE scope_identity=$1 AND lineage_root=$2 FOR UPDATE",
    )
    .bind(entry.scope_identity().as_bytes().as_slice())
    .bind(entry.lineage_root().as_bytes().as_slice())
    .fetch_optional(&mut **tx).await.map_err(store_error)?;

    let predecessor = match entry.predecessor_identity() {
        None => None,
        Some(identity) => {
            resolve_reference_fact_catalog_entry_v1(
                tx,
                UntrustedReferenceFactCatalogLocatorV1::from_untrusted(identity, identity),
            )
            .await?
        }
    };

    if let Some(prior) = predecessor.as_ref()
        && (prior.scope_identity() != entry.scope_identity()
            || prior.kind() != entry.kind()
            || prior.lineage_root() != entry.lineage_root()
            || prior.correction_sequence().checked_add(1) != Some(entry.correction_sequence())
            || prior.source().source_binding_lineage_root
                != entry.source().source_binding_lineage_root
            || prior.source().source_binding_lineage_version.checked_add(1)
                != Some(entry.source().source_binding_lineage_version)
            || !effective_interval_follows(prior, entry))
    {
        return Err(ReferenceFactCatalogErrorV1::RequestConflict);
    }

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
    let sequence = i64::try_from(entry.correction_sequence())
        .map_err(|_| ReferenceFactCatalogErrorV1::CapacityExceeded)?;
    let affected = match entry.predecessor_identity() {
        None => sqlx::query("INSERT INTO market_data_private.reference_fact_catalog_heads_v1(scope_identity,lineage_root,entry_identity,correction_sequence) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING")
            .bind(entry.scope_identity().as_bytes().as_slice()).bind(entry.lineage_root().as_bytes().as_slice())
            .bind(entry.identity().as_bytes().as_slice()).bind(sequence)
            .execute(&mut **tx).await.map_err(store_error)?.rows_affected(),
        Some(prior) => sqlx::query("UPDATE market_data_private.reference_fact_catalog_heads_v1 SET entry_identity=$3,correction_sequence=$4 WHERE scope_identity=$1 AND lineage_root=$2 AND entry_identity=$5 AND correction_sequence=$6")
            .bind(entry.scope_identity().as_bytes().as_slice()).bind(entry.lineage_root().as_bytes().as_slice())
            .bind(entry.identity().as_bytes().as_slice()).bind(sequence)
            .bind(prior.as_bytes().as_slice()).bind(sequence - 1)
            .execute(&mut **tx).await.map_err(store_error)?.rows_affected(),
    };

    if affected != 1 {
        return Err(ReferenceFactCatalogErrorV1::RequestConflict);
    }
    resolve_reference_fact_catalog_entry_v1(tx, locator)
        .await?
        .ok_or(ReferenceFactCatalogErrorV1::StoreUntrusted)
}

fn effective_interval_follows(
    prior: &ReferenceFactCatalogEntryV1,
    entry: &ReferenceFactCatalogEntryV1,
) -> bool {
    match entry.kind() {
        ReferenceFactCatalogKindV1::TimeZone => {
            (prior.effective_from_ns() == entry.effective_from_ns()
                && prior.effective_until_ns() == entry.effective_until_ns())
                || prior.effective_until_ns() == Some(entry.effective_from_ns())
        }
        ReferenceFactCatalogKindV1::Calendar | ReferenceFactCatalogKindV1::Session => {
            prior.effective_from_ns() == entry.effective_from_ns()
                && prior.effective_until_ns() == entry.effective_until_ns()
        }
    }
}

pub(super) async fn resolve_reference_fact_catalog_entry_v1(
    tx: &mut Transaction<'_, Postgres>,
    locator: UntrustedReferenceFactCatalogLocatorV1,
) -> Result<Option<ReferenceFactCatalogEntryV1>, ReferenceFactCatalogErrorV1> {
    if locator.entry_identity != locator.entry_digest {
        return Err(ReferenceFactCatalogErrorV1::DependencyMismatch);
    }
    let Some(entry) = load_entry(tx, locator.entry_identity).await? else {
        return Ok(None);
    };

    if entry.identity() != locator.entry_digest {
        return Err(ReferenceFactCatalogErrorV1::StoreUntrusted);
    }

    let head = sqlx::query("SELECT entry_identity,correction_sequence FROM market_data_private.reference_fact_catalog_heads_v1 WHERE scope_identity=$1 AND lineage_root=$2 FOR SHARE")
        .bind(entry.scope_identity().as_bytes().as_slice())
        .bind(entry.lineage_root().as_bytes().as_slice())
        .fetch_optional(&mut **tx).await.map_err(store_error)?
        .ok_or(ReferenceFactCatalogErrorV1::StoreUntrusted)?;
    let head_identity = row_identity(&head, "entry_identity")?;
    let head_sequence: i64 = head.try_get("correction_sequence").map_err(store_error)?;
    let head_sequence =
        u64::try_from(head_sequence).map_err(|_| ReferenceFactCatalogErrorV1::StoreUntrusted)?;
    if head_sequence < entry.correction_sequence() {
        return Err(ReferenceFactCatalogErrorV1::StoreUntrusted);
    }

    let mut current_identity = head_identity;
    let mut expected_sequence = head_sequence;
    let mut successor_source_version = None;
    let mut seen = HashSet::new();
    let mut found_requested_entry = false;

    loop {
        if !seen.insert(current_identity) {
            return Err(ReferenceFactCatalogErrorV1::StoreUntrusted);
        }
        let current = load_entry(tx, current_identity)
            .await?
            .ok_or(ReferenceFactCatalogErrorV1::StoreUntrusted)?;

        if current.scope_identity() != entry.scope_identity()
            || current.lineage_root() != entry.lineage_root()
            || current.kind() != entry.kind()
            || current.correction_sequence() != expected_sequence
            || successor_source_version.is_some_and(|version| {
                current
                    .source()
                    .source_binding_lineage_version
                    .checked_add(1)
                    != Some(version)
            })
        {
            return Err(ReferenceFactCatalogErrorV1::StoreUntrusted);
        }

        if current_identity == entry.identity() {
            found_requested_entry = true;
        }

        match (expected_sequence, current.predecessor_identity()) {
            (1, None) => break,
            (2.., Some(predecessor)) => {
                current_identity = predecessor;
                successor_source_version = Some(current.source().source_binding_lineage_version);
                expected_sequence -= 1;
            }
            _ => return Err(ReferenceFactCatalogErrorV1::StoreUntrusted),
        }
    }

    if !found_requested_entry {
        return Err(ReferenceFactCatalogErrorV1::StoreUntrusted);
    }
    Ok(Some(entry))
}

async fn load_entry(
    tx: &mut Transaction<'_, Postgres>,
    identity: crate::owner::source_binding::BindingDigest,
) -> Result<Option<ReferenceFactCatalogEntryV1>, ReferenceFactCatalogErrorV1> {
    let row = sqlx::query("SELECT entry_digest,scope_identity,lineage_root,correction_sequence,predecessor_identity,effective_from_ns,effective_until_ns,entry_bytes FROM market_data_private.reference_fact_catalog_entries_v1 WHERE entry_identity=$1 FOR SHARE")
        .bind(identity.as_bytes().as_slice()).fetch_optional(&mut **tx).await.map_err(store_error)?;
    let Some(row) = row else {
        return Ok(None);
    };
    let digest = row_identity(&row, "entry_digest")?;
    let scope = row_identity(&row, "scope_identity")?;
    let lineage = row_identity(&row, "lineage_root")?;
    let sequence: i64 = row.try_get("correction_sequence").map_err(store_error)?;
    let predecessor: Option<Vec<u8>> = row.try_get("predecessor_identity").map_err(store_error)?;
    let predecessor = predecessor.map(digest_from_bytes).transpose()?;
    let effective_from: String = row.try_get("effective_from_ns").map_err(store_error)?;
    let effective_until: Option<String> = row.try_get("effective_until_ns").map_err(store_error)?;
    let bytes: Vec<u8> = row.try_get("entry_bytes").map_err(store_error)?;
    let entry = decode_reference_fact_catalog_entry_v1(&bytes)
        .map_err(|_| ReferenceFactCatalogErrorV1::StoreUntrusted)?;

    if identity != entry.identity()
        || digest != entry.digest()
        || scope != entry.scope_identity()
        || lineage != entry.lineage_root()
        || u64::try_from(sequence).ok() != Some(entry.correction_sequence())
        || predecessor != entry.predecessor_identity()
        || effective_from != entry.effective_from_ns().to_string()
        || effective_until != entry.effective_until_ns().map(|value| value.to_string())
    {
        return Err(ReferenceFactCatalogErrorV1::StoreUntrusted);
    }
    Ok(Some(entry))
}

fn row_identity(
    row: &sqlx::postgres::PgRow,
    name: &str,
) -> Result<crate::owner::source_binding::BindingDigest, ReferenceFactCatalogErrorV1> {
    digest_from_bytes(row.try_get(name).map_err(store_error)?)
}

fn digest_from_bytes(
    bytes: Vec<u8>,
) -> Result<crate::owner::source_binding::BindingDigest, ReferenceFactCatalogErrorV1> {
    Ok(
        crate::owner::source_binding::BindingDigest::from_untrusted_bytes(
            bytes
                .try_into()
                .map_err(|_| ReferenceFactCatalogErrorV1::StoreUntrusted)?,
        ),
    )
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
fn catalog_head_lock(
    scope_identity: crate::owner::source_binding::BindingDigest,
    lineage_root: crate::owner::source_binding::BindingDigest,
) -> crate::owner::source_binding::BindingDigest {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"vibe.market-data.reference-fact-catalog-head-lock.v1\0");
    hasher.update(scope_identity.as_bytes());
    hasher.update(lineage_root.as_bytes());
    crate::owner::source_binding::BindingDigest::from_untrusted_bytes(*hasher.finalize().as_bytes())
}
fn store_error<E: std::fmt::Debug>(_: E) -> ReferenceFactCatalogErrorV1 {
    ReferenceFactCatalogErrorV1::StoreUnavailable
}
