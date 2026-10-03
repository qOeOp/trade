//! Market Data's own backfill job facts: two append-only tables, one row per job and one row per
//! transition. `job_id` is content-addressed from the request alone, so re-queuing an identical
//! request always names the same job rather than minting a second one.

use std::{collections::BTreeMap, fmt::Debug, sync::Arc};

use sha2::{Digest, Sha256};
use sqlx::Row;

use super::MarketDataOwnerPostgres;
use crate::owner::{
    backfill_job_v1::{
        BackfillCoverageRangeV1, BackfillJobErrorV1, BackfillJobRecordV1, BackfillJobRequestV1,
        BackfillJobStatusV1, BackfillJobV1,
    },
    source_binding::BindingDigest,
};

use BackfillJobErrorV1 as Refused;

pub(super) const SCHEMA_V1: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS market_data_private.backfill_jobs_v1 (job_id BYTEA PRIMARY KEY CHECK (octet_length(job_id)=32), instrument TEXT NOT NULL CHECK (octet_length(instrument) BETWEEN 1 AND 256), execution_timeframe TEXT NOT NULL CHECK (octet_length(execution_timeframe) BETWEEN 1 AND 16), window_start_ns BIGINT NOT NULL CHECK (window_start_ns>=0), window_end_ns_exclusive BIGINT NOT NULL CHECK (window_end_ns_exclusive>window_start_ns))",
    "REVOKE ALL ON TABLE market_data_private.backfill_jobs_v1 FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS market_data_private.backfill_job_transitions_v1 (job_id BYTEA NOT NULL REFERENCES market_data_private.backfill_jobs_v1(job_id), sequence BIGINT NOT NULL CHECK (sequence>0), status TEXT NOT NULL CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED')), custody_receipt_identity BYTEA CHECK (octet_length(custody_receipt_identity)=32), succeeded_window_start_ns BIGINT, succeeded_window_end_ns_exclusive BIGINT, refusal_name TEXT CHECK (refusal_name IS NULL OR octet_length(refusal_name) BETWEEN 1 AND 128), recorded_at_ns BIGINT NOT NULL CHECK (recorded_at_ns>=0), PRIMARY KEY (job_id, sequence))",
    "REVOKE ALL ON TABLE market_data_private.backfill_job_transitions_v1 FROM PUBLIC",
];

fn job_id(request: &BackfillJobRequestV1) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(b"market-data.backfill-job.v1\0");
    hasher.update((request.instrument.len() as u64).to_be_bytes());
    hasher.update(request.instrument.as_bytes());
    hasher.update((request.execution_timeframe.len() as u64).to_be_bytes());
    hasher.update(request.execution_timeframe.as_bytes());
    hasher.update(request.window_start_ns.to_be_bytes());
    hasher.update(request.window_end_ns_exclusive.to_be_bytes());
    let bytes: [u8; 32] = hasher.finalize().into();
    BindingDigest::from_untrusted_bytes(bytes)
}

fn now_ns() -> i64 {
    vibe_core::time::get_atomic_clock_realtime()
        .get_time_ns()
        .as_u64()
        .try_into()
        .unwrap_or(i64::MAX)
}

struct BackfillJobPostgresV1 {
    owner: MarketDataOwnerPostgres,
}

impl Debug for BackfillJobPostgresV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(BackfillJobPostgresV1))
            .finish_non_exhaustive()
    }
}

impl crate::owner::backfill_job_v1::sealed::Sealed for BackfillJobPostgresV1 {}

