//! The strategy catalog's R&D custody: two append-only tables and the five operations on them.
//!
//! A statement is written once, under the identity its canonical bytes hash to, and read back as
//! exactly those bytes. Nothing is updated or deleted: a revision is a new statement that names
//! its predecessor, and archiving appends a row of its own, so every strategy a run ever read can
//! still be read. Neither table names a Research request; a run binds the statement to one by
//! value (`strategy_catalog_v1`).

use std::fmt::Display;

use sqlx::{PgPool, Postgres, Row, Transaction};
use thiserror::Error;
use vibe_postgres_connect::{PgPoolOptionsExt, PostgresTls};

use crate::strategy_catalog_v1::{
    CanonicalStrategyStatementV1, StrategyIdentityV1, stored_strategy_identity_v1,
};

pub(crate) const TABLES: &[crate::schema_materialization::PublicTableSpec] = &[
    crate::schema_materialization::PublicTableSpec {
        name: "rd_strategy_specs_v1",
        runtime_read_grantees: &[],
        columns: &[
            crate::schema_materialization::required("strategy_identity", "bytea"),
            crate::schema_materialization::required("spec_bytes", "bytea"),
            crate::schema_materialization::optional("predecessor_identity", "bytea"),
            crate::schema_materialization::required("created_at_epoch_ms", "bigint"),
        ],
        constraints: &[
            "f:predecessor_identity:public.rd_strategy_specs_v1(strategy_identity):a:a:s:false:false:true:",
            "p:strategy_identity:::false:false:true:",
        ],
        indexes: &[crate::schema_materialization::primary_index(
            "strategy_identity",
        )],
    },
    crate::schema_materialization::PublicTableSpec {
        name: "rd_strategy_archives_v1",
        runtime_read_grantees: &[],
        columns: &[
            crate::schema_materialization::required("strategy_identity", "bytea"),
            crate::schema_materialization::required("archived_at_epoch_ms", "bigint"),
        ],
        constraints: &[
            "f:strategy_identity:public.rd_strategy_specs_v1(strategy_identity):a:a:s:false:false:true:",
            "p:strategy_identity:::false:false:true:",
        ],
        indexes: &[crate::schema_materialization::primary_index(
            "strategy_identity",
        )],
    },
];

/// The most strategies one list returns.
pub const MAX_STRATEGY_LIST_V1: u32 = 500;

const RD_STRATEGY_SPECS_CREATE_V1: &str = "CREATE TABLE IF NOT EXISTS rd_strategy_specs_v1 (
    strategy_identity BYTEA PRIMARY KEY,
    spec_bytes BYTEA NOT NULL,
    predecessor_identity BYTEA REFERENCES rd_strategy_specs_v1(strategy_identity),
    created_at_epoch_ms BIGINT NOT NULL
)";
const RD_STRATEGY_ARCHIVES_CREATE_V1: &str = "CREATE TABLE IF NOT EXISTS rd_strategy_archives_v1 (
    strategy_identity BYTEA PRIMARY KEY REFERENCES rd_strategy_specs_v1(strategy_identity),
    archived_at_epoch_ms BIGINT NOT NULL
)";
const RD_STRATEGY_SPECS_REVOKE_V1: &str = "REVOKE ALL ON TABLE public.rd_strategy_specs_v1 FROM PUBLIC, market_data_owner, market_data_reader, backtest_owner, product_edge_owner, operator_authorization_owner, operator_authorization_writer, qualification_owner, qualification_writer";
const RD_STRATEGY_ARCHIVES_REVOKE_V1: &str = "REVOKE ALL ON TABLE public.rd_strategy_archives_v1 FROM PUBLIC, market_data_owner, market_data_reader, backtest_owner, product_edge_owner, operator_authorization_owner, operator_authorization_writer, qualification_owner, qualification_writer";

/// Materializes the catalog's two tables, which only the R&D Owner reads and writes.
pub(crate) async fn migrate(
    pool: &PgPool,
    _admitted: &crate::schema_materialization::PreCutoverMaterializationAdmitted,
) -> Result<(), sqlx::Error> {
    crate::schema_materialization::materialize_public_table(
        pool,
        "rd_strategy_specs_v1",
        RD_STRATEGY_SPECS_CREATE_V1,
    )
    .await?;
    crate::schema_materialization::materialize_public_table(
        pool,
        "rd_strategy_archives_v1",
        RD_STRATEGY_ARCHIVES_CREATE_V1,
    )
    .await?;

    for statement in [RD_STRATEGY_SPECS_REVOKE_V1, RD_STRATEGY_ARCHIVES_REVOKE_V1] {
        sqlx::query(statement).execute(pool).await?;
    }
    Ok(())
}

