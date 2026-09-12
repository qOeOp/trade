//! PostgreSQL custody for private Instrument Owner economic terms.
//!
//! Issue is one SERIALIZABLE transaction containing the fact and its deterministic receipt.
//! Recovery requires both exact identities; there is no latest scan or generic query surface.
//! The Owner can be constructed only through the configured bootstrap in [`super`]; a caller-chosen
//! pool is not Instrument Owner authority.
//!
//! ```compile_fail
//! use vibe_data::owner::instrument_economic_terms_postgres_v1::InstrumentEconomicTermsPostgresOwnerV1;
//! let _ = InstrumentEconomicTermsPostgresOwnerV1::install;
//! ```

use std::collections::BTreeMap;

use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use thiserror::Error;

use super::instrument_economic_terms_v1::{
    InstrumentEconomicTermsErrorV1, InstrumentEconomicTermsFactV1,
    InstrumentEconomicTermsLocatorV1, InstrumentEconomicTermsReadbackV1,
    InstrumentEconomicTermsReceiptV1,
};
use super::instrument_master_v2::{FactValue, InstrumentMasterReadbackV2};

const CUSTODY_DOMAIN: &[u8] = b"instrument-owner.private-economic-terms.custody.v1\0";
const ADVISORY_LOCK_KEY: i64 = 0x4945_5456_3100_0001;
pub(super) const INSTRUMENT_OWNER_DATABASE_URL_ENV: &str = "INSTRUMENT_OWNER_DATABASE_URL";

const SCHEMA: [&str; 11] = [
    "CREATE SCHEMA IF NOT EXISTS instrument_owner_private",
    "REVOKE ALL ON SCHEMA instrument_owner_private FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS instrument_owner_private.economic_terms_facts_v1 (fact_identity BYTEA PRIMARY KEY CHECK(octet_length(fact_identity)=32), meaning_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(meaning_identity)=32), fact_bytes BYTEA NOT NULL CHECK(octet_length(fact_bytes)>0 AND octet_length(fact_bytes)<=32768), custody_digest BYTEA NOT NULL CHECK(octet_length(custody_digest)=32))",
    "CREATE TABLE IF NOT EXISTS instrument_owner_private.economic_terms_receipts_v1 (receipt_identity BYTEA PRIMARY KEY CHECK(octet_length(receipt_identity)=32), fact_identity BYTEA UNIQUE NOT NULL REFERENCES instrument_owner_private.economic_terms_facts_v1(fact_identity) ON DELETE RESTRICT, receipt_bytes BYTEA NOT NULL CHECK(octet_length(receipt_bytes)=66), custody_digest BYTEA NOT NULL CHECK(octet_length(custody_digest)=32))",
    "CREATE TABLE IF NOT EXISTS instrument_owner_private.economic_terms_selection_v1 (fact_identity BYTEA PRIMARY KEY REFERENCES instrument_owner_private.economic_terms_facts_v1(fact_identity) ON DELETE RESTRICT, instrument_identity TEXT NOT NULL CHECK(length(instrument_identity)>0 AND length(instrument_identity)<=256), venue_identity TEXT NOT NULL CHECK(length(venue_identity)>0 AND length(venue_identity)<=256), account_scope_identity TEXT NOT NULL CHECK(length(account_scope_identity)>0 AND length(account_scope_identity)<=256), quote_currency TEXT NOT NULL CHECK(length(quote_currency)>0 AND length(quote_currency)<=256))",
    "INSERT INTO instrument_owner_private.economic_terms_selection_v1(fact_identity,instrument_identity,venue_identity,account_scope_identity,quote_currency) SELECT f.fact_identity,p.value->>'instrument_identity',p.value->>'venue_identity',p.value->>'account_scope_identity',p.value->>'quote_currency' FROM instrument_owner_private.economic_terms_facts_v1 f CROSS JOIN LATERAL (SELECT convert_from(f.fact_bytes,'UTF8')::jsonb AS value) p ON TRUE ON CONFLICT (fact_identity) DO NOTHING",
    "CREATE INDEX IF NOT EXISTS economic_terms_selection_lookup_v1 ON instrument_owner_private.economic_terms_selection_v1(instrument_identity,venue_identity,quote_currency,account_scope_identity)",
    "REVOKE ALL ON TABLE instrument_owner_private.economic_terms_facts_v1 FROM PUBLIC",
    "REVOKE ALL ON TABLE instrument_owner_private.economic_terms_receipts_v1 FROM PUBLIC",
    "REVOKE ALL ON TABLE instrument_owner_private.economic_terms_selection_v1 FROM PUBLIC",
    "REVOKE ALL ON ALL SEQUENCES IN SCHEMA instrument_owner_private FROM PUBLIC",
];