fn decode_transition(row: &sqlx::postgres::PgRow) -> Result<BackfillJobStatusV1, Refused> {
    let status: String = row
        .try_get("status")
        .map_err(|_| Refused::StoreUnavailable)?;

    match status.as_str() {
        "QUEUED" => Ok(BackfillJobStatusV1::Queued),
        "RUNNING" => Ok(BackfillJobStatusV1::Running),
        "SUCCEEDED" => {
            let receipt_bytes: Vec<u8> = row
                .try_get("custody_receipt_identity")
                .map_err(|_| Refused::StoreUnavailable)?;
            let receipt: [u8; 32] = receipt_bytes
                .as_slice()
                .try_into()
                .map_err(|_| Refused::StoreUnavailable)?;
            let window_start_ns: i64 = row
                .try_get("succeeded_window_start_ns")
                .map_err(|_| Refused::StoreUnavailable)?;
            let window_end_ns_exclusive: i64 = row
                .try_get("succeeded_window_end_ns_exclusive")
                .map_err(|_| Refused::StoreUnavailable)?;
            Ok(BackfillJobStatusV1::Succeeded {
                custody_receipt_identity: BindingDigest::from_untrusted_bytes(receipt),
                window_start_ns: window_start_ns.try_into().unwrap_or(0),
                window_end_ns_exclusive: window_end_ns_exclusive.try_into().unwrap_or(0),
            })
        }
        "FAILED" => {
            let refusal_name: String = row
                .try_get("refusal_name")
                .map_err(|_| Refused::StoreUnavailable)?;
            Ok(BackfillJobStatusV1::Failed { refusal_name })
        }
        _ => Err(Refused::StoreUnavailable),
    }
}

#[async_trait::async_trait]
impl BackfillJobV1 for BackfillJobPostgresV1 {
    async fn queue(&self, request: BackfillJobRequestV1) -> Result<BindingDigest, Refused> {
        if request.instrument.is_empty()
            || request.execution_timeframe.is_empty()
            || request.window_end_ns_exclusive <= request.window_start_ns
        {
            return Err(Refused::InvalidRequest);
        }
        let id = job_id(&request);
        let mut transaction = self
            .owner
            .pool
            .begin()
            .await
            .map_err(|_| Refused::StoreUnavailable)?;
        sqlx::query(
            "INSERT INTO market_data_private.backfill_jobs_v1(job_id,instrument,execution_timeframe,window_start_ns,window_end_ns_exclusive) VALUES($1,$2,$3,$4,$5) ON CONFLICT(job_id) DO NOTHING",
        )
        .bind(id.as_bytes().as_slice())
        .bind(&request.instrument)
        .bind(&request.execution_timeframe)
        .bind(i64::try_from(request.window_start_ns).map_err(|_| Refused::InvalidRequest)?)
        .bind(
            i64::try_from(request.window_end_ns_exclusive)
                .map_err(|_| Refused::InvalidRequest)?,
        )
        .execute(&mut *transaction)
        .await
        .map_err(|_| Refused::StoreUnavailable)?;
        sqlx::query(
            "INSERT INTO market_data_private.backfill_job_transitions_v1(job_id,sequence,status,recorded_at_ns) VALUES($1,1,'QUEUED',$2) ON CONFLICT(job_id,sequence) DO NOTHING",
        )
        .bind(id.as_bytes().as_slice())
        .bind(now_ns())
        .execute(&mut *transaction)
        .await
        .map_err(|_| Refused::StoreUnavailable)?;
        transaction
            .commit()
            .await
            .map_err(|_| Refused::StoreUnavailable)?;
        Ok(id)
    }

    async fn record_running(&self, job_id: BindingDigest) -> Result<(), Refused> {
        self.append_transition(job_id, |current| match current {
            Some(BackfillJobStatusV1::Queued) | None => {
                Ok(Some(("RUNNING", None, None, None, None)))
            }
            Some(BackfillJobStatusV1::Running) => Ok(None),
            Some(_) => Err(Refused::InvalidTransition),
        })
        .await
    }