/// Lets a store that has already cut over gain these same two tables, when a build adds them
/// after that store's cutover: creates each one only if it is purely absent, refusing by name
/// (and touching nothing) if a same-named relation exists and is not already this exact shape.
///
/// `owner_database_url` must authenticate as `rd_owner`; `migrator_database_url` as
/// `rd_schema_migrator`, which holds nothing beyond `EXECUTE` on the two SECURITY DEFINER
/// functions that open and close the one window `rd_owner` needs
/// (`product/rd-workbench/postgres-init/10-migrate-authority-custody.sh`'s
/// `rd_schema_migration_api` schema). The window is closed even when creating a table inside it
/// fails, since a lingering grant on `rd_owner` is the worse outcome to leave unreported; if
/// closing it also fails, that failure is what this function returns.
///
/// # Errors
///
/// Returns an error when either connection cannot be opened, when opening or closing the window
/// is refused (the wrong role, or run before cutover), or when a same-named relation already
/// exists and does not match the manifest exactly - that refusal names the relation and leaves it
/// untouched.
pub async fn migrate_additively(
    owner_database_url: &str,
    migrator_database_url: &str,
) -> Result<(), sqlx::Error> {
    let owner_pool = sqlx::postgres::PgPoolOptions::new()
        .connect_url(owner_database_url, PostgresTls::Disabled)
        .await?;
    let migrator_pool = sqlx::postgres::PgPoolOptions::new()
        .connect_url(migrator_database_url, PostgresTls::Disabled)
        .await?;
    crate::schema_materialization::open_additive_table_create_window(&migrator_pool).await?;
    let migration = migrate_both(&owner_pool).await;
    crate::schema_materialization::close_additive_table_create_window(&migrator_pool)
        .await
        .and(migration)
}

async fn migrate_both(owner_pool: &sqlx::PgPool) -> Result<(), sqlx::Error> {
    crate::schema_materialization::migrate_additive_public_table(
        owner_pool,
        &TABLES[0],
        RD_STRATEGY_SPECS_CREATE_V1,
        &[RD_STRATEGY_SPECS_REVOKE_V1],
    )
    .await?;
    crate::schema_materialization::migrate_additive_public_table(
        owner_pool,
        &TABLES[1],
        RD_STRATEGY_ARCHIVES_CREATE_V1,
        &[RD_STRATEGY_ARCHIVES_REVOKE_V1],
    )
    .await
}

/// One strategy as the catalog holds it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StrategyRecordV1 {
    pub identity: StrategyIdentityV1,
    /// The statement's canonical bytes, exactly as written.
    pub spec_bytes: Vec<u8>,
    /// The strategy this one revises, if any.
    pub predecessor: Option<StrategyIdentityV1>,
    pub created_at_epoch_ms: u64,
    /// When the strategy was archived, if it has been. An archived strategy stays readable.
    pub archived_at_epoch_ms: Option<u64>,
}

/// Why a catalog operation did not happen.
#[derive(Debug, Error)]
pub enum StrategyCatalogErrorV1 {
    /// The named strategy is not in the catalog.
    #[error("STRATEGY_UNKNOWN")]
    Unknown,
    /// The named strategy is archived, so it cannot be revised.
    #[error("STRATEGY_ARCHIVED")]
    Archived,
    /// A revision states exactly what it revises.
    #[error("STRATEGY_REVISION_UNCHANGED")]
    RevisionUnchanged,
    /// The revised statement is already in the catalog under another lineage, so it cannot also
    /// name this predecessor.
    #[error("STRATEGY_EXISTS_UNDER_ANOTHER_LINEAGE")]
    ExistsUnderAnotherLineage,
    /// A stored row does not read back as a catalog row.
    #[error("strategy catalog storage is unavailable: {0}")]
    Storage(String),
}

fn storage(error: impl Display) -> StrategyCatalogErrorV1 {
    StrategyCatalogErrorV1::Storage(error.to_string())
}

/// The strategy catalog over one R&D Owner pool.
#[derive(Clone)]
pub struct PostgresStrategyCatalogV1 {
    pool: PgPool,
}

impl PostgresStrategyCatalogV1 {
    /// Binds the catalog to its own pool on the R&D Owner database.
    ///
    /// # Errors
    ///
    /// Returns the connection failure.
    pub async fn connect(database_url: &str) -> Result<Self, sqlx::Error> {
        Ok(Self::new(
            sqlx::postgres::PgPoolOptions::new()
                .connect_url(database_url, PostgresTls::Disabled)
                .await?,
        ))
    }

