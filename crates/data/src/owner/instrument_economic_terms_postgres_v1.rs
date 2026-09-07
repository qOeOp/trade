//! PostgreSQL custody for private Instrument Owner economic terms.
//!
//! Issue is one SERIALIZABLE transaction containing the fact and its deterministic receipt.
//! Recovery requires both exact identities; there is no latest scan or generic query surface.

use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use thiserror::Error;

use super::instrument_economic_terms_v1::{
    InstrumentEconomicTermsErrorV1, InstrumentEconomicTermsFactV1,
    InstrumentEconomicTermsLocatorV1, InstrumentEconomicTermsReadbackV1,
    InstrumentEconomicTermsReceiptV1,
};

const CUSTODY_DOMAIN: &[u8] = b"instrument-owner.private-economic-terms.custody.v1\0";
const ADVISORY_LOCK_KEY: i64 = 0x4945_5456_3100_0001;

const SCHEMA: [&str; 7] = [
    "CREATE SCHEMA IF NOT EXISTS instrument_owner_private",
    "REVOKE ALL ON SCHEMA instrument_owner_private FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS instrument_owner_private.economic_terms_facts_v1 (fact_identity BYTEA PRIMARY KEY CHECK(octet_length(fact_identity)=32), meaning_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(meaning_identity)=32), fact_bytes BYTEA NOT NULL CHECK(octet_length(fact_bytes)>0 AND octet_length(fact_bytes)<=32768), custody_digest BYTEA NOT NULL CHECK(octet_length(custody_digest)=32))",
    "CREATE TABLE IF NOT EXISTS instrument_owner_private.economic_terms_receipts_v1 (receipt_identity BYTEA PRIMARY KEY CHECK(octet_length(receipt_identity)=32), fact_identity BYTEA UNIQUE NOT NULL REFERENCES instrument_owner_private.economic_terms_facts_v1(fact_identity) ON DELETE RESTRICT, receipt_bytes BYTEA NOT NULL CHECK(octet_length(receipt_bytes)=66), custody_digest BYTEA NOT NULL CHECK(octet_length(custody_digest)=32))",
    "REVOKE ALL ON TABLE instrument_owner_private.economic_terms_facts_v1 FROM PUBLIC",
    "REVOKE ALL ON TABLE instrument_owner_private.economic_terms_receipts_v1 FROM PUBLIC",
    "REVOKE ALL ON ALL SEQUENCES IN SCHEMA instrument_owner_private FROM PUBLIC",
];

/// Exact private-store authority. The pool credential is retained and never exposed.
#[derive(Clone, Debug)]
pub struct InstrumentEconomicTermsPostgresOwnerV1 {
    pool: PgPool,
}

impl InstrumentEconomicTermsPostgresOwnerV1 {
    /// Installs the private schema using the connected Instrument Owner principal.
    ///
    /// # Errors
    ///
    /// Returns a redacted store or ACL failure when private custody cannot be established.
    pub async fn install(pool: PgPool) -> Result<Self, InstrumentEconomicTermsPostgresErrorV1> {
        for statement in SCHEMA {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .map_err(store_error)?;
        }
        let owner = Self { pool };
        owner.assert_acl().await?;
        Ok(owner)
    }

    /// Atomically issues a receipt, or byte-identically replays the existing exact meaning.
    ///
    /// # Errors
    ///
    /// Returns before commit for store/ACL failure, meaning conflict, or corrupt prior custody.
    pub async fn issue(
        &self,
        fact: &InstrumentEconomicTermsFactV1,
    ) -> Result<InstrumentEconomicTermsReadbackV1, InstrumentEconomicTermsPostgresErrorV1> {
        let mut tx = self.pool.begin().await.map_err(store_error)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *tx)
            .await
            .map_err(store_error)?;
        assert_acl_in_transaction(&mut tx).await?;
        sqlx::query("SELECT pg_advisory_xact_lock($1)")
            .bind(ADVISORY_LOCK_KEY)
            .execute(&mut *tx)
            .await
            .map_err(store_error)?;