    async fn record_succeeded(
        &self,
        job_id: BindingDigest,
        custody_receipt_identity: BindingDigest,
        window_start_ns: u64,
        window_end_ns_exclusive: u64,
    ) -> Result<(), Refused> {
        let start = i64::try_from(window_start_ns).map_err(|_| Refused::InvalidRequest)?;
        let end = i64::try_from(window_end_ns_exclusive).map_err(|_| Refused::InvalidRequest)?;
        self.append_transition(job_id, move |current| match current {
            Some(BackfillJobStatusV1::Queued | BackfillJobStatusV1::Running) | None => Ok(Some((
                "SUCCEEDED",
                Some(custody_receipt_identity),
                Some(start),
                Some(end),
                None,
            ))),
            Some(BackfillJobStatusV1::Succeeded {
                custody_receipt_identity: existing_receipt,
                window_start_ns: existing_start,
                window_end_ns_exclusive: existing_end,
            }) if existing_receipt == custody_receipt_identity
                && existing_start == window_start_ns
                && existing_end == window_end_ns_exclusive =>
            {
                Ok(None)
            }
            Some(_) => Err(Refused::InvalidTransition),
        })
        .await
    }

    async fn record_failed(
        &self,
        job_id: BindingDigest,
        refusal_name: String,
    ) -> Result<(), Refused> {
        if refusal_name.is_empty() {
            return Err(Refused::InvalidRequest);
        }
        self.append_transition(job_id, move |current| match current {
            Some(BackfillJobStatusV1::Queued | BackfillJobStatusV1::Running) | None => {
                Ok(Some(("FAILED", None, None, None, Some(refusal_name))))
            }
            Some(BackfillJobStatusV1::Failed {
                refusal_name: existing,
            }) if existing == refusal_name => Ok(None),
            Some(_) => Err(Refused::InvalidTransition),
        })
        .await
    }

    async fn status(&self, job_id: BindingDigest) -> Result<BackfillJobRecordV1, Refused> {
        let request_row = sqlx::query(
            "SELECT instrument,execution_timeframe,window_start_ns,window_end_ns_exclusive FROM market_data_private.backfill_jobs_v1 WHERE job_id=$1",
        )
        .bind(job_id.as_bytes().as_slice())
        .fetch_optional(&self.owner.pool)
        .await
        .map_err(|_| Refused::StoreUnavailable)?
        .ok_or(Refused::JobUnknown)?;
        let instrument: String = request_row
            .try_get("instrument")
            .map_err(|_| Refused::StoreUnavailable)?;
        let execution_timeframe: String = request_row
            .try_get("execution_timeframe")
            .map_err(|_| Refused::StoreUnavailable)?;
        let window_start_ns: i64 = request_row
            .try_get("window_start_ns")
            .map_err(|_| Refused::StoreUnavailable)?;
        let window_end_ns_exclusive: i64 = request_row
            .try_get("window_end_ns_exclusive")
            .map_err(|_| Refused::StoreUnavailable)?;

        let transition_rows = sqlx::query(
            "SELECT status,custody_receipt_identity,succeeded_window_start_ns,succeeded_window_end_ns_exclusive,refusal_name FROM market_data_private.backfill_job_transitions_v1 WHERE job_id=$1 ORDER BY sequence",
        )
        .bind(job_id.as_bytes().as_slice())
        .fetch_all(&self.owner.pool)
        .await
        .map_err(|_| Refused::StoreUnavailable)?;
        let transitions = transition_rows
            .iter()
            .map(decode_transition)
            .collect::<Result<Vec<_>, _>>()?;

        Ok(BackfillJobRecordV1 {
            job_id,
            request: BackfillJobRequestV1 {
                instrument,
                execution_timeframe,
                window_start_ns: window_start_ns.try_into().unwrap_or(0),
                window_end_ns_exclusive: window_end_ns_exclusive.try_into().unwrap_or(0),
            },
            transitions,
        })
    }