    #[must_use]
    pub const fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Writes a statement with no predecessor, or reads back the one already written under its
    /// identity: the same statement is always the same strategy.
    ///
    /// # Errors
    ///
    /// Returns [`StrategyCatalogErrorV1::Storage`] when the catalog cannot be read or written.
    pub async fn create(
        &self,
        spec: &CanonicalStrategyStatementV1,
    ) -> Result<StrategyRecordV1, StrategyCatalogErrorV1> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        insert_once(&mut transaction, spec, None).await?;
        let record = read(&mut transaction, spec.identity())
            .await?
            .ok_or_else(|| storage("a written strategy does not read back"))?;
        transaction.commit().await.map_err(storage)?;
        Ok(record)
    }

    /// Writes a statement that revises `predecessor`.
    ///
    /// Revising the same predecessor into the same statement again reads back the revision already
    /// written.
    ///
    /// # Errors
    ///
    /// Returns `Unknown` or `Archived` for the predecessor, `RevisionUnchanged` when the
    /// statement is the predecessor's own, `ExistsUnderAnotherLineage` when the statement is
    /// already in the catalog naming another predecessor or none, and `Storage` otherwise.
    pub async fn revise(
        &self,
        predecessor: StrategyIdentityV1,
        spec: &CanonicalStrategyStatementV1,
    ) -> Result<StrategyRecordV1, StrategyCatalogErrorV1> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let revised = sqlx::query(
            "SELECT spec.strategy_identity,
                    archive.strategy_identity IS NOT NULL AS archived
             FROM rd_strategy_specs_v1 spec
             LEFT JOIN rd_strategy_archives_v1 archive USING (strategy_identity)
             WHERE spec.strategy_identity=$1
             FOR SHARE OF spec",
        )
        .bind(predecessor.as_bytes().as_slice())
        .fetch_optional(&mut *transaction)
        .await
        .map_err(storage)?
        .ok_or(StrategyCatalogErrorV1::Unknown)?;

        if revised.try_get::<bool, _>("archived").map_err(storage)? {
            return Err(StrategyCatalogErrorV1::Archived);
        }

        if spec.identity() == predecessor {
            return Err(StrategyCatalogErrorV1::RevisionUnchanged);
        }
        insert_once(&mut transaction, spec, Some(predecessor)).await?;
        let record = read(&mut transaction, spec.identity())
            .await?
            .ok_or_else(|| storage("a written strategy does not read back"))?;

        if record.predecessor != Some(predecessor) {
            return Err(StrategyCatalogErrorV1::ExistsUnderAnotherLineage);
        }
        transaction.commit().await.map_err(storage)?;
        Ok(record)
    }

    /// Reads one strategy, archived or not.
    ///
    /// # Errors
    ///
    /// Returns [`StrategyCatalogErrorV1::Storage`] when the catalog cannot be read.
    pub async fn get(
        &self,
        identity: StrategyIdentityV1,
    ) -> Result<Option<StrategyRecordV1>, StrategyCatalogErrorV1> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let record = read(&mut transaction, identity).await?;
        transaction.commit().await.map_err(storage)?;
        Ok(record)
    }

    /// Lists strategies in the order they were written, at most `limit` of them, archived ones
    /// only when asked for.
    ///
    /// # Errors
    ///
    /// Returns [`StrategyCatalogErrorV1::Storage`] when the catalog cannot be read.
    pub async fn list(
        &self,
        include_archived: bool,
        limit: u32,
    ) -> Result<Vec<StrategyRecordV1>, StrategyCatalogErrorV1> {
        let rows = sqlx::query(
            "SELECT spec.strategy_identity, spec.spec_bytes, spec.predecessor_identity,
                    spec.created_at_epoch_ms, archive.archived_at_epoch_ms
             FROM rd_strategy_specs_v1 spec
             LEFT JOIN rd_strategy_archives_v1 archive USING (strategy_identity)
             WHERE $1 OR archive.strategy_identity IS NULL
             ORDER BY spec.created_at_epoch_ms, spec.strategy_identity
             LIMIT $2",
        )
        .bind(include_archived)
        .bind(i64::from(limit.min(MAX_STRATEGY_LIST_V1)))
        .fetch_all(&self.pool)
        .await
        .map_err(storage)?;
        rows.iter().map(record).collect()
    }

    /// Archives a strategy. It stays readable and can no longer be run or revised; archiving it
    /// again reads back the first archiving.
    ///
    /// # Errors
    ///
    /// Returns `Unknown` when the strategy is not in the catalog and `Storage` otherwise.
    pub async fn archive(
        &self,
        identity: StrategyIdentityV1,
    ) -> Result<StrategyRecordV1, StrategyCatalogErrorV1> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(
                SELECT 1 FROM rd_strategy_specs_v1 WHERE strategy_identity=$1 FOR SHARE
            )",
        )
        .bind(identity.as_bytes().as_slice())
        .fetch_one(&mut *transaction)
        .await
        .map_err(storage)?;

        if !exists {
            return Err(StrategyCatalogErrorV1::Unknown);
        }
        let now = crate::rd_owner_clock::owner_clock_epoch_ms_in_transaction(&mut transaction)
            .await
            .map_err(storage)?;
        sqlx::query(
            "INSERT INTO rd_strategy_archives_v1(strategy_identity, archived_at_epoch_ms)
             VALUES($1,$2) ON CONFLICT (strategy_identity) DO NOTHING",
        )
        .bind(identity.as_bytes().as_slice())
        .bind(i64::try_from(now).map_err(storage)?)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
        let record = read(&mut transaction, identity)
            .await?
            .ok_or_else(|| storage("an archived strategy does not read back"))?;
        transaction.commit().await.map_err(storage)?;
        Ok(record)
    }
}

