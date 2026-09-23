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
use std::fmt::Debug;

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
    // `CREATE SCHEMA IF NOT EXISTS` checks database `CREATE` before it checks existence, so it
    // fails for an Owner that holds no database-level `CREATE` even when the schema is already
    // provisioned and that same Owner owns it. This Owner's role does hold that grant today and
    // provisions this schema itself, unlike the Market Data roles, so asking about existence first
    // is not what makes it work now. It is what stops the statement from deciding whether this
    // Owner may ever run under a role that is granted its schema instead of the database.
    //
    // The choice of role is not reversible: the ACL assertion below requires `current_user` to own
    // this schema, so a second role reading a schema the first created is refused at open.
    "DO $instrument_owner_private_schema$ BEGIN IF pg_catalog.to_regnamespace('instrument_owner_private') IS NULL THEN EXECUTE 'CREATE SCHEMA instrument_owner_private'; END IF; END $instrument_owner_private_schema$",
    "REVOKE ALL ON SCHEMA instrument_owner_private FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS instrument_owner_private.economic_terms_facts_v1 (fact_identity BYTEA PRIMARY KEY CHECK(octet_length(fact_identity)=32), meaning_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(meaning_identity)=32), fact_bytes BYTEA NOT NULL CHECK(octet_length(fact_bytes)>0 AND octet_length(fact_bytes)<=32768), custody_digest BYTEA NOT NULL CHECK(octet_length(custody_digest)=32))",
    "CREATE TABLE IF NOT EXISTS instrument_owner_private.economic_terms_receipts_v1 (receipt_identity BYTEA PRIMARY KEY CHECK(octet_length(receipt_identity)=32), fact_identity BYTEA UNIQUE NOT NULL REFERENCES instrument_owner_private.economic_terms_facts_v1(fact_identity) ON DELETE RESTRICT, receipt_bytes BYTEA NOT NULL CHECK(octet_length(receipt_bytes)=66), custody_digest BYTEA NOT NULL CHECK(octet_length(custody_digest)=32))",
    "CREATE TABLE IF NOT EXISTS instrument_owner_private.economic_terms_selection_v1 (fact_identity BYTEA PRIMARY KEY REFERENCES instrument_owner_private.economic_terms_facts_v1(fact_identity) ON DELETE RESTRICT, instrument_identity TEXT NOT NULL CHECK(length(instrument_identity)>0 AND length(instrument_identity)<=256), venue_identity TEXT NOT NULL CHECK(length(venue_identity)>0 AND length(venue_identity)<=256), account_scope_identity TEXT NOT NULL CHECK(length(account_scope_identity)>0 AND length(account_scope_identity)<=256), quote_currency TEXT NOT NULL CHECK(length(quote_currency)>0 AND length(quote_currency)<=256))",
    "INSERT INTO instrument_owner_private.economic_terms_selection_v1(fact_identity,instrument_identity,venue_identity,account_scope_identity,quote_currency) SELECT f.fact_identity,p.value->>'instrument_identity',p.value->>'venue_identity',p.value->>'account_scope_identity',p.value->>'quote_currency' FROM instrument_owner_private.economic_terms_facts_v1 f CROSS JOIN LATERAL (SELECT convert_from(f.fact_bytes,'UTF8')::jsonb AS value) p ON CONFLICT (fact_identity) DO NOTHING",
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
                .map_err(|cause| store_error(&cause))?;
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
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|cause| store_error(&cause))?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *tx)
            .await
            .map_err(|cause| store_error(&cause))?;
        lock_protected_tables_in_transaction(&mut tx).await?;
        assert_acl_in_transaction(&mut tx).await?;
        sqlx::query("SELECT pg_advisory_xact_lock($1)")
            .bind(ADVISORY_LOCK_KEY)
            .execute(&mut *tx)
            .await
            .map_err(|cause| store_error(&cause))?;

        assert_complete_ledger_in_transaction(&mut tx).await?;

        let rows = sqlx::query(
            "SELECT f.fact_identity,f.meaning_identity,f.fact_bytes,f.custody_digest,r.receipt_identity,r.receipt_bytes,r.custody_digest AS receipt_custody_digest,s.instrument_identity AS selection_instrument_identity,s.venue_identity AS selection_venue_identity,s.account_scope_identity AS selection_account_scope_identity,s.quote_currency AS selection_quote_currency FROM instrument_owner_private.economic_terms_facts_v1 f JOIN instrument_owner_private.economic_terms_receipts_v1 r ON r.fact_identity=f.fact_identity JOIN instrument_owner_private.economic_terms_selection_v1 s ON s.fact_identity=f.fact_identity",
        ).fetch_all(&mut *tx).await.map_err(|cause| store_error(&cause))?;

        for row in rows {
            let readback = decode_row(&row)?;
            if readback.fact().meaning_identity() == fact.meaning_identity() {
                if readback.fact().canonical_bytes() != fact.canonical_bytes() {
                    return Err(InstrumentEconomicTermsPostgresErrorV1::MeaningConflict);
                }
                tx.commit().await.map_err(|cause| store_error(&cause))?;
                return Ok(readback);
            }
        }

        let receipt = InstrumentEconomicTermsReceiptV1::issue(fact);
        let custody = custody_digest(fact.canonical_bytes(), receipt.canonical_bytes());
        let fact_insert = sqlx::query("INSERT INTO instrument_owner_private.economic_terms_facts_v1(fact_identity,meaning_identity,fact_bytes,custody_digest) VALUES($1,$2,$3,$4)")
            .bind(fact.identity().as_slice()).bind(fact.meaning_identity().as_slice())
            .bind(fact.canonical_bytes()).bind(custody.as_slice())
            .execute(&mut *tx).await.map_err(|cause| classify_insert(&cause))?;
        let receipt_insert = sqlx::query("INSERT INTO instrument_owner_private.economic_terms_receipts_v1(receipt_identity,fact_identity,receipt_bytes,custody_digest) VALUES($1,$2,$3,$4)")
            .bind(receipt.identity().as_slice()).bind(fact.identity().as_slice())
            .bind(receipt.canonical_bytes()).bind(custody.as_slice())
            .execute(&mut *tx).await.map_err(|cause| classify_insert(&cause))?;
        let input = fact.input();
        let selection_insert = sqlx::query("INSERT INTO instrument_owner_private.economic_terms_selection_v1(fact_identity,instrument_identity,venue_identity,account_scope_identity,quote_currency) VALUES($1,$2,$3,$4,$5)")
            .bind(fact.identity().as_slice()).bind(&input.instrument_identity)
            .bind(&input.venue_identity).bind(&input.account_scope_identity)
            .bind(&input.quote_currency)
            .execute(&mut *tx).await.map_err(|cause| classify_insert(&cause))?;

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
        tx.commit().await.map_err(|cause| store_error(&cause))?;
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
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|cause| store_error(&cause))?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            .execute(&mut *tx)
            .await
            .map_err(|cause| store_error(&cause))?;
        lock_protected_tables_in_transaction(&mut tx).await?;
        assert_acl_in_transaction(&mut tx).await?;
        assert_complete_ledger_in_transaction(&mut tx).await?;
        let readback = resolve_in_transaction(&mut tx, locator).await?;
        tx.commit().await.map_err(|cause| store_error(&cause))?;
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
        // A pair is asked of a two-member cut; a one-member cut is answered by the member form.
        if instrument_master.cut().members().len() != 2 {
            return Err(InstrumentEconomicTermsPostgresErrorV1::InvalidSelection);
        }
        let [first, second]: [InstrumentEconomicTermsReadbackV1; 2] = self
            .resolve_unique_native_replay_members(
                instrument_master,
                venue_identity,
                quote_currency,
                event_time_ns,
            )
            .await?
            .try_into()
            .map_err(|_| InstrumentEconomicTermsPostgresErrorV1::CorruptReadback)?;
        Ok([first, second])
    }

    /// Resolves one economic-terms readback for each member of the cut, in the cut's member order.
    ///
    /// Every member must resolve under one shared account scope, exactly once; a member count of
    /// one is a single-instrument universe and resolves the same way.
    ///
    /// # Errors
    ///
    /// Returns before readback when custody is corrupt, no complete member set is valid, or more
    /// than one fact or account scope could satisfy the same sealed execution context.
    pub async fn resolve_unique_native_replay_members(
        &self,
        instrument_master: &InstrumentMasterReadbackV2,
        venue_identity: &str,
        quote_currency: &str,
        event_time_ns: i128,
    ) -> Result<Vec<InstrumentEconomicTermsReadbackV1>, InstrumentEconomicTermsPostgresErrorV1>
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
        let identities = members
            .iter()
            .map(|member| member.fact().canonical_identity())
            .collect::<Vec<_>>();

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|cause| store_error(&cause))?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            .execute(&mut *tx)
            .await
            .map_err(|cause| store_error(&cause))?;
        lock_protected_tables_in_transaction(&mut tx).await?;
        assert_acl_in_transaction(&mut tx).await?;
        assert_complete_ledger_in_transaction(&mut tx).await?;
        let rows = sqlx::query(
            "SELECT f.fact_identity,f.meaning_identity,f.fact_bytes,f.custody_digest,r.receipt_identity,r.receipt_bytes,r.custody_digest AS receipt_custody_digest,s.instrument_identity AS selection_instrument_identity,s.venue_identity AS selection_venue_identity,s.account_scope_identity AS selection_account_scope_identity,s.quote_currency AS selection_quote_currency FROM instrument_owner_private.economic_terms_selection_v1 s JOIN instrument_owner_private.economic_terms_facts_v1 f ON f.fact_identity=s.fact_identity JOIN instrument_owner_private.economic_terms_receipts_v1 r ON r.fact_identity=f.fact_identity WHERE s.instrument_identity=ANY($1) AND s.venue_identity=$2 AND s.quote_currency=$3 ORDER BY f.fact_identity",
        )
        .bind(&identities)
        .bind(venue_identity)
        .bind(quote_currency)
        .fetch_all(&mut *tx)
        .await
        .map_err(|cause| store_error(&cause))?;

        let expected_digests = members
            .iter()
            .map(|member| *member.fact().identity().as_bytes())
            .collect::<Vec<_>>();
        let mut readbacks = Vec::with_capacity(rows.len());
        let mut by_scope: BTreeMap<String, Vec<Vec<usize>>> = BTreeMap::new();

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
                    .or_insert_with(|| vec![Vec::new(); members.len()])[member_index]
                    .push(index);
            }
            readbacks.push(Some(readback));
        }

        let complete: Vec<_> = by_scope
            .values()
            .filter(|members| members.iter().all(|found| !found.is_empty()))
            .collect();
        let chosen = match complete.as_slice() {
            [] => return Err(InstrumentEconomicTermsPostgresErrorV1::UnknownSelection),
            [set] if set.iter().all(|found| found.len() == 1) => {
                set.iter().map(|found| found[0]).collect::<Vec<_>>()
            }
            _ => return Err(InstrumentEconomicTermsPostgresErrorV1::AmbiguousSelection),
        };
        let resolved = chosen
            .into_iter()
            .map(|index| {
                readbacks[index]
                    .take()
                    .ok_or(InstrumentEconomicTermsPostgresErrorV1::CorruptReadback)
            })
            .collect::<Result<Vec<_>, _>>()?;
        tx.commit().await.map_err(|cause| store_error(&cause))?;
        Ok(resolved)
    }

    async fn assert_acl(&self) -> Result<(), InstrumentEconomicTermsPostgresErrorV1> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|cause| store_error(&cause))?;
        assert_acl_in_transaction(&mut tx).await?;
        tx.rollback().await.map_err(|cause| store_error(&cause))
    }
}