/// Exact private-store authority. The pool credential is retained and never exposed.
#[derive(Clone, Debug)]
pub struct InstrumentEconomicTermsPostgresOwnerV1 {
    pool: PgPool,
}

impl InstrumentEconomicTermsPostgresOwnerV1 {
    /// Installs the private schema using the already-configured Instrument Owner principal.
    ///
    /// # Errors
    ///
    /// Returns a redacted store or ACL failure when private custody cannot be established.
    pub(super) async fn install(
        pool: PgPool,
    ) -> Result<Self, InstrumentEconomicTermsPostgresErrorV1> {
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
        lock_protected_tables_in_transaction(&mut tx).await?;
        assert_acl_in_transaction(&mut tx).await?;
        sqlx::query("SELECT pg_advisory_xact_lock($1)")
            .bind(ADVISORY_LOCK_KEY)
            .execute(&mut *tx)
            .await
            .map_err(store_error)?;

        assert_complete_ledger_in_transaction(&mut tx).await?;

        let rows = sqlx::query(
            "SELECT f.fact_identity,f.meaning_identity,f.fact_bytes,f.custody_digest,r.receipt_identity,r.receipt_bytes,r.custody_digest AS receipt_custody_digest,s.instrument_identity AS selection_instrument_identity,s.venue_identity AS selection_venue_identity,s.account_scope_identity AS selection_account_scope_identity,s.quote_currency AS selection_quote_currency FROM instrument_owner_private.economic_terms_facts_v1 f JOIN instrument_owner_private.economic_terms_receipts_v1 r ON r.fact_identity=f.fact_identity JOIN instrument_owner_private.economic_terms_selection_v1 s ON s.fact_identity=f.fact_identity",
        ).fetch_all(&mut *tx).await.map_err(store_error)?;

        for row in rows {
            let readback = decode_row(&row)?;
            if readback.fact().meaning_identity() == fact.meaning_identity() {
                if readback.fact().canonical_bytes() != fact.canonical_bytes() {
                    return Err(InstrumentEconomicTermsPostgresErrorV1::MeaningConflict);
                }
                tx.commit().await.map_err(store_error)?;
                return Ok(readback);
            }
        }

        let receipt = InstrumentEconomicTermsReceiptV1::issue(fact);
        let custody = custody_digest(fact.canonical_bytes(), receipt.canonical_bytes());
        let fact_insert = sqlx::query("INSERT INTO instrument_owner_private.economic_terms_facts_v1(fact_identity,meaning_identity,fact_bytes,custody_digest) VALUES($1,$2,$3,$4)")
            .bind(fact.identity().as_slice()).bind(fact.meaning_identity().as_slice())
            .bind(fact.canonical_bytes()).bind(custody.as_slice())
            .execute(&mut *tx).await.map_err(classify_insert)?;
        let receipt_insert = sqlx::query("INSERT INTO instrument_owner_private.economic_terms_receipts_v1(receipt_identity,fact_identity,receipt_bytes,custody_digest) VALUES($1,$2,$3,$4)")
            .bind(receipt.identity().as_slice()).bind(fact.identity().as_slice())
            .bind(receipt.canonical_bytes()).bind(custody.as_slice())
            .execute(&mut *tx).await.map_err(classify_insert)?;
        let input = fact.input();
        let selection_insert = sqlx::query("INSERT INTO instrument_owner_private.economic_terms_selection_v1(fact_identity,instrument_identity,venue_identity,account_scope_identity,quote_currency) VALUES($1,$2,$3,$4,$5)")
            .bind(fact.identity().as_slice()).bind(&input.instrument_identity)
            .bind(&input.venue_identity).bind(&input.account_scope_identity)
            .bind(&input.quote_currency)
            .execute(&mut *tx).await.map_err(classify_insert)?;

        if fact_insert.rows_affected() != 1
            || receipt_insert.rows_affected() != 1
            || selection_insert.rows_affected() != 1
        {
            return Err(InstrumentEconomicTermsPostgresErrorV1::CorruptReadback);
        }
        assert_complete_ledger_in_transaction(&mut tx).await?;
        let readback = resolve_in_transaction(
            &mut tx,
            InstrumentEconomicTermsLocatorV1::from_identities(fact.identity(), receipt.identity())
                .map_err(corrupt)?,
        )
        .await?;
        tx.commit().await.map_err(store_error)?;
        Ok(readback)
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
        let mut tx = self.pool.begin().await.map_err(store_error)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            .execute(&mut *tx)
            .await
            .map_err(store_error)?;
        lock_protected_tables_in_transaction(&mut tx).await?;
        assert_acl_in_transaction(&mut tx).await?;
        assert_complete_ledger_in_transaction(&mut tx).await?;
        let readback = resolve_in_transaction(&mut tx, locator).await?;
        tx.commit().await.map_err(store_error)?;
        Ok(readback)
    }

