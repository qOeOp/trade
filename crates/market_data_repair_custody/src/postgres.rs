//! Disposable PostgreSQL acceptance oracle for append-only Market Data repair custody.
//!
//! Production construction remains unavailable until the documented Market Data store-admission
//! capability can own this repository without exposing a raw pool or DSN.

use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Transaction};

use crate::{
    MarketDataRepairDispositionV1, MarketDataRepairTerminalErrorV1, MarketDataRepairTerminalV1,
};

const TERMINAL_STORAGE_DOMAIN_V1: &str = "market-data.repair-terminal.storage.v1";
const OUTBOX_PAYLOAD_DOMAIN_V1: &str = "market-data.repair-terminal.outbox-payload.v1";
const OUTBOX_EVENT_V1: &str = "MARKET_DATA_REPAIR_TERMINAL_COMMITTED_V1";

/// Exact untrusted locator for one committed repair terminal.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct MarketDataRepairTerminalLocatorV1 {
    terminal_identity: String,
    terminal_digest: String,
    repair_request_identity: String,
    repair_request_digest: String,
}

impl MarketDataRepairTerminalLocatorV1 {
    /// Wraps caller-supplied coordinates without granting positive custody.
    #[must_use]
    pub fn from_untrusted(
        terminal_identity: impl Into<String>,
        terminal_digest: impl Into<String>,
        repair_request_identity: impl Into<String>,
        repair_request_digest: impl Into<String>,
    ) -> Self {
        Self {
            terminal_identity: terminal_identity.into(),
            terminal_digest: terminal_digest.into(),
            repair_request_identity: repair_request_identity.into(),
            repair_request_digest: repair_request_digest.into(),
        }
    }

    #[must_use]
    pub fn terminal_identity(&self) -> &str {
        &self.terminal_identity
    }

    #[must_use]
    pub fn terminal_digest(&self) -> &str {
        &self.terminal_digest
    }

    #[must_use]
    pub fn repair_request_identity(&self) -> &str {
        &self.repair_request_identity
    }

    #[must_use]
    pub fn repair_request_digest(&self) -> &str {
        &self.repair_request_digest
    }
}

/// Move-only exact storage readback. It exposes canonical terminal bytes, not a construction API.
#[derive(Debug, Eq, PartialEq)]
pub struct StoredMarketDataRepairTerminalV1 {
    locator: MarketDataRepairTerminalLocatorV1,
    disposition: MarketDataRepairDispositionV1,
    terminal_bytes: Vec<u8>,
    committed_at_epoch_ms: u64,
}

impl StoredMarketDataRepairTerminalV1 {
    #[must_use]
    pub const fn locator(&self) -> &MarketDataRepairTerminalLocatorV1 {
        &self.locator
    }

    #[must_use]
    pub const fn disposition(&self) -> MarketDataRepairDispositionV1 {
        self.disposition
    }

    #[must_use]
    pub fn canonical_terminal_bytes(&self) -> &[u8] {
        &self.terminal_bytes
    }

    #[must_use]
    pub const fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
}

/// Market Data-owned append-only terminal store.
#[derive(Debug)]
pub struct MarketDataRepairTerminalPostgresV1 {
    pool: PgPool,
}