async fn resolve_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
    locator: InstrumentEconomicTermsLocatorV1,
) -> Result<InstrumentEconomicTermsReadbackV1, InstrumentEconomicTermsPostgresErrorV1> {
    let row = sqlx::query(
        "SELECT f.fact_identity,f.meaning_identity,f.fact_bytes,f.custody_digest,r.receipt_identity,r.receipt_bytes,r.custody_digest AS receipt_custody_digest,s.instrument_identity AS selection_instrument_identity,s.venue_identity AS selection_venue_identity,s.account_scope_identity AS selection_account_scope_identity,s.quote_currency AS selection_quote_currency FROM instrument_owner_private.economic_terms_facts_v1 f JOIN instrument_owner_private.economic_terms_receipts_v1 r ON r.fact_identity=f.fact_identity JOIN instrument_owner_private.economic_terms_selection_v1 s ON s.fact_identity=f.fact_identity WHERE f.fact_identity=$1 AND r.receipt_identity=$2",
    ).bind(locator.fact_identity().as_slice()).bind(locator.receipt_identity().as_slice())
        .fetch_optional(&mut **tx).await.map_err(|cause| store_error(&cause))?
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
    .map_err(|cause| store_error(&cause))?;
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
    ).fetch_one(&mut **tx).await.map_err(|cause| store_error(&cause))?;

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
    .map_err(|cause| store_error(&cause))?;

    if has_orphan {
        Err(InstrumentEconomicTermsPostgresErrorV1::CorruptReadback)
    } else {
        Ok(())
    }
}