        if let Some(row) = sqlx::query(
            "SELECT f.fact_identity,f.fact_bytes,f.custody_digest,r.receipt_identity,r.receipt_bytes,r.custody_digest AS receipt_custody_digest FROM instrument_owner_private.economic_terms_facts_v1 f JOIN instrument_owner_private.economic_terms_receipts_v1 r ON r.fact_identity=f.fact_identity WHERE f.meaning_identity=$1",
        ).bind(fact.meaning_identity().as_slice()).fetch_optional(&mut *tx).await.map_err(store_error)? {
            let readback = decode_row(&row)?;
            if readback.fact().canonical_bytes() != fact.canonical_bytes() {
                return Err(InstrumentEconomicTermsPostgresErrorV1::MeaningConflict);
            }
            tx.commit().await.map_err(store_error)?;
            return Ok(readback);
        }

        let receipt = InstrumentEconomicTermsReceiptV1::issue(fact);
        let custody = custody_digest(fact.canonical_bytes(), receipt.canonical_bytes());
        sqlx::query("INSERT INTO instrument_owner_private.economic_terms_facts_v1(fact_identity,meaning_identity,fact_bytes,custody_digest) VALUES($1,$2,$3,$4)")
            .bind(fact.identity().as_slice()).bind(fact.meaning_identity().as_slice())
            .bind(fact.canonical_bytes()).bind(custody.as_slice())
            .execute(&mut *tx).await.map_err(classify_insert)?;
        sqlx::query("INSERT INTO instrument_owner_private.economic_terms_receipts_v1(receipt_identity,fact_identity,receipt_bytes,custody_digest) VALUES($1,$2,$3,$4)")
            .bind(receipt.identity().as_slice()).bind(fact.identity().as_slice())
            .bind(receipt.canonical_bytes()).bind(custody.as_slice())
            .execute(&mut *tx).await.map_err(classify_insert)?;
        tx.commit().await.map_err(store_error)?;
        InstrumentEconomicTermsReadbackV1::from_parts(fact.clone(), receipt)
            .map_err(|_| InstrumentEconomicTermsPostgresErrorV1::CorruptReadback)
    }

    /// Resolves only one exact fact-and-receipt locator and validates all durable bytes.
    ///
    /// # Errors
    ///
    /// Returns for unknown locator, store/ACL failure, or corrupt/cross-spliced durable bytes.
    pub async fn resolve(
        &self,
        locator: InstrumentEconomicTermsLocatorV1,
    ) -> Result<InstrumentEconomicTermsReadbackV1, InstrumentEconomicTermsPostgresErrorV1> {
        self.assert_acl().await?;
        let row = sqlx::query(
            "SELECT f.fact_identity,f.fact_bytes,f.custody_digest,r.receipt_identity,r.receipt_bytes,r.custody_digest AS receipt_custody_digest FROM instrument_owner_private.economic_terms_facts_v1 f JOIN instrument_owner_private.economic_terms_receipts_v1 r ON r.fact_identity=f.fact_identity WHERE f.fact_identity=$1 AND r.receipt_identity=$2",
        ).bind(locator.fact_identity().as_slice()).bind(locator.receipt_identity().as_slice())
            .fetch_optional(&self.pool).await.map_err(store_error)?
            .ok_or(InstrumentEconomicTermsPostgresErrorV1::UnknownLocator)?;
        decode_row(&row)
    }

    async fn assert_acl(&self) -> Result<(), InstrumentEconomicTermsPostgresErrorV1> {
        let mut tx = self.pool.begin().await.map_err(store_error)?;
        assert_acl_in_transaction(&mut tx).await?;
        tx.rollback().await.map_err(store_error)
    }
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum InstrumentEconomicTermsPostgresErrorV1 {
    #[error("Instrument economic terms store is unavailable")]
    StoreUnavailable,
    #[error("Instrument economic terms store ACL is unavailable or drifted")]
    AclUnavailable,
    #[error("Instrument economic terms exact locator is unknown")]
    UnknownLocator,
    #[error("Instrument economic terms meaning conflicts with durable content")]
    MeaningConflict,
    #[error("Instrument economic terms durable readback is corrupt or cross-spliced")]
    CorruptReadback,
}