impl MarketDataRepairTerminalPostgresV1 {
    /// Installs the additive tables under an already admitted `market_data_owner` pool.
    ///
    /// # Errors
    ///
    /// Returns an error when the principal, role graph, schema ownership, or DDL is unavailable.
    pub async fn migrate(pool: PgPool) -> Result<Self, MarketDataRepairTerminalPostgresErrorV1> {
        let mut transaction = serializable(&pool).await?;
        validate_owner(&mut transaction).await?;
        for statement in [
            "DO $guard$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace namespace JOIN pg_catalog.pg_roles role ON role.oid=namespace.nspowner WHERE namespace.nspname='market_data_private' AND role.rolname='market_data_owner') THEN RAISE EXCEPTION 'Market Data schema ownership is unavailable'; END IF; END $guard$",
            "CREATE TABLE IF NOT EXISTS market_data_private.rd_repair_terminals_v1 (repair_request_identity TEXT PRIMARY KEY CHECK (repair_request_identity<>''), repair_request_digest TEXT NOT NULL CHECK (repair_request_digest<>''), repair_request_receipt_identity TEXT UNIQUE NOT NULL CHECK (repair_request_receipt_identity<>''), repair_request_receipt_digest TEXT NOT NULL CHECK (repair_request_receipt_digest<>''), terminal_identity TEXT UNIQUE NOT NULL CHECK (terminal_identity<>''), terminal_digest TEXT UNIQUE NOT NULL CHECK (terminal_digest<>''), disposition TEXT NOT NULL CHECK (disposition IN ('AVAILABLE','UNAVAILABLE')), terminal_bytes BYTEA NOT NULL CHECK (octet_length(terminal_bytes)>0), storage_digest TEXT NOT NULL CHECK (storage_digest<>''), committed_at_epoch_ms BIGINT NOT NULL CHECK (committed_at_epoch_ms>0))",
            "CREATE TABLE IF NOT EXISTS market_data_private.rd_repair_terminal_outbox_v1 (event_identity TEXT PRIMARY KEY CHECK (event_identity<>''), repair_request_identity TEXT UNIQUE NOT NULL REFERENCES market_data_private.rd_repair_terminals_v1(repair_request_identity) ON DELETE RESTRICT, event_kind TEXT NOT NULL CHECK (event_kind='MARKET_DATA_REPAIR_TERMINAL_COMMITTED_V1'), payload_digest TEXT NOT NULL CHECK (payload_digest<>''), payload_bytes BYTEA NOT NULL CHECK (octet_length(payload_bytes)>0))",
            "REVOKE ALL ON TABLE market_data_private.rd_repair_terminals_v1, market_data_private.rd_repair_terminal_outbox_v1 FROM PUBLIC",
        ] {
            sqlx::query(statement)
                .execute(&mut *transaction)
                .await
                .map_err(storage)?;
        }
        transaction.commit().await.map_err(storage)?;
        Ok(Self { pool })
    }

