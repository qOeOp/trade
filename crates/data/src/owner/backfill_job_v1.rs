//! Market Data's own append-only backfill job facts.
//!
//! A backfill job is Market Data's record of one attempt to fill one member's custody over one
//! window, for one execution timeframe: `QUEUED`, then `RUNNING`, then a terminal `SUCCEEDED` (with
//! the committed custody receipt and the exact range it covered) or `FAILED` (with the refusal's
//! name). Each transition is its own appended row; nothing is ever updated in place. The job holds
//! no market value and reads nothing from the custody it names - it only records what the backfill
//! writer (`crates/adapters/binance/src/vision_backfill_custody_v1.rs`) and the custody commit
//! (`pit_window_custody_commit_from_environment_v1`) told it.
//!
//! `coverage` - the union of every `SUCCEEDED` job's `[window_start_ns, window_end_ns_exclusive)`
//! for one `(instrument, execution_timeframe)` - is read from these facts, never from the custody
//! tables directly: the custody receipt carries no window bounds, and reading Market Data's own
//! append-only record of what it committed is this job's own statement, not another Owner's
//! internal state.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::source_binding::BindingDigest;

/// What `backfill` takes: one member, one execution timeframe, one half-open window.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BackfillJobRequestV1 {
    /// The member's canonical instrument identity.
    pub instrument: String,
    /// The custody's execution timeframe label, validated against
    /// [`super::bar_schedule::SUPPORTED_EXECUTION_TIMEFRAMES_V1`] before this type is ever built.
    pub execution_timeframe: String,
    /// Inclusive start of the requested window.
    pub window_start_ns: u64,
    /// Exclusive end of the requested window.
    pub window_end_ns_exclusive: u64,
}

/// A job's one current disposition, as `job_status` answers it.
#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(tag = "status", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BackfillJobStatusV1 {
    /// Recorded; no worker has picked it up yet.
    Queued,
    /// A worker is fetching, writing and committing.
    Running,
    /// The custody commit succeeded. `coverage` reads this job's own
    /// `[window_start_ns, window_end_ns_exclusive)` once it reaches this state.
    Succeeded {
        custody_receipt_identity: BindingDigest,
        window_start_ns: u64,
        window_end_ns_exclusive: u64,
    },
    /// Nothing was committed. The name is one of the writer's or the custody's own refusal names
    /// (`BackfillRefusalDispositionV1`'s source, or a named error from this job's own basis
    /// construction).
    Failed { refusal_name: String },
}

/// One job's complete, append-only history: every transition it has recorded, oldest first. The
/// current disposition is the last entry; earlier ones exist only so a caller can see that the
/// job really moved through `Queued` and `Running` rather than jumping straight to a terminal.
#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
pub struct BackfillJobRecordV1 {
    pub job_id: BindingDigest,
    pub request: BackfillJobRequestV1,
    pub transitions: Vec<BackfillJobStatusV1>,
}

impl BackfillJobRecordV1 {
    /// The job's current disposition: its last recorded transition.
    ///
    /// # Panics
    ///
    /// Never for a record [`BackfillJobV1::status`] returned: every job it can name was minted
    /// by [`BackfillJobV1::queue`], which always appends the job's first `QUEUED` transition in
    /// the same commit that creates the job row.
    #[must_use]
    pub fn current(&self) -> &BackfillJobStatusV1 {
        self.transitions
            .last()
            .expect("a recorded job always has at least its own QUEUED transition")
    }
}

/// One covered half-open range, as `coverage` answers it for one execution timeframe.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize)]
pub struct BackfillCoverageRangeV1 {
    pub window_start_ns: u64,
    pub window_end_ns_exclusive: u64,
}

/// Why a backfill job call was refused.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum BackfillJobErrorV1 {
    #[error("the request is malformed")]
    InvalidRequest,
    #[error("no job exists with this identity")]
    JobUnknown,
    #[error("the job cannot move to that transition from its current one")]
    InvalidTransition,
    #[error("the store is unavailable")]
    StoreUnavailable,
}

