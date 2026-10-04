//! The backtest run registry's R&D custody: one append-only table recording each run that
//! `backtest.run` carried to its replay step, under the run id its caller chose.
//!
//! A run is written once, with the canonical bytes of the request it was submitted with and the
//! exact answer it was given, and read back as exactly those bytes. Nothing is updated or deleted:
//! the same request under the same run id reads back the run already written, and another request
//! under that run id is refused. A submission `backtest.run` refused before its replay step is not
//! a run and writes nothing, so its run id may be submitted again.

use std::fmt::Display;

use sqlx::{PgPool, Postgres, Row, Transaction};
use thiserror::Error;
use vibe_postgres_connect::{PgPoolOptionsExt, PostgresTls};

pub(crate) const TABLES: &[crate::schema_materialization::PublicTableSpec] =
    &[crate::schema_materialization::PublicTableSpec {
        name: "rd_backtest_runs_v1",
        runtime_read_grantees: &[],
        columns: &[
            crate::schema_materialization::required("run_id", "text"),
            crate::schema_materialization::required("request_bytes", "bytea"),
            crate::schema_materialization::required("answer_bytes", "bytea"),
            crate::schema_materialization::required("recorded_at_epoch_ms", "bigint"),
        ],
        constraints: &["p:run_id:::false:false:true:"],
        indexes: &[crate::schema_materialization::primary_index("run_id")],
    }];

/// The most runs one list returns.
pub const MAX_BACKTEST_RUN_LIST_V1: u32 = 500;

const RD_BACKTEST_RUNS_CREATE_V1: &str = "CREATE TABLE IF NOT EXISTS rd_backtest_runs_v1 (
    run_id TEXT PRIMARY KEY,
    request_bytes BYTEA NOT NULL,
    answer_bytes BYTEA NOT NULL,
    recorded_at_epoch_ms BIGINT NOT NULL
)";
const RD_BACKTEST_RUNS_REVOKE_V1: &str = "REVOKE ALL ON TABLE public.rd_backtest_runs_v1 FROM PUBLIC, market_data_owner, market_data_reader, backtest_owner, product_edge_owner, operator_authorization_owner, operator_authorization_writer, qualification_owner, qualification_writer";

/// Materializes the registry's table, which only the R&D Owner reads and writes.
pub(crate) async fn migrate(
    pool: &PgPool,
    _admitted: &crate::schema_materialization::PreCutoverMaterializationAdmitted,
) -> Result<(), sqlx::Error> {
    crate::schema_materialization::materialize_public_table(
        pool,
        "rd_backtest_runs_v1",
        RD_BACKTEST_RUNS_CREATE_V1,
    )
    .await?;
    sqlx::query(RD_BACKTEST_RUNS_REVOKE_V1)
        .execute(pool)
        .await?;
    Ok(())
}

/// Gives a store that has already cut over the registry's table, inside the window the caller
/// opened as `rd_schema_migrator` (`crate::rd_additive_public_tables`).
///
/// # Errors
///
/// Returns the refusal of a same-named relation that does not match the manifest exactly, which
/// is left untouched, or the storage failure.
pub(crate) async fn migrate_additive(owner_pool: &PgPool) -> Result<(), sqlx::Error> {
    crate::schema_materialization::migrate_additive_public_table(
        owner_pool,
        &TABLES[0],
        RD_BACKTEST_RUNS_CREATE_V1,
        &[RD_BACKTEST_RUNS_REVOKE_V1],
    )
    .await
}

/// One run as the registry holds it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BacktestRunRecordV1 {
    pub run_id: String,
    /// The canonical bytes of the request the run was submitted with.
    pub request_bytes: Vec<u8>,
    /// The answer the run was given, exactly as sent.
    pub answer_bytes: Vec<u8>,
    pub recorded_at_epoch_ms: u64,
}

/// Why a registry operation did not happen.
#[derive(Debug, Error)]
pub enum BacktestRunRegistryErrorV1 {
    /// The run id names a run submitted with another request.
    #[error("RUN_ID_CONFLICT")]
    RunIdConflict,
    /// The registry cannot be read or written.
    #[error("backtest run registry storage is unavailable: {0}")]
    Storage(String),
}