    /// Commits one terminal and its outbox event atomically. Exact retry returns identical bytes.
    ///
    /// # Errors
    ///
    /// Returns `Conflict` for changed meaning under an existing request identity and `Unavailable`
    /// for invalid input. Storage and principal failures remain storage errors.
    pub async fn commit(
        &self,
        terminal: MarketDataRepairTerminalV1,
        committed_at_epoch_ms: u64,
    ) -> Result<StoredMarketDataRepairTerminalV1, MarketDataRepairTerminalPostgresErrorV1> {
        let committed_at = i64::try_from(committed_at_epoch_ms)
            .ok()
            .filter(|value| *value > 0)
            .ok_or(MarketDataRepairTerminalPostgresErrorV1::Unavailable)?;
        let terminal_bytes = terminal
            .to_canonical_bytes()
            .map_err(MarketDataRepairTerminalPostgresErrorV1::Terminal)?;
        let locator = MarketDataRepairTerminalLocatorV1::from_untrusted(
            terminal.terminal_identity(),
            terminal.terminal_digest(),
            terminal.repair_request_identity(),
            terminal.repair_request_digest(),
        );
        validate_locator(&locator)?;
        let disposition = disposition_text(terminal.disposition());
        let terminal_storage_digest = storage_digest(TERMINAL_STORAGE_DOMAIN_V1, &terminal_bytes);
        let payload_digest = storage_digest(OUTBOX_PAYLOAD_DOMAIN_V1, &terminal_bytes);
        let event_identity = format!(
            "market-data-repair-terminal-event-v1-{}",
            payload_digest.trim_start_matches("sha256:")
        );

        let mut transaction = serializable(&self.pool).await?;
        validate_owner(&mut transaction).await?;
        sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))")
            .bind(terminal.repair_request_identity())
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;
        if let Some(stored) =
            load_by_request(&mut transaction, terminal.repair_request_identity(), true).await?
        {
            let stored_locator = MarketDataRepairTerminalLocatorV1::from_untrusted(
                &stored.terminal_identity,
                &stored.terminal_digest,
                &stored.repair_request_identity,
                &stored.repair_request_digest,
            );
            let readback = admit_stored(&stored_locator, stored)?;
            if readback.canonical_terminal_bytes() != terminal_bytes {
                return Err(MarketDataRepairTerminalPostgresErrorV1::Conflict);
            }
            transaction.commit().await.map_err(storage)?;
            return Ok(readback);
        }

        sqlx::query(
            "INSERT INTO market_data_private.rd_repair_terminals_v1 (repair_request_identity,repair_request_digest,repair_request_receipt_identity,repair_request_receipt_digest,terminal_identity,terminal_digest,disposition,terminal_bytes,storage_digest,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        )
        .bind(terminal.repair_request_identity())
        .bind(terminal.repair_request_digest())
        .bind(terminal.repair_request_receipt_identity())
        .bind(terminal.repair_request_receipt_digest())
        .bind(terminal.terminal_identity())
        .bind(terminal.terminal_digest())
        .bind(disposition)
        .bind(&terminal_bytes)
        .bind(&terminal_storage_digest)
        .bind(committed_at)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
        sqlx::query(
            "INSERT INTO market_data_private.rd_repair_terminal_outbox_v1 (event_identity,repair_request_identity,event_kind,payload_digest,payload_bytes) VALUES ($1,$2,$3,$4,$5)",
        )
        .bind(&event_identity)
        .bind(terminal.repair_request_identity())
        .bind(OUTBOX_EVENT_V1)
        .bind(&payload_digest)
        .bind(&terminal_bytes)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
        let payload_bytes = terminal_bytes.clone();
        let row = StoredRow {
            repair_request_identity: terminal.repair_request_identity().to_owned(),
            repair_request_digest: terminal.repair_request_digest().to_owned(),
            repair_request_receipt_identity: terminal.repair_request_receipt_identity().to_owned(),
            repair_request_receipt_digest: terminal.repair_request_receipt_digest().to_owned(),
            terminal_identity: terminal.terminal_identity().to_owned(),
            terminal_digest: terminal.terminal_digest().to_owned(),
            disposition: disposition.to_owned(),
            terminal_bytes,
            storage_digest: terminal_storage_digest,
            committed_at_epoch_ms: committed_at,
            event_identity,
            event_kind: OUTBOX_EVENT_V1.to_owned(),
            payload_digest,
            payload_bytes,
        };
        let readback = admit_stored(&locator, row)?;
        transaction.commit().await.map_err(storage)?;
        Ok(readback)
    }

    /// Resolves one exact terminal and verifies its row, storage digest, and outbox binding.
    ///
    /// # Errors
    ///
    /// Returns `Unavailable` when the locator is absent or any custody coordinate is inconsistent.
    pub async fn resolve(
        &self,
        locator: &MarketDataRepairTerminalLocatorV1,
    ) -> Result<StoredMarketDataRepairTerminalV1, MarketDataRepairTerminalPostgresErrorV1> {
        validate_locator(locator)?;
        let mut transaction = serializable(&self.pool).await?;
        validate_owner(&mut transaction).await?;
        let row = load_by_request(&mut transaction, locator.repair_request_identity(), false)
            .await?
            .ok_or(MarketDataRepairTerminalPostgresErrorV1::Unavailable)?;
        let readback = admit_stored(locator, row)?;
        transaction.commit().await.map_err(storage)?;
        Ok(readback)
    }
}

#[derive(Debug, sqlx::FromRow)]
struct StoredRow {
    repair_request_identity: String,
    repair_request_digest: String,
    repair_request_receipt_identity: String,
    repair_request_receipt_digest: String,
    terminal_identity: String,
    terminal_digest: String,
    disposition: String,
    terminal_bytes: Vec<u8>,
    storage_digest: String,
    committed_at_epoch_ms: i64,
    event_identity: String,
    event_kind: String,
    payload_digest: String,
    payload_bytes: Vec<u8>,
}