/// The sealed production backfill job intake. Market Data's own worker reaches it; no consumer
/// outside this Owner can implement it.
#[async_trait]
pub trait BackfillJobV1: Send + Sync + sealed::Sealed {
    /// Records a `QUEUED` job fact for this request and returns its `job_id`. Re-submitting an
    /// identical, still-`QUEUED` request rejoins the same job rather than queuing a second one;
    /// a request that differs only in window from an already-`SUCCEEDED` or `FAILED` job for the
    /// same member and timeframe queues a new, distinct job.
    ///
    /// # Errors
    ///
    /// Returns [`BackfillJobErrorV1::InvalidRequest`] for an empty instrument or timeframe, or an
    /// empty window, and [`BackfillJobErrorV1::StoreUnavailable`] when the store cannot be
    /// reached.
    async fn queue(
        &self,
        request: BackfillJobRequestV1,
    ) -> Result<BindingDigest, BackfillJobErrorV1>;

    /// Appends a `RUNNING` transition for an existing `QUEUED` job.
    ///
    /// # Errors
    ///
    /// Returns [`BackfillJobErrorV1::JobUnknown`] for an unrecognised `job_id`, and
    /// [`BackfillJobErrorV1::InvalidTransition`] for a job whose current state is not `Queued`.
    async fn record_running(&self, job_id: BindingDigest) -> Result<(), BackfillJobErrorV1>;

    /// Appends the job's terminal `SUCCEEDED` transition.
    ///
    /// # Errors
    ///
    /// Returns [`BackfillJobErrorV1::JobUnknown`] for an unrecognised `job_id`, and
    /// [`BackfillJobErrorV1::InvalidTransition`] for a job already in a terminal state.
    async fn record_succeeded(
        &self,
        job_id: BindingDigest,
        custody_receipt_identity: BindingDigest,
        window_start_ns: u64,
        window_end_ns_exclusive: u64,
    ) -> Result<(), BackfillJobErrorV1>;

    /// Appends the job's terminal `FAILED` transition, naming why nothing was committed.
    ///
    /// # Errors
    ///
    /// Returns [`BackfillJobErrorV1::JobUnknown`] for an unrecognised `job_id`, and
    /// [`BackfillJobErrorV1::InvalidTransition`] for a job already in a terminal state.
    async fn record_failed(
        &self,
        job_id: BindingDigest,
        refusal_name: String,
    ) -> Result<(), BackfillJobErrorV1>;

    /// The named job's complete transition history.
    ///
    /// # Errors
    ///
    /// Returns [`BackfillJobErrorV1::JobUnknown`] for an unrecognised `job_id`.
    async fn status(
        &self,
        job_id: BindingDigest,
    ) -> Result<BackfillJobRecordV1, BackfillJobErrorV1>;

    /// The half-open ranges every `SUCCEEDED` job has covered for one instrument, one execution
    /// timeframe at a time, merged where they touch or overlap, in ascending order. States no
    /// market value: it answers only what has been committed, never a bar.
    ///
    /// # Errors
    ///
    /// Returns [`BackfillJobErrorV1::StoreUnavailable`] when the store cannot be reached.
    async fn coverage(
        &self,
        instrument: &str,
    ) -> Result<Vec<(String, Vec<BackfillCoverageRangeV1>)>, BackfillJobErrorV1>;
}

pub(crate) mod sealed {
    pub trait Sealed {}
}

/// Opens the sole configured backfill job intake, named by `MARKET_DATA_OWNER_DATABASE_URL`.
///
/// # Errors
///
/// Returns [`BackfillJobErrorV1::StoreUnavailable`] when the URL is missing or the store cannot
/// be opened.
pub async fn backfill_job_from_environment_v1()
-> Result<std::sync::Arc<dyn BackfillJobV1>, BackfillJobErrorV1> {
    super::postgres::backfill_job_from_environment_v1().await
}