    /// Resolves the unique same-account economic pair for one verified Native Replay public cut.
    ///
    /// Instrument identities and public fact digests come only from the move-only Master V2
    /// readback. The consumer contributes the already-sealed Replay profile venue/common quote and
    /// request start time, but cannot choose an account scope or an economic-terms locator.
    ///
    /// # Errors
    ///
    /// Returns before readback when custody is corrupt, no complete pair is valid, or more than one
    /// fact/pair could satisfy the same sealed execution context.
    pub async fn resolve_unique_native_replay_pair(
        &self,
        instrument_master: &InstrumentMasterReadbackV2,
        venue_identity: &str,
        quote_currency: &str,
        event_time_ns: i128,
    ) -> Result<[InstrumentEconomicTermsReadbackV1; 2], InstrumentEconomicTermsPostgresErrorV1>
    {
        if !valid_selector_text(venue_identity) || !valid_selector_text(quote_currency) {
            return Err(InstrumentEconomicTermsPostgresErrorV1::InvalidSelection);
        }
        let members = instrument_master.cut().members();
        if members.iter().any(|member| {
            member.fact().venue_identity() != venue_identity
                || member.fact().terms().quote_currency
                    != FactValue::Value(quote_currency.to_owned())
        }) {
            return Err(InstrumentEconomicTermsPostgresErrorV1::UnknownSelection);
        }
        let identities = [
            members[0].fact().canonical_identity(),
            members[1].fact().canonical_identity(),
        ];

        let mut tx = self.pool.begin().await.map_err(store_error)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            .execute(&mut *tx)
            .await
            .map_err(store_error)?;
        lock_protected_tables_in_transaction(&mut tx).await?;
        assert_acl_in_transaction(&mut tx).await?;
        assert_complete_ledger_in_transaction(&mut tx).await?;
        let rows = sqlx::query(
            "SELECT f.fact_identity,f.meaning_identity,f.fact_bytes,f.custody_digest,r.receipt_identity,r.receipt_bytes,r.custody_digest AS receipt_custody_digest,s.instrument_identity AS selection_instrument_identity,s.venue_identity AS selection_venue_identity,s.account_scope_identity AS selection_account_scope_identity,s.quote_currency AS selection_quote_currency FROM instrument_owner_private.economic_terms_selection_v1 s JOIN instrument_owner_private.economic_terms_facts_v1 f ON f.fact_identity=s.fact_identity JOIN instrument_owner_private.economic_terms_receipts_v1 r ON r.fact_identity=f.fact_identity WHERE (s.instrument_identity=$1 OR s.instrument_identity=$2) AND s.venue_identity=$3 AND s.quote_currency=$4 ORDER BY f.fact_identity",
        )
        .bind(identities[0])
        .bind(identities[1])
        .bind(venue_identity)
        .bind(quote_currency)
        .fetch_all(&mut *tx)
        .await
        .map_err(store_error)?;

        let expected_digests = [
            *members[0].fact().identity().as_bytes(),
            *members[1].fact().identity().as_bytes(),
        ];
        let mut readbacks = Vec::with_capacity(rows.len());
        let mut by_scope: BTreeMap<String, [Vec<usize>; 2]> = BTreeMap::new();
        for row in rows {
            let readback = decode_row(&row)?;
            let input = readback.fact().input();
            let member_index = identities.iter().enumerate().find_map(|(index, identity)| {
                (*identity == input.instrument_identity
                    && expected_digests[index] == input.instrument_public_fact_digest)
                    .then_some(index)
            });
            if let Some(member_index) = member_index
                && input.venue_identity == venue_identity
                && input.quote_currency == quote_currency
                && event_time_ns >= input.valid_from_ns
                && event_time_ns < input.valid_until_ns_exclusive
            {
                let index = readbacks.len();
                by_scope
                    .entry(input.account_scope_identity.clone())
                    .or_insert_with(|| [Vec::new(), Vec::new()])[member_index]
                    .push(index);
            }
            readbacks.push(Some(readback));
        }

        let complete: Vec<_> = by_scope
            .values()
            .filter(|members| !members[0].is_empty() && !members[1].is_empty())
            .collect();
        let pair = match complete.as_slice() {
            [] => return Err(InstrumentEconomicTermsPostgresErrorV1::UnknownSelection),
            [pair] if pair[0].len() == 1 && pair[1].len() == 1 => [pair[0][0], pair[1][0]],
            _ => return Err(InstrumentEconomicTermsPostgresErrorV1::AmbiguousSelection),
        };
        let first = readbacks[pair[0]]
            .take()
            .ok_or(InstrumentEconomicTermsPostgresErrorV1::CorruptReadback)?;
        let second = readbacks[pair[1]]
            .take()
            .ok_or(InstrumentEconomicTermsPostgresErrorV1::CorruptReadback)?;
        tx.commit().await.map_err(store_error)?;
        Ok([first, second])
    }