#[derive(Debug, thiserror::Error)]
pub enum MarketDataRepairTerminalPostgresErrorV1 {
    #[error("Market Data repair terminal custody is unavailable")]
    Unavailable,
    #[error("Market Data repair terminal identity already has different meaning")]
    Conflict,
    #[error(transparent)]
    Terminal(#[from] MarketDataRepairTerminalErrorV1),
    #[error("Market Data repair terminal storage is unavailable: {0}")]
    Storage(String),
}

async fn serializable(
    pool: &PgPool,
) -> Result<Transaction<'_, Postgres>, MarketDataRepairTerminalPostgresErrorV1> {
    let mut transaction = pool.begin().await.map_err(storage)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
    Ok(transaction)
}

async fn validate_owner(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), MarketDataRepairTerminalPostgresErrorV1> {
    let exact: bool = sqlx::query_scalar(
        "SELECT session_user='market_data_owner'
             AND current_user='market_data_owner'
             AND pg_catalog.current_setting('transaction_isolation')='serializable'
             AND role.rolcanlogin
             AND role.rolinherit
             AND NOT (role.rolsuper OR role.rolcreatedb OR role.rolcreaterole
                      OR role.rolreplication OR role.rolbypassrls)
             AND NOT EXISTS (
               SELECT 1 FROM pg_catalog.pg_auth_members membership
                WHERE membership.roleid=role.oid OR membership.member=role.oid
             )
          FROM pg_catalog.pg_roles role
         WHERE role.rolname='market_data_owner'",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;
    if exact {
        Ok(())
    } else {
        Err(MarketDataRepairTerminalPostgresErrorV1::Unavailable)
    }
}

async fn load_by_request(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
    update: bool,
) -> Result<Option<StoredRow>, MarketDataRepairTerminalPostgresErrorV1> {
    let statement = if update {
        "SELECT terminal.repair_request_identity,terminal.repair_request_digest,terminal.repair_request_receipt_identity,terminal.repair_request_receipt_digest,terminal.terminal_identity,terminal.terminal_digest,terminal.disposition,terminal.terminal_bytes,terminal.storage_digest,terminal.committed_at_epoch_ms,event.event_identity,event.event_kind,event.payload_digest,event.payload_bytes FROM market_data_private.rd_repair_terminals_v1 terminal JOIN market_data_private.rd_repair_terminal_outbox_v1 event ON event.repair_request_identity=terminal.repair_request_identity WHERE terminal.repair_request_identity=$1 FOR UPDATE OF terminal, event"
    } else {
        "SELECT terminal.repair_request_identity,terminal.repair_request_digest,terminal.repair_request_receipt_identity,terminal.repair_request_receipt_digest,terminal.terminal_identity,terminal.terminal_digest,terminal.disposition,terminal.terminal_bytes,terminal.storage_digest,terminal.committed_at_epoch_ms,event.event_identity,event.event_kind,event.payload_digest,event.payload_bytes FROM market_data_private.rd_repair_terminals_v1 terminal JOIN market_data_private.rd_repair_terminal_outbox_v1 event ON event.repair_request_identity=terminal.repair_request_identity WHERE terminal.repair_request_identity=$1 FOR SHARE OF terminal, event"
    };
    sqlx::query_as::<_, StoredRow>(statement)
        .bind(request_identity)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(storage)
}

fn admit_stored(
    locator: &MarketDataRepairTerminalLocatorV1,
    row: StoredRow,
) -> Result<StoredMarketDataRepairTerminalV1, MarketDataRepairTerminalPostgresErrorV1> {
    let value: serde_json::Value = serde_json::from_slice(&row.terminal_bytes)
        .map_err(|_| MarketDataRepairTerminalPostgresErrorV1::Unavailable)?;
    let disposition = match row.disposition.as_str() {
        "AVAILABLE" => MarketDataRepairDispositionV1::Available,
        "UNAVAILABLE" => MarketDataRepairDispositionV1::Unavailable,
        _ => return Err(MarketDataRepairTerminalPostgresErrorV1::Unavailable),
    };
    if value
        .get("schema_version")
        .and_then(serde_json::Value::as_u64)
        != Some(1)
        || row.repair_request_identity != locator.repair_request_identity
        || row.repair_request_digest != locator.repair_request_digest
        || row.terminal_identity != locator.terminal_identity
        || row.terminal_digest != locator.terminal_digest
        || field(&value, "repair_request_identity") != row.repair_request_identity
        || field(&value, "repair_request_digest") != row.repair_request_digest
        || field(&value, "repair_request_receipt_identity") != row.repair_request_receipt_identity
        || field(&value, "repair_request_receipt_digest") != row.repair_request_receipt_digest
        || field(&value, "terminal_identity") != row.terminal_identity
        || field(&value, "terminal_digest") != row.terminal_digest
        || field(&value, "disposition") != row.disposition
        || storage_digest(TERMINAL_STORAGE_DOMAIN_V1, &row.terminal_bytes) != row.storage_digest
        || row.event_kind != OUTBOX_EVENT_V1
        || row.payload_bytes != row.terminal_bytes
        || storage_digest(OUTBOX_PAYLOAD_DOMAIN_V1, &row.payload_bytes) != row.payload_digest
        || row.event_identity
            != format!(
                "market-data-repair-terminal-event-v1-{}",
                row.payload_digest.trim_start_matches("sha256:")
            )
        || row.committed_at_epoch_ms <= 0
    {
        return Err(MarketDataRepairTerminalPostgresErrorV1::Unavailable);
    }
    Ok(StoredMarketDataRepairTerminalV1 {
        locator: locator.clone(),
        disposition,
        terminal_bytes: row.terminal_bytes,
        committed_at_epoch_ms: u64::try_from(row.committed_at_epoch_ms)
            .map_err(|_| MarketDataRepairTerminalPostgresErrorV1::Unavailable)?,
    })
}

fn validate_locator(
    locator: &MarketDataRepairTerminalLocatorV1,
) -> Result<(), MarketDataRepairTerminalPostgresErrorV1> {
    if [
        locator.terminal_identity.as_str(),
        locator.terminal_digest.as_str(),
        locator.repair_request_identity.as_str(),
        locator.repair_request_digest.as_str(),
    ]
    .into_iter()
    .all(|value| !value.is_empty() && value.len() <= 512)
    {
        Ok(())
    } else {
        Err(MarketDataRepairTerminalPostgresErrorV1::Unavailable)
    }
}

fn field<'a>(value: &'a serde_json::Value, name: &str) -> &'a str {
    value
        .get(name)
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
}