/// Writes the statement once under its identity; a second write of it changes nothing.
async fn insert_once(
    transaction: &mut Transaction<'_, Postgres>,
    spec: &CanonicalStrategyStatementV1,
    predecessor: Option<StrategyIdentityV1>,
) -> Result<(), StrategyCatalogErrorV1> {
    let now = crate::rd_owner_clock::owner_clock_epoch_ms_in_transaction(transaction)
        .await
        .map_err(storage)?;
    sqlx::query(
        "INSERT INTO rd_strategy_specs_v1(
            strategy_identity, spec_bytes, predecessor_identity, created_at_epoch_ms
        ) VALUES($1,$2,$3,$4) ON CONFLICT (strategy_identity) DO NOTHING",
    )
    .bind(spec.identity().as_bytes().as_slice())
    .bind(spec.canonical_bytes())
    .bind(predecessor.map(|identity| identity.as_bytes().to_vec()))
    .bind(i64::try_from(now).map_err(storage)?)
    .execute(&mut **transaction)
    .await
    .map_err(storage)?;
    Ok(())
}

async fn read(
    transaction: &mut Transaction<'_, Postgres>,
    identity: StrategyIdentityV1,
) -> Result<Option<StrategyRecordV1>, StrategyCatalogErrorV1> {
    sqlx::query(
        "SELECT spec.strategy_identity, spec.spec_bytes, spec.predecessor_identity,
                spec.created_at_epoch_ms, archive.archived_at_epoch_ms
         FROM rd_strategy_specs_v1 spec
         LEFT JOIN rd_strategy_archives_v1 archive USING (strategy_identity)
         WHERE spec.strategy_identity=$1",
    )
    .bind(identity.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(storage)?
    .as_ref()
    .map(record)
    .transpose()
}

fn record(row: &sqlx::postgres::PgRow) -> Result<StrategyRecordV1, StrategyCatalogErrorV1> {
    let identity = |bytes: Vec<u8>| {
        <[u8; 32]>::try_from(bytes.as_slice())
            .map(StrategyIdentityV1::from_bytes)
            .map_err(|_| storage("a strategy identity is not 32 bytes"))
    };
    let epoch_ms = |value: i64| u64::try_from(value).map_err(storage);
    let stored_identity = identity(row.try_get("strategy_identity").map_err(storage)?)?;
    let spec_bytes: Vec<u8> = row.try_get("spec_bytes").map_err(storage)?;

    // A statement is content-addressed, so the bytes read back must hash to the identity they are
    // stored under; a row that does not is not a statement this catalog wrote.
    if stored_strategy_identity_v1(&spec_bytes) != Some(stored_identity) {
        return Err(storage("a stored statement does not hash to its identity"));
    }
    Ok(StrategyRecordV1 {
        identity: stored_identity,
        spec_bytes,
        predecessor: row
            .try_get::<Option<Vec<u8>>, _>("predecessor_identity")
            .map_err(storage)?
            .map(identity)
            .transpose()?,
        created_at_epoch_ms: epoch_ms(row.try_get("created_at_epoch_ms").map_err(storage)?)?,
        archived_at_epoch_ms: row
            .try_get::<Option<i64>, _>("archived_at_epoch_ms")
            .map_err(storage)?
            .map(epoch_ms)
            .transpose()?,
    })
}