    async fn assert_acl(&self) -> Result<(), InstrumentEconomicTermsPostgresErrorV1> {
        let mut tx = self.pool.begin().await.map_err(store_error)?;
        assert_acl_in_transaction(&mut tx).await?;
        tx.rollback().await.map_err(store_error)
    }
}

async fn resolve_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
    locator: InstrumentEconomicTermsLocatorV1,
) -> Result<InstrumentEconomicTermsReadbackV1, InstrumentEconomicTermsPostgresErrorV1> {
    let row = sqlx::query(
        "SELECT f.fact_identity,f.meaning_identity,f.fact_bytes,f.custody_digest,r.receipt_identity,r.receipt_bytes,r.custody_digest AS receipt_custody_digest FROM instrument_owner_private.economic_terms_facts_v1 f JOIN instrument_owner_private.economic_terms_receipts_v1 r ON r.fact_identity=f.fact_identity WHERE f.fact_identity=$1 AND r.receipt_identity=$2",
    ).bind(locator.fact_identity().as_slice()).bind(locator.receipt_identity().as_slice())
        .fetch_optional(&mut **tx).await.map_err(store_error)?
        .ok_or(InstrumentEconomicTermsPostgresErrorV1::UnknownLocator)?;
    decode_row(&row)
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum InstrumentEconomicTermsPostgresErrorV1 {
    #[error("Instrument economic terms store configuration is unavailable")]
    ConfigurationUnavailable,
    #[error("Instrument economic terms store is unavailable")]
    StoreUnavailable,
    #[error("Instrument economic terms store ACL is unavailable or drifted")]
    AclUnavailable,
    #[error("Instrument economic terms exact locator is unknown")]
    UnknownLocator,
    #[error("Instrument economic terms Native Replay selection is invalid")]
    InvalidSelection,
    #[error("Instrument economic terms Native Replay pair is unavailable")]
    UnknownSelection,
    #[error("Instrument economic terms Native Replay pair is ambiguous")]
    AmbiguousSelection,
    #[error("Instrument economic terms meaning conflicts with durable content")]
    MeaningConflict,
    #[error("Instrument economic terms durable readback is corrupt or cross-spliced")]
    CorruptReadback,
}

async fn lock_protected_tables_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
) -> Result<(), InstrumentEconomicTermsPostgresErrorV1> {
    sqlx::query(
        "LOCK TABLE instrument_owner_private.economic_terms_facts_v1, instrument_owner_private.economic_terms_receipts_v1, instrument_owner_private.economic_terms_selection_v1 IN SHARE ROW EXCLUSIVE MODE",
    )
    .execute(&mut **tx)
    .await
    .map_err(store_error)?;
    Ok(())
}