const fn disposition_text(value: MarketDataRepairDispositionV1) -> &'static str {
    match value {
        MarketDataRepairDispositionV1::Available => "AVAILABLE",
        MarketDataRepairDispositionV1::Unavailable => "UNAVAILABLE",
    }
}

fn storage_digest(domain: &str, bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(domain.as_bytes());
    digest.update([0]);
    digest.update(bytes);
    format!("sha256:{:x}", digest.finalize())
}

fn storage(error: impl std::fmt::Display) -> MarketDataRepairTerminalPostgresErrorV1 {
    MarketDataRepairTerminalPostgresErrorV1::Storage(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

    fn fixture() -> (MarketDataRepairTerminalLocatorV1, StoredRow) {
        let terminal = serde_json::json!({
            "schema_version": 1,
            "terminal_identity": "terminal",
            "terminal_digest": "sha256:terminal",
            "repair_request_identity": "request",
            "repair_request_digest": "sha256:request",
            "repair_request_receipt_identity": "receipt",
            "repair_request_receipt_digest": "sha256:receipt",
            "disposition": "UNAVAILABLE"
        });
        let terminal_bytes = serde_json::to_vec(&terminal).expect("terminal bytes");
        let payload_digest = storage_digest(OUTBOX_PAYLOAD_DOMAIN_V1, &terminal_bytes);
        (
            MarketDataRepairTerminalLocatorV1::from_untrusted(
                "terminal",
                "sha256:terminal",
                "request",
                "sha256:request",
            ),
            StoredRow {
                repair_request_identity: "request".to_owned(),
                repair_request_digest: "sha256:request".to_owned(),
                repair_request_receipt_identity: "receipt".to_owned(),
                repair_request_receipt_digest: "sha256:receipt".to_owned(),
                terminal_identity: "terminal".to_owned(),
                terminal_digest: "sha256:terminal".to_owned(),
                disposition: "UNAVAILABLE".to_owned(),
                storage_digest: storage_digest(TERMINAL_STORAGE_DOMAIN_V1, &terminal_bytes),
                terminal_bytes: terminal_bytes.clone(),
                committed_at_epoch_ms: 10,
                event_identity: format!(
                    "market-data-repair-terminal-event-v1-{}",
                    payload_digest.trim_start_matches("sha256:")
                ),
                event_kind: OUTBOX_EVENT_V1.to_owned(),
                payload_digest,
                payload_bytes: terminal_bytes,
            },
        )
    }

    #[test]
    fn exact_storage_and_outbox_issue_readback() {
        let (locator, row) = fixture();
        let readback = admit_stored(&locator, row).expect("stored readback");
        assert_eq!(readback.locator(), &locator);
        assert_eq!(
            readback.disposition(),
            MarketDataRepairDispositionV1::Unavailable
        );
    }

    #[test]
    fn storage_or_outbox_splice_fails_closed() {
        let (locator, mut row) = fixture();
        row.storage_digest = "sha256:tampered".to_owned();
        assert!(matches!(
            admit_stored(&locator, row),
            Err(MarketDataRepairTerminalPostgresErrorV1::Unavailable)
        ));

        let (locator, mut row) = fixture();
        row.payload_bytes.push(0);
        assert!(matches!(
            admit_stored(&locator, row),
            Err(MarketDataRepairTerminalPostgresErrorV1::Unavailable)
        ));
    }

    #[tokio::test]
    #[ignore = "requires the canonical disposable Owner PostgreSQL topology"]
    async fn commit_retry_resolve_conflict_and_tamper_are_atomic() {
        let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
            .await
            .expect("canonical disposable topology");
        let pool = database
            .mutation()
            .pool(CanonicalOwnerTestRoleV1::MarketDataOwner)
            .clone();
        let store = MarketDataRepairTerminalPostgresV1::migrate(pool.clone())
            .await
            .expect("Market Data terminal schema");

        let first = store
            .commit(crate::tests::available_terminal_fixture(20), 100)
            .await
            .expect("first terminal commit");
        let first_bytes = first.canonical_terminal_bytes().to_vec();
        let locator = first.locator().clone();
        let retry = store
            .commit(crate::tests::available_terminal_fixture(20), 101)
            .await
            .expect("exact retry");
        assert_eq!(retry.canonical_terminal_bytes(), first_bytes);
        assert_eq!(retry.committed_at_epoch_ms(), 100);

        let resolved = store.resolve(&locator).await.expect("exact resolve");
        assert_eq!(resolved.canonical_terminal_bytes(), first_bytes);
        assert_eq!(resolved.locator(), &locator);

        assert!(matches!(
            store
                .commit(crate::tests::available_terminal_fixture(40), 102)
                .await,
            Err(MarketDataRepairTerminalPostgresErrorV1::Conflict)
        ));
        let terminal_count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM market_data_private.rd_repair_terminals_v1 WHERE repair_request_identity=$1",
        )
        .bind(locator.repair_request_identity())
        .fetch_one(&pool)
        .await
        .expect("terminal count");
        let event_count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM market_data_private.rd_repair_terminal_outbox_v1 WHERE repair_request_identity=$1",
        )
        .bind(locator.repair_request_identity())
        .fetch_one(&pool)
        .await
        .expect("outbox count");
        assert_eq!((terminal_count, event_count), (1, 1));

        sqlx::query(
            "UPDATE market_data_private.rd_repair_terminal_outbox_v1 SET payload_bytes=payload_bytes || decode('00','hex') WHERE repair_request_identity=$1",
        )
        .bind(locator.repair_request_identity())
        .execute(&pool)
        .await
        .expect("inject disposable outbox splice");
        assert!(matches!(
            store.resolve(&locator).await,
            Err(MarketDataRepairTerminalPostgresErrorV1::Unavailable)
        ));
    }
}
