use std::fmt::Display;

use async_trait::async_trait;
use sqlx::{PgPool, Row};

use crate::{
    rd_historical_custody::{
        HistoricalArtifactCustodyCandidateV1, HistoricalBindingCustodyCandidateV1,
        HistoricalCustodyCompletenessV1, HistoricalCustodyErrorV1, HistoricalCustodyOwnerPortV1,
        HistoricalCustodyProjectionStateV1, HistoricalCustodyQuarantineV1,
        HistoricalResearchCustodyCandidateV1, RD_HISTORICAL_CUSTODY_OPERATION_V1,
    },
    rd_owner_postgres_custody::require_rd_owner_api_schema,
};

const MAX_ROWS_PER_KIND: i64 = 200;

#[derive(Clone)]
pub struct PostgresHistoricalCustodyOwnerV1 {
    pool: PgPool,
}

impl PostgresHistoricalCustodyOwnerV1 {
    pub async fn connect_read_only(database_url: &str) -> Result<Self, HistoricalCustodyErrorV1> {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(4)
            .after_connect(|connection, _| {
                Box::pin(async move {
                    sqlx::query("SET default_transaction_read_only = on")
                        .execute(connection)
                        .await?;
                    Ok(())
                })
            })
            .connect(database_url)
            .await
            .map_err(storage)?;
        let read_only: bool =
            sqlx::query_scalar("SELECT current_setting('default_transaction_read_only') = 'on'")
                .fetch_one(&pool)
                .await
                .map_err(storage)?;

        if !read_only {
            return Err(HistoricalCustodyErrorV1::Storage(
                "read-only session unavailable".into(),
            ));
        }
        require_rd_owner_api_schema(&pool).await.map_err(storage)?;
        Ok(Self { pool })
    }
}

#[async_trait]
impl HistoricalCustodyOwnerPortV1 for PostgresHistoricalCustodyOwnerV1 {
    async fn read_historical_custodies(
        &self,
    ) -> Result<HistoricalCustodyQuarantineV1, HistoricalCustodyErrorV1> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;
        let summary = sqlx::query(
            "SELECT floor(extract(epoch FROM statement_timestamp()) * 1000)::bigint AS observed_at_epoch_ms, (SELECT count(*) FROM rd_research_request_receipts_v1)::bigint AS research_total, (SELECT count(*) FROM rd_artifact_build_attempts_v1)::bigint AS artifact_attempt_total, (SELECT count(*) FROM rd_artifact_trial_family_bindings_v1)::bigint AS binding_total",
        )
        .fetch_one(&mut *transaction)
        .await
        .map_err(storage)?;
        let observed_at_epoch_ms = nonnegative(&summary, "observed_at_epoch_ms")?;
        let research_total = nonnegative(&summary, "research_total")?;
        let artifact_attempt_total = nonnegative(&summary, "artifact_attempt_total")?;
        let binding_total = nonnegative(&summary, "binding_total")?;

        let research_rows = sqlx::query(
            "SELECT request_identity, committed_at_epoch_ms FROM rd_research_request_receipts_v1 ORDER BY committed_at_epoch_ms DESC, request_identity COLLATE \"C\" DESC LIMIT $1",
        )
        .bind(MAX_ROWS_PER_KIND)
        .fetch_all(&mut *transaction)
        .await
        .map_err(storage)?;
        let attempt_rows = sqlx::query(
            "SELECT build_request_identity, attempt_identity, prepared_at_epoch_ms FROM rd_artifact_build_attempts_v1 ORDER BY prepared_at_epoch_ms DESC, build_request_identity COLLATE \"C\" DESC, attempt_identity COLLATE \"C\" DESC LIMIT $1",
        )
        .bind(MAX_ROWS_PER_KIND)
        .fetch_all(&mut *transaction)
        .await
        .map_err(storage)?;
        let binding_rows = sqlx::query(
            "SELECT binding_identity, trial_family_identity, committed_at_epoch_ms FROM rd_artifact_trial_family_bindings_v1 ORDER BY committed_at_epoch_ms DESC, binding_identity COLLATE \"C\" DESC LIMIT $1",
        )
        .bind(MAX_ROWS_PER_KIND)
        .fetch_all(&mut *transaction)
        .await
        .map_err(storage)?;

        let research = research_rows
            .iter()
            .map(|row| {
                Ok(HistoricalResearchCustodyCandidateV1 {
                    request_identity: required_identity(row, "request_identity")?,
                    committed_at_epoch_ms: nonnegative(row, "committed_at_epoch_ms")?,
                    projection_state: HistoricalCustodyProjectionStateV1::PointReadRequired,
                })
            })
            .collect::<Result<Vec<_>, HistoricalCustodyErrorV1>>()?;
        let artifact_attempts = attempt_rows
            .iter()
            .map(|row| {
                Ok(HistoricalArtifactCustodyCandidateV1 {
                    build_request_identity: required_identity(row, "build_request_identity")?,
                    attempt_identity: required_identity(row, "attempt_identity")?,
                    prepared_at_epoch_ms: nonnegative(row, "prepared_at_epoch_ms")?,
                    projection_state: HistoricalCustodyProjectionStateV1::PointReadRequired,
                })
            })
            .collect::<Result<Vec<_>, HistoricalCustodyErrorV1>>()?;
        let bindings = binding_rows
            .iter()
            .map(|row| {
                Ok(HistoricalBindingCustodyCandidateV1 {
                    binding_identity: required_identity(row, "binding_identity")?,
                    trial_family_identity: required_identity(row, "trial_family_identity")?,
                    committed_at_epoch_ms: nonnegative(row, "committed_at_epoch_ms")?,
                    projection_state: HistoricalCustodyProjectionStateV1::PointReadRequired,
                })
            })
            .collect::<Result<Vec<_>, HistoricalCustodyErrorV1>>()?;
        let completeness = if research_total > research.len() as u64
            || artifact_attempt_total > artifact_attempts.len() as u64
            || binding_total > bindings.len() as u64
        {
            HistoricalCustodyCompletenessV1::PartialTruncated
        } else {
            HistoricalCustodyCompletenessV1::Complete
        };
        transaction.commit().await.map_err(storage)?;

        Ok(HistoricalCustodyQuarantineV1 {
            schema_version: 1,
            operation: RD_HISTORICAL_CUSTODY_OPERATION_V1,
            completeness,
            observed_at_epoch_ms,
            research_total,
            artifact_attempt_total,
            binding_total,
            research,
            artifact_attempts,
            bindings,
        })
    }
}

fn nonnegative(row: &sqlx::postgres::PgRow, column: &str) -> Result<u64, HistoricalCustodyErrorV1> {
    u64::try_from(row.try_get::<i64, _>(column).map_err(storage)?).map_err(storage)
}

fn required_identity(
    row: &sqlx::postgres::PgRow,
    column: &str,
) -> Result<String, HistoricalCustodyErrorV1> {
    let value: String = row.try_get(column).map_err(storage)?;
    if value.is_empty()
        || value.len() > 256
        || !value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.' | b'/')
        })
    {
        return Err(HistoricalCustodyErrorV1::Storage(
            "custody identity outside bounded contract".into(),
        ));
    }
    Ok(value)
}

fn storage(error: impl Display) -> HistoricalCustodyErrorV1 {
    HistoricalCustodyErrorV1::Storage(error.to_string())
}