async fn assert_acl_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
) -> Result<(), InstrumentEconomicTermsPostgresErrorV1> {
    let admitted: bool = sqlx::query_scalar(
        "
        WITH RECURSIVE set_role_reachability(login_oid,role_oid,path) AS (
          SELECT login.oid,login.oid,ARRAY[login.oid]
          FROM pg_roles login
          WHERE login.rolcanlogin AND NOT login.rolsuper
          UNION ALL
          SELECT reachable.login_oid,membership.roleid,reachable.path||membership.roleid
          FROM set_role_reachability reachable
          JOIN pg_auth_members membership ON membership.member=reachable.role_oid
          WHERE membership.set_option AND NOT membership.roleid=ANY(reachable.path)
        )
        SELECT pg_get_userbyid(n.nspowner)=current_user
          AND NOT EXISTS (
            SELECT 1
            FROM aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a
            WHERE a.grantee<>n.nspowner AND a.privilege_type IN ('USAGE','CREATE')
          )
          AND 3=(
            SELECT count(*)
            FROM pg_class c
            WHERE c.relnamespace=n.oid AND c.relkind='r'
              AND c.relname IN ('economic_terms_facts_v1','economic_terms_receipts_v1','economic_terms_selection_v1')
              AND c.relowner=n.nspowner
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_inherits inheritance
            JOIN pg_class protected_table ON protected_table.oid=inheritance.inhparent
            WHERE protected_table.relnamespace=n.oid
              AND protected_table.relname IN ('economic_terms_facts_v1','economic_terms_receipts_v1','economic_terms_selection_v1')
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_class c
            CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
            WHERE c.relnamespace=n.oid
              AND c.relname IN ('economic_terms_facts_v1','economic_terms_receipts_v1','economic_terms_selection_v1')
              AND a.grantee<>c.relowner
              AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_class c
            JOIN pg_attribute column_acl ON column_acl.attrelid=c.oid
            CROSS JOIN LATERAL aclexplode(column_acl.attacl) a
            WHERE c.relnamespace=n.oid
              AND c.relname IN ('economic_terms_facts_v1','economic_terms_receipts_v1','economic_terms_selection_v1')
              AND column_acl.attnum>0
              AND NOT column_acl.attisdropped
              AND a.grantee<>c.relowner
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_trigger protected_trigger
            JOIN pg_class c ON c.oid=protected_trigger.tgrelid
            WHERE c.relnamespace=n.oid
              AND c.relname IN ('economic_terms_facts_v1','economic_terms_receipts_v1','economic_terms_selection_v1')
              AND NOT protected_trigger.tgisinternal
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_roles login
            WHERE login.rolcanlogin AND NOT login.rolsuper AND login.oid<>n.nspowner
              AND (
                pg_has_role(login.oid,n.nspowner,'MEMBER')
                OR EXISTS (
                  SELECT 1
                  FROM set_role_reachability reachable
                  WHERE reachable.login_oid=login.oid
                    AND (
                      has_schema_privilege(reachable.role_oid,n.oid,'CREATE')
                      OR EXISTS (
                        SELECT 1
                        FROM pg_class protected_table
                        WHERE protected_table.relnamespace=n.oid
                          AND protected_table.relname IN ('economic_terms_facts_v1','economic_terms_receipts_v1','economic_terms_selection_v1')
                          AND (
                            has_table_privilege(reachable.role_oid,protected_table.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                            OR has_any_column_privilege(reachable.role_oid,protected_table.oid,'SELECT,INSERT,UPDATE,REFERENCES')
                          )
                      )
                    )
                )
              )
          )
          AND has_table_privilege(current_user,'instrument_owner_private.economic_terms_facts_v1','SELECT,INSERT,UPDATE,DELETE')
          AND has_table_privilege(current_user,'instrument_owner_private.economic_terms_receipts_v1','SELECT,INSERT,UPDATE,DELETE')
          AND has_table_privilege(current_user,'instrument_owner_private.economic_terms_selection_v1','SELECT,INSERT,UPDATE,DELETE')
        FROM pg_namespace n WHERE n.nspname='instrument_owner_private'
        ",
    ).fetch_one(&mut **tx).await.map_err(store_error)?;

    if admitted {
        Ok(())
    } else {
        Err(InstrumentEconomicTermsPostgresErrorV1::AclUnavailable)
    }
}

async fn assert_complete_ledger_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
) -> Result<(), InstrumentEconomicTermsPostgresErrorV1> {
    let has_orphan: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM instrument_owner_private.economic_terms_facts_v1 f LEFT JOIN instrument_owner_private.economic_terms_receipts_v1 r ON r.fact_identity=f.fact_identity LEFT JOIN instrument_owner_private.economic_terms_selection_v1 s ON s.fact_identity=f.fact_identity WHERE r.receipt_identity IS NULL OR s.fact_identity IS NULL UNION ALL SELECT 1 FROM instrument_owner_private.economic_terms_receipts_v1 r LEFT JOIN instrument_owner_private.economic_terms_facts_v1 f ON f.fact_identity=r.fact_identity WHERE f.fact_identity IS NULL UNION ALL SELECT 1 FROM instrument_owner_private.economic_terms_selection_v1 s LEFT JOIN instrument_owner_private.economic_terms_facts_v1 f ON f.fact_identity=s.fact_identity WHERE f.fact_identity IS NULL)",
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(store_error)?;

    if has_orphan {
        Err(InstrumentEconomicTermsPostgresErrorV1::CorruptReadback)
    } else {
        Ok(())
    }
}