    async fn coverage(
        &self,
        instrument: &str,
    ) -> Result<Vec<(String, Vec<BackfillCoverageRangeV1>)>, Refused> {
        let rows = sqlx::query(
            "SELECT j.execution_timeframe,t.succeeded_window_start_ns,t.succeeded_window_end_ns_exclusive FROM market_data_private.backfill_job_transitions_v1 t JOIN market_data_private.backfill_jobs_v1 j ON j.job_id=t.job_id WHERE j.instrument=$1 AND t.status='SUCCEEDED' ORDER BY j.execution_timeframe, t.succeeded_window_start_ns",
        )
        .bind(instrument)
        .fetch_all(&self.owner.pool)
        .await
        .map_err(|_| Refused::StoreUnavailable)?;

        let mut by_timeframe: BTreeMap<String, Vec<BackfillCoverageRangeV1>> = BTreeMap::new();
        for row in rows {
            let timeframe: String = row
                .try_get("execution_timeframe")
                .map_err(|_| Refused::StoreUnavailable)?;
            let start: i64 = row
                .try_get("succeeded_window_start_ns")
                .map_err(|_| Refused::StoreUnavailable)?;
            let end: i64 = row
                .try_get("succeeded_window_end_ns_exclusive")
                .map_err(|_| Refused::StoreUnavailable)?;
            by_timeframe
                .entry(timeframe)
                .or_default()
                .push(BackfillCoverageRangeV1 {
                    window_start_ns: start.try_into().unwrap_or(0),
                    window_end_ns_exclusive: end.try_into().unwrap_or(0),
                });
        }

        Ok(by_timeframe
            .into_iter()
            .map(|(timeframe, ranges)| (timeframe, merge_ranges(ranges)))
            .collect())
    }
}

/// Merges touching or overlapping half-open ranges, already sorted by `window_start_ns`.
fn merge_ranges(ranges: Vec<BackfillCoverageRangeV1>) -> Vec<BackfillCoverageRangeV1> {
    let mut merged: Vec<BackfillCoverageRangeV1> = Vec::with_capacity(ranges.len());
    for range in ranges {
        if let Some(last) = merged.last_mut()
            && range.window_start_ns <= last.window_end_ns_exclusive
        {
            last.window_end_ns_exclusive = last
                .window_end_ns_exclusive
                .max(range.window_end_ns_exclusive);
            continue;
        }
        merged.push(range);
    }
    merged
}

impl BackfillJobPostgresV1 {
    /// Reads the job's current transition, decides the next one through `decide`, and appends it
    /// if `decide` names one. `decide` sees `None` only when the job has no transitions at all,
    /// which [`BackfillJobV1::queue`] always prevents for a job this intake minted; a caller
    /// naming an unrecognised `job_id` sees [`Refused::JobUnknown`] before `decide` ever runs.
    async fn append_transition(
        &self,
        job_id: BindingDigest,
        decide: impl FnOnce(
            Option<BackfillJobStatusV1>,
        ) -> Result<
            Option<(
                &'static str,
                Option<BindingDigest>,
                Option<i64>,
                Option<i64>,
                Option<String>,
            )>,
            Refused,
        >,
    ) -> Result<(), Refused> {
        let mut transaction = self
            .owner
            .pool
            .begin()
            .await
            .map_err(|_| Refused::StoreUnavailable)?;
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM market_data_private.backfill_jobs_v1 WHERE job_id=$1)",
        )
        .bind(job_id.as_bytes().as_slice())
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| Refused::StoreUnavailable)?;
        if !exists {
            return Err(Refused::JobUnknown);
        }
        let last_row = sqlx::query(
            "SELECT sequence,status,custody_receipt_identity,succeeded_window_start_ns,succeeded_window_end_ns_exclusive,refusal_name FROM market_data_private.backfill_job_transitions_v1 WHERE job_id=$1 ORDER BY sequence DESC LIMIT 1 FOR UPDATE",
        )
        .bind(job_id.as_bytes().as_slice())
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|_| Refused::StoreUnavailable)?;
        let (next_sequence, current) = match &last_row {
            Some(row) => {
                let sequence: i64 = row
                    .try_get("sequence")
                    .map_err(|_| Refused::StoreUnavailable)?;
                (sequence + 1, Some(decode_transition(row)?))
            }
            None => (1, None),
        };

        let Some((
            status,
            custody_receipt_identity,
            window_start_ns,
            window_end_ns_exclusive,
            refusal_name,
        )) = decide(current)?
        else {
            return Ok(());
        };

        sqlx::query(
            "INSERT INTO market_data_private.backfill_job_transitions_v1(job_id,sequence,status,custody_receipt_identity,succeeded_window_start_ns,succeeded_window_end_ns_exclusive,refusal_name,recorded_at_ns) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        )
        .bind(job_id.as_bytes().as_slice())
        .bind(next_sequence)
        .bind(status)
        .bind(custody_receipt_identity.map(|value| value.as_bytes().to_vec()))
        .bind(window_start_ns)
        .bind(window_end_ns_exclusive)
        .bind(refusal_name)
        .bind(now_ns())
        .execute(&mut *transaction)
        .await
        .map_err(|_| Refused::StoreUnavailable)?;
        transaction
            .commit()
            .await
            .map_err(|_| Refused::StoreUnavailable)?;
        Ok(())
    }
}