fn decode_row(
    row: &sqlx::postgres::PgRow,
) -> Result<InstrumentEconomicTermsReadbackV1, InstrumentEconomicTermsPostgresErrorV1> {
    let fact_identity: Vec<u8> = row
        .try_get("fact_identity")
        .map_err(|cause| store_error(&cause))?;
    let meaning_identity: Vec<u8> = row
        .try_get("meaning_identity")
        .map_err(|cause| store_error(&cause))?;
    let fact_bytes: Vec<u8> = row
        .try_get("fact_bytes")
        .map_err(|cause| store_error(&cause))?;
    let fact_custody: Vec<u8> = row
        .try_get("custody_digest")
        .map_err(|cause| store_error(&cause))?;
    let receipt_identity: Vec<u8> = row
        .try_get("receipt_identity")
        .map_err(|cause| store_error(&cause))?;
    let receipt_bytes: Vec<u8> = row
        .try_get("receipt_bytes")
        .map_err(|cause| store_error(&cause))?;
    let receipt_custody: Vec<u8> = row
        .try_get("receipt_custody_digest")
        .map_err(|cause| store_error(&cause))?;
    let selection_instrument_identity: String = row
        .try_get("selection_instrument_identity")
        .map_err(|cause| store_error(&cause))?;
    let selection_venue_identity: String = row
        .try_get("selection_venue_identity")
        .map_err(|cause| store_error(&cause))?;
    let selection_account_scope_identity: String = row
        .try_get("selection_account_scope_identity")
        .map_err(|cause| store_error(&cause))?;
    let selection_quote_currency: String = row
        .try_get("selection_quote_currency")
        .map_err(|cause| store_error(&cause))?;
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
#[track_caller]
fn store_error(cause: &impl Debug) -> InstrumentEconomicTermsPostgresErrorV1 {
    crate::owner::storage_diagnostic::refused_by_store_at(cause);
    InstrumentEconomicTermsPostgresErrorV1::StoreUnavailable
}
#[track_caller]
fn classify_insert(error: &sqlx::Error) -> InstrumentEconomicTermsPostgresErrorV1 {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::owner::{
        instrument_economic_terms_v1::{
            InstrumentEconomicAccountApplicabilityV1, InstrumentEconomicDecimalV1,
            InstrumentEconomicTermsFactV1, InstrumentEconomicTermsInputV1,
            InstrumentMarginMeaningV1,
        },
        instrument_master_v2::{
            FactValue, InstrumentMasterCutRequestV2, InstrumentMasterFactV2,
            tests::{fact_for, id},
        },
        instrument_master_v2_postgres::{InstrumentMasterV2PostgresOwner, tests::selection_of},
    };

    /// One member's economic terms under the shared account scope, valid around the replay time.
    fn terms_for(
        fact: &InstrumentMasterFactV2,
        quote_currency: &str,
    ) -> InstrumentEconomicTermsFactV1 {
        let decimal = |mantissa, scale| InstrumentEconomicDecimalV1 { mantissa, scale };
        InstrumentEconomicTermsFactV1::seal(InstrumentEconomicTermsInputV1 {
            schema_version: 1,
            instrument_identity: fact.canonical_identity().to_owned(),
            instrument_public_fact_digest: *fact.identity().as_bytes(),
            venue_identity: fact.venue_identity().to_owned(),
            account_scope_identity: "RDQ-MARGIN".into(),
            account_applicability: InstrumentEconomicAccountApplicabilityV1::MarginAccount,
            valid_from_ns: 100,
            valid_until_ns_exclusive: 1_000,
            source_identity: "fee-schedule-1".into(),
            source_digest: [2; 32],
            provenance_digest: [3; 32],
            revision: 1,
            quote_currency: quote_currency.to_owned(),
            fee_currency: quote_currency.to_owned(),
            maker_fee: decimal(2, 4),
            taker_fee: decimal(4, 4),
            initial_margin: decimal(1, 1),
            maintenance_margin: decimal(5, 2),
            margin_meaning: InstrumentMarginMeaningV1::StandardNotionalRate,
        })
        .expect("sealed economic terms")
    }

    /// Economic terms resolve for each member of a cut, whether it holds one member or two.
    ///
    /// The pair form stays what it was for a two-member cut and refuses a one-member cut rather
    /// than inventing a second member; the member form answers both, in the cut's member order.
    #[tokio::test]
    #[ignore = "requires a disposable Market Data PostgreSQL database"]
    async fn postgres_economic_terms_resolve_for_one_member_or_two() {
        let owner_url = std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL").unwrap();
        let pool = PgPool::connect(&owner_url).await.unwrap();
        let master = InstrumentMasterV2PostgresOwner::install(pool.clone())
            .await
            .unwrap();
        let terms = InstrumentEconomicTermsPostgresOwnerV1::install(pool.clone())
            .await
            .unwrap();
        let btc = fact_for("BTCUSDT-PERP.BINANCE", "BTCUSDT", 10);
        let eth = fact_for("ETHUSDT-PERP.BINANCE", "ETHUSDT", 20);
        master.append_fact(&btc).await.unwrap();
        master.append_fact(&eth).await.unwrap();
        let FactValue::Value(quote) = btc.terms().quote_currency.clone() else {
            panic!("the fixture fact states its quote currency");
        };
        let venue = btc.venue_identity().to_owned();
        terms.issue(&terms_for(&btc, &quote)).await.unwrap();
        terms.issue(&terms_for(&eth, &quote)).await.unwrap();

        let one = master
            .issue_cut(
                InstrumentMasterCutRequestV2::new(id(50), 7),
                &selection_of(&[("BTCUSDT", "BTCUSDT-PERP.BINANCE")]),
            )
            .await
            .unwrap();
        let two = master
            .issue_cut(
                InstrumentMasterCutRequestV2::new(id(51), 7),
                &selection_of(&[
                    ("BTCUSDT", "BTCUSDT-PERP.BINANCE"),
                    ("ETHUSDT", "ETHUSDT-PERP.BINANCE"),
                ]),
            )
            .await
            .unwrap();
        let instruments = |resolved: &[InstrumentEconomicTermsReadbackV1]| {
            resolved
                .iter()
                .map(|readback| readback.fact().input().instrument_identity.clone())
                .collect::<Vec<_>>()
        };

        let single = terms
            .resolve_unique_native_replay_members(&one, &venue, &quote, 500)
            .await
            .expect("a one-member cut resolves");
        assert_eq!(instruments(&single), ["BTCUSDT-PERP.BINANCE"]);
        let both = terms
            .resolve_unique_native_replay_members(&two, &venue, &quote, 500)
            .await
            .expect("a two-member cut resolves");
        assert_eq!(
            instruments(&both),
            ["BTCUSDT-PERP.BINANCE", "ETHUSDT-PERP.BINANCE"]
        );
        let pair = terms
            .resolve_unique_native_replay_pair(&two, &venue, &quote, 500)
            .await
            .expect("the pair form answers a two-member cut");
        assert_eq!(instruments(&pair), instruments(&both));
        assert_eq!(
            terms
                .resolve_unique_native_replay_pair(&one, &venue, &quote, 500)
                .await
                .unwrap_err(),
            InstrumentEconomicTermsPostgresErrorV1::InvalidSelection,
            "a one-member cut is not a pair"
        );
        assert_eq!(
            terms
                .resolve_unique_native_replay_members(&one, &venue, &quote, 1_000)
                .await
                .unwrap_err(),
            InstrumentEconomicTermsPostgresErrorV1::UnknownSelection,
            "outside the terms' validity nothing resolves"
        );
    }
}