fn decode_row(
    row: &sqlx::postgres::PgRow,
) -> Result<InstrumentEconomicTermsReadbackV1, InstrumentEconomicTermsPostgresErrorV1> {
    let fact_identity: Vec<u8> = row.try_get("fact_identity").map_err(store_error)?;
    let meaning_identity: Vec<u8> = row.try_get("meaning_identity").map_err(store_error)?;
    let fact_bytes: Vec<u8> = row.try_get("fact_bytes").map_err(store_error)?;
    let fact_custody: Vec<u8> = row.try_get("custody_digest").map_err(store_error)?;
    let receipt_identity: Vec<u8> = row.try_get("receipt_identity").map_err(store_error)?;
    let receipt_bytes: Vec<u8> = row.try_get("receipt_bytes").map_err(store_error)?;
    let receipt_custody: Vec<u8> = row.try_get("receipt_custody_digest").map_err(store_error)?;
    let selection_instrument_identity: String = row
        .try_get("selection_instrument_identity")
        .map_err(store_error)?;
    let selection_venue_identity: String = row
        .try_get("selection_venue_identity")
        .map_err(store_error)?;
    let selection_account_scope_identity: String = row
        .try_get("selection_account_scope_identity")
        .map_err(store_error)?;
    let selection_quote_currency: String = row
        .try_get("selection_quote_currency")
        .map_err(store_error)?;
    let fact = InstrumentEconomicTermsFactV1::parse_canonical(&fact_bytes).map_err(corrupt)?;
    let receipt = InstrumentEconomicTermsReceiptV1::parse(&receipt_bytes).map_err(corrupt)?;
    let custody = custody_digest(&fact_bytes, &receipt_bytes);

    if fact_identity.as_slice() != fact.identity().as_slice()
        || meaning_identity.as_slice() != fact.meaning_identity().as_slice()
        || receipt_identity.as_slice() != receipt.identity().as_slice()
        || fact_custody.as_slice() != custody.as_slice()
        || receipt_custody.as_slice() != custody.as_slice()
        || selection_instrument_identity != fact.input().instrument_identity
        || selection_venue_identity != fact.input().venue_identity
        || selection_account_scope_identity != fact.input().account_scope_identity
        || selection_quote_currency != fact.input().quote_currency
    {
        return Err(InstrumentEconomicTermsPostgresErrorV1::CorruptReadback);
    }
    InstrumentEconomicTermsReadbackV1::from_parts(fact, receipt).map_err(corrupt)
}

fn valid_selector_text(value: &str) -> bool {
    !value.is_empty() && value.len() <= 256 && value.is_ascii() && value.trim() == value
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