/// Opens the sole configured backfill job intake.
pub(in crate::owner) async fn backfill_job_from_environment_v1()
-> Result<Arc<dyn BackfillJobV1>, Refused> {
    let url = std::env::var(
        crate::owner::instrument_master_v2_postgres::MARKET_DATA_OWNER_DATABASE_URL_ENV,
    )
    .map_err(|_| Refused::StoreUnavailable)?;
    if url.is_empty() || url.trim() != url {
        return Err(Refused::StoreUnavailable);
    }
    let owner = MarketDataOwnerPostgres::connect(&url).await.map_err(|e| {
        crate::owner::storage_diagnostic::refused_by_store("backfill_job.environment.connect", &e);
        Refused::StoreUnavailable
    })?;
    Ok(Arc::new(BackfillJobPostgresV1 { owner }))
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::{BackfillCoverageRangeV1, BackfillJobRequestV1, job_id, merge_ranges};

    fn request(window_start_ns: u64, window_end_ns_exclusive: u64) -> BackfillJobRequestV1 {
        BackfillJobRequestV1 {
            instrument: "BTCUSDT-PERP.BINANCE".to_owned(),
            execution_timeframe: "1d".to_owned(),
            window_start_ns,
            window_end_ns_exclusive,
        }
    }

    #[rstest]
    fn job_id_is_deterministic_and_content_addressed() {
        assert_eq!(job_id(&request(1, 2)), job_id(&request(1, 2)));
        assert_ne!(job_id(&request(1, 2)), job_id(&request(1, 3)));
        let mut other_instrument = request(1, 2);
        other_instrument.instrument = "ETHUSDT-PERP.BINANCE".to_owned();
        assert_ne!(job_id(&request(1, 2)), job_id(&other_instrument));
    }

    fn range(window_start_ns: u64, window_end_ns_exclusive: u64) -> BackfillCoverageRangeV1 {
        BackfillCoverageRangeV1 {
            window_start_ns,
            window_end_ns_exclusive,
        }
    }

    #[rstest]
    fn merge_ranges_joins_touching_and_overlapping_ranges() {
        assert_eq!(
            merge_ranges(vec![range(0, 10), range(10, 20), range(15, 30)]),
            vec![range(0, 30)]
        );
    }

    #[rstest]
    fn merge_ranges_keeps_a_true_gap_separate() {
        assert_eq!(
            merge_ranges(vec![range(0, 10), range(20, 30)]),
            vec![range(0, 10), range(20, 30)]
        );
    }

    #[rstest]
    fn merge_ranges_of_nothing_is_nothing() {
        assert_eq!(merge_ranges(Vec::new()), Vec::new());
    }
}