async fn assert_acl_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
) -> Result<(), InstrumentEconomicTermsPostgresErrorV1> {
    let admitted: bool = sqlx::query_scalar(
        "SELECT pg_get_userbyid(n.nspowner)=current_user AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a WHERE a.grantee=0 AND a.privilege_type IN ('USAGE','CREATE')) AND NOT EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.relnamespace=n.oid AND c.relname IN ('economic_terms_facts_v1','economic_terms_receipts_v1') AND a.grantee=0 AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')) AND has_table_privilege(current_user,'instrument_owner_private.economic_terms_facts_v1','SELECT,INSERT,UPDATE,DELETE') AND has_table_privilege(current_user,'instrument_owner_private.economic_terms_receipts_v1','SELECT,INSERT,UPDATE,DELETE') FROM pg_namespace n WHERE n.nspname='instrument_owner_private'",
    ).fetch_one(&mut **tx).await.map_err(store_error)?;

    if admitted {
        Ok(())
    } else {
        Err(InstrumentEconomicTermsPostgresErrorV1::AclUnavailable)
    }
}

fn decode_row(
    row: &sqlx::postgres::PgRow,
) -> Result<InstrumentEconomicTermsReadbackV1, InstrumentEconomicTermsPostgresErrorV1> {
    let fact_identity: Vec<u8> = row.try_get("fact_identity").map_err(store_error)?;
    let fact_bytes: Vec<u8> = row.try_get("fact_bytes").map_err(store_error)?;
    let fact_custody: Vec<u8> = row.try_get("custody_digest").map_err(store_error)?;
    let receipt_identity: Vec<u8> = row.try_get("receipt_identity").map_err(store_error)?;
    let receipt_bytes: Vec<u8> = row.try_get("receipt_bytes").map_err(store_error)?;
    let receipt_custody: Vec<u8> = row.try_get("receipt_custody_digest").map_err(store_error)?;
    let fact = InstrumentEconomicTermsFactV1::parse_canonical(&fact_bytes).map_err(corrupt)?;
    let receipt = InstrumentEconomicTermsReceiptV1::parse(&receipt_bytes).map_err(corrupt)?;
    let custody = custody_digest(&fact_bytes, &receipt_bytes);

    if fact_identity.as_slice() != fact.identity().as_slice()
        || receipt_identity.as_slice() != receipt.identity().as_slice()
        || fact_custody.as_slice() != custody.as_slice()
        || receipt_custody.as_slice() != custody.as_slice()
    {
        return Err(InstrumentEconomicTermsPostgresErrorV1::CorruptReadback);
    }
    InstrumentEconomicTermsReadbackV1::from_parts(fact, receipt).map_err(corrupt)
}

fn custody_digest(fact: &[u8], receipt: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(CUSTODY_DOMAIN);
    h.update((fact.len() as u32).to_be_bytes());
    h.update(fact);
    h.update(receipt);
    h.finalize().into()
}
fn corrupt(_: InstrumentEconomicTermsErrorV1) -> InstrumentEconomicTermsPostgresErrorV1 {
    InstrumentEconomicTermsPostgresErrorV1::CorruptReadback
}
fn store_error(_: sqlx::Error) -> InstrumentEconomicTermsPostgresErrorV1 {
    InstrumentEconomicTermsPostgresErrorV1::StoreUnavailable
}
fn classify_insert(error: sqlx::Error) -> InstrumentEconomicTermsPostgresErrorV1 {
    if error
        .as_database_error()
        .and_then(sqlx::error::DatabaseError::code)
        .is_some_and(|code| code == "23505")
    {
        InstrumentEconomicTermsPostgresErrorV1::MeaningConflict
    } else {
        store_error(error)
    }
}