fn storage(error: impl Display) -> BacktestRunRegistryErrorV1 {
    BacktestRunRegistryErrorV1::Storage(error.to_string())
}

/// The backtest run registry over one R&D Owner pool.
#[derive(Clone)]
pub struct PostgresBacktestRunRegistryV1 {
    pool: PgPool,
}

impl PostgresBacktestRunRegistryV1 {
    /// Binds the registry to its own pool on the R&D Owner database.
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

    /// Writes a run once under its run id, or reads back the run already written there when it was
    /// submitted with the same request.
    ///
    /// # Errors
    ///
    /// Returns `RunIdConflict` when the run id names a run submitted with another request, and
    /// `Storage` otherwise.
    pub async fn record(
        &self,
        run_id: &str,
        request_bytes: &[u8],
        answer_bytes: &[u8],
    ) -> Result<BacktestRunRecordV1, BacktestRunRegistryErrorV1> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let now = crate::rd_owner_clock::owner_clock_epoch_ms_in_transaction(&mut transaction)
            .await
            .map_err(storage)?;
        sqlx::query(
            "INSERT INTO rd_backtest_runs_v1(run_id, request_bytes, answer_bytes, recorded_at_epoch_ms)
             VALUES($1,$2,$3,$4) ON CONFLICT (run_id) DO NOTHING",
        )
        .bind(run_id)
        .bind(request_bytes)
        .bind(answer_bytes)
        .bind(i64::try_from(now).map_err(storage)?)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
        let record = read(&mut transaction, run_id)
            .await?
            .ok_or_else(|| storage("a written run does not read back"))?;

        if record.request_bytes != request_bytes {
            return Err(BacktestRunRegistryErrorV1::RunIdConflict);
        }
        transaction.commit().await.map_err(storage)?;
        Ok(record)
    }

    /// Reads one run.
    ///
    /// # Errors
    ///
    /// Returns [`BacktestRunRegistryErrorV1::Storage`] when the registry cannot be read.
    pub async fn get(
        &self,
        run_id: &str,
    ) -> Result<Option<BacktestRunRecordV1>, BacktestRunRegistryErrorV1> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let record = read(&mut transaction, run_id).await?;
        transaction.commit().await.map_err(storage)?;
        Ok(record)
    }

    /// Lists runs newest first, at most `limit` of them.
    ///
    /// # Errors
    ///
    /// Returns [`BacktestRunRegistryErrorV1::Storage`] when the registry cannot be read.
    pub async fn list(
        &self,
        limit: u32,
    ) -> Result<Vec<BacktestRunRecordV1>, BacktestRunRegistryErrorV1> {
        let rows = sqlx::query(
            "SELECT run_id, request_bytes, answer_bytes, recorded_at_epoch_ms
             FROM rd_backtest_runs_v1
             ORDER BY recorded_at_epoch_ms DESC, run_id
             LIMIT $1",
        )
        .bind(i64::from(limit.min(MAX_BACKTEST_RUN_LIST_V1)))
        .fetch_all(&self.pool)
        .await
        .map_err(storage)?;
        rows.iter().map(record).collect()
    }
}

async fn read(
    transaction: &mut Transaction<'_, Postgres>,
    run_id: &str,
) -> Result<Option<BacktestRunRecordV1>, BacktestRunRegistryErrorV1> {
    sqlx::query(
        "SELECT run_id, request_bytes, answer_bytes, recorded_at_epoch_ms
         FROM rd_backtest_runs_v1 WHERE run_id=$1",
    )
    .bind(run_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(storage)?
    .as_ref()
    .map(record)
    .transpose()
}

fn record(row: &sqlx::postgres::PgRow) -> Result<BacktestRunRecordV1, BacktestRunRegistryErrorV1> {
    Ok(BacktestRunRecordV1 {
        run_id: row.try_get("run_id").map_err(storage)?,
        request_bytes: row.try_get("request_bytes").map_err(storage)?,
        answer_bytes: row.try_get("answer_bytes").map_err(storage)?,
        recorded_at_epoch_ms: u64::try_from(
            row.try_get::<i64, _>("recorded_at_epoch_ms")
                .map_err(storage)?,
        )
        .map_err(storage)?,
    })
}
