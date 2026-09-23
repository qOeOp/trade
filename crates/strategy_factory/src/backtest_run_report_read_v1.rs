//! The read of one committed run's `BacktestRunReport`: its strategy, its data, and its result.
//!
//! A committed exploratory run already persists the engine's canonical result beside its outcome
//! evidence, and that evidence already binds the exact bytes by digest and length. This module
//! reads those bytes back through the Backtest Owner's outcome readback and projects them into the
//! named result fields the Dashboard report contract asks for. It adds no second computation:
//! `OwnerBacktestReportV1` already reads a canonical result into a return series, net return,
//! maximum drawdown and executions.
//!
//! ## Where each half comes from
//!
//! The report contract says the strategy statement and the data window come from upstream rather
//! than from the backtest result, and a canonical result contains neither. So the read is three
//! reads in one transaction the report opens as `REPEATABLE READ, READ ONLY`: the outcome readback,
//! the replay request the run answered, and the Design and program frozen under the Design that
//! request names. `READ ONLY` is what keeps row locks off this path, by having PostgreSQL refuse
//! them.
//!
//! The strategy is stated only for the admitted single-threshold family, and only when authoring
//! the statement read back from the frozen pair reproduces that pair's canonical program exactly
//! (`recover_single_threshold_request_v1`). A run outside the family is refused as a whole,
//! because the report answers four questions or none.
//!
//! A run inside the family is also refused today, as `STRATEGY_NOT_ANCHORED_TO_RUN`. The request
//! names a Design, not the program its artifact was built from, and nothing the R&D Owner can read
//! without a lock ties the two together; see `anchor_frozen_program_to_run`. The data window is the channel's instrument
//! and timeframe with the request's window, its PIT snapshot count and that snapshot's identity.
//!
//! It does not carry the statistics maps. They legitimately hold `NaN` (an average winner when
//! there was no winning trade), and the report contract requires every numeric value to be finite.
//! The four named result quantities are the whole result.
//!
//! ## The series is the engine's returns, not one point per bar
//!
//! The engine builds its analyzer with `PortfolioAnalyzer::from_accounts_with_snapshots`. When the
//! run's portfolio snapshots span at least two UTC days, the series is one equity return per day.
//! When they do not, the analyzer falls back to one price return per closed position, which ignores
//! position size. Neither is one point per bar, so the length of this series is never asserted
//! against a bar count, and padding it to one point per bar would mean inventing points.
//!
//! Every value, the net return and the maximum drawdown are fractions, where 0.01 is one percent.
//! This projection does not yet carry which of the two returns a run produced, so nothing that
//! reads it may present these numbers as an equity return.
//!
//! ## Four states
//!
//! `Ok(None)` is an address with no committed run behind it. `Ok(Some)` carries a
//! [`BacktestRunReportStateV1`]: `Empty` is a run that exists and recorded no observations, and
//! `Available` is one that recorded at least one. `Err` is a read that could not be answered, and
//! it names why. The Owner decides the state, so a consumer never infers it from which fields are
//! present, and an empty chart cannot stand for a refused read.
//!
//! ## Checks this read does not repeat
//!
//! The custody readback that supplies the bytes already refuses a run whose stored identities
//! differ from the requested ones, and one whose engine bytes differ from the digest and length its
//! outcome evidence binds. Neither check is repeated here. A second copy would be a second place
//! for the rule to drift, and the first copy written for this module did drift: it hashed without
//! the binding domain, so it would have refused every real run while passing every test that
//! stopped short of committed custody.

use serde::Serialize;
use thiserror::Error;
use vibe_backtest::result::CanonicalBacktestResult;
use vibe_backtest_owner_contracts::{ContentIdentityV2, ReplayRequestDtoV2};
use vibe_backtest_result_custody::{
    BacktestReadbackRefusalV1, BacktestResultCustodyErrorV2, ExploratoryReplayResultLocatorV2,
};
use vibe_core::{UnixNanos, datetime::unix_nanos_to_iso8601};

use crate::{
    bounded_feature_program_v1::BoundedFeaturePredicateV1,
    develop_composer_v2::parse_digest_suffix,
    exploratory_replay::{
        ExploratoryReplayRecoverySelectorV2,
        postgres::{ReportRequestReadV2, read_for_report_in_transaction_v2},
    },
    owner_backtest_report_v1::{OwnerBacktestFillV1, OwnerBacktestReportV1},
    rd_bounded_feature_program_v1::read_frozen_design_program_in_transaction_v1,
    rd_owner_postgres_custody::resolve_exploratory_replay_outcome_for_rd_in_transaction,
    single_threshold_authoring_v1::{
        SingleThresholdChannelV1, SingleThresholdOutcomeV1, recover_single_threshold_request_v1,
    },
};

/// Why a committed run's report could not be read.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum BacktestRunReportRefusalV1 {
    /// The Backtest Owner answered and named why it could not answer with this run. Its code is the
    /// Owner's own, passed through so the cause reaches the consumer rather than a generic refusal:
    /// `OUTCOME_EVIDENCE_ABSENT` when a result, its receipt, outbox and semantic trace are committed
    /// but its outcome evidence is not.
    ///
    /// When more than one piece is missing, the code names the first the readback finds missing,
    /// and that order is not a contract. A result with neither a semantic trace nor outcome
    /// evidence answers `SEMANTIC_TRACE_ABSENT` today; a consumer must not rely on which of several
    /// missing pieces is named.
    #[error("the Backtest Owner refused the outcome readback: {0}")]
    OutcomeEvidenceRefused(BacktestReadbackRefusalV1),
    /// The Backtest Owner's custody could not be read at all.
    #[error("the Backtest Owner outcome readback is unavailable: {0}")]
    OutcomeEvidenceUnavailable(String),
    /// The committed engine bytes are not a canonical backtest result.
    #[error("committed engine result is not canonical: {0}")]
    EngineResultNoncanonical(String),
    /// A value the report must render is not finite.
    #[error("report value {0} is not finite")]
    NonFiniteValue(&'static str),
    /// Two series points share one timestamp, so the series cannot be strictly ordered.
    #[error("two series points share the timestamp {0}")]
    DuplicateSeriesTime(u64),
    /// An execution carries a side the report cannot state.
    #[error("execution side {0} is neither BUY nor SELL")]
    UnknownSide(String),
    /// An execution's price or quantity is not a plain decimal the report can display as written.
    #[error("execution {field} {value} is not a plain decimal")]
    DecimalNotPlain { field: &'static str, value: String },
    /// The report's read-only transaction could not be opened or closed.
    #[error("the report's read-only transaction is unavailable: {0}")]
    ReadTransactionUnavailable(String),
    /// The replay request the run answered could not be read back from R&D custody.
    #[error("the run's replay request is unavailable: {0}")]
    ReplayRequestUnavailable(String),
    /// The run's replay request is held only by Composer V3 custody, which this report does not
    /// read yet: that read locks rows, and the report reads in a read-only transaction.
    #[error(
        "the run's replay request is a Composer V3 request, which this report does not read yet"
    )]
    ReplayRequestV3NotYetReported,
    /// The frozen Design the request names could not be read, or did not verify.
    #[error("the run's frozen Design is unavailable")]
    FrozenDesignUnavailable,
    /// The run's program is not one the admitted single-threshold family authors, so no Owner
    /// statement of its strategy exists.
    #[error("no Owner statement of strategy exists for this program family")]
    NoStrategyStatementForFamily,
    /// The run's program is in the family, but nothing proves it is the program the run's
    /// artifact was built from, so stating it could describe a strategy the run did not execute.
    #[error("the frozen program cannot be anchored to the artifact this run executed")]
    StrategyNotAnchoredToRun,
}

impl BacktestRunReportRefusalV1 {
    /// Whether this refusal is the Owner's conclusion about the run, rather than a failure to read
    /// it.
    ///
    /// A consumer shows a conclusion as the report's state and treats a failure to read as the read
    /// being unavailable. The match lists every variant and has no wildcard arm, so a new variant
    /// does not compile until someone decides which it is, here where it is defined.
    #[must_use]
    pub const fn is_owner_judgement(&self) -> bool {
        match self {
            Self::OutcomeEvidenceUnavailable(_)
            | Self::ReadTransactionUnavailable(_)
            | Self::ReplayRequestUnavailable(_)
            | Self::FrozenDesignUnavailable => false,
            Self::OutcomeEvidenceRefused(_)
            | Self::EngineResultNoncanonical(_)
            | Self::NonFiniteValue(_)
            | Self::DuplicateSeriesTime(_)
            | Self::UnknownSide(_)
            | Self::DecimalNotPlain { .. }
            | Self::ReplayRequestV3NotYetReported
            | Self::NoStrategyStatementForFamily
            | Self::StrategyNotAnchoredToRun => true,
        }
    }

    /// Returns the stable code a consumer asserts on, rather than a sentence it would have to
    /// match.
    #[must_use]
    pub const fn code(&self) -> &'static str {
        match self {
            Self::OutcomeEvidenceRefused(refusal) => refusal.code(),
            Self::OutcomeEvidenceUnavailable(_) => "OUTCOME_EVIDENCE_UNAVAILABLE",
            Self::EngineResultNoncanonical(_) => "ENGINE_RESULT_NONCANONICAL",
            Self::NonFiniteValue(_) => "NON_FINITE_VALUE",
            Self::DuplicateSeriesTime(_) => "DUPLICATE_SERIES_TIME",
            Self::UnknownSide(_) => "UNKNOWN_SIDE",
            Self::DecimalNotPlain { .. } => "DECIMAL_NOT_PLAIN",
            Self::ReadTransactionUnavailable(_) => "READ_TRANSACTION_UNAVAILABLE",
            Self::ReplayRequestUnavailable(_) => "REPLAY_REQUEST_UNAVAILABLE",
            Self::ReplayRequestV3NotYetReported => "REPLAY_REQUEST_V3_NOT_YET_REPORTED",
            Self::FrozenDesignUnavailable => "FROZEN_DESIGN_UNAVAILABLE",
            Self::NoStrategyStatementForFamily => "NO_STRATEGY_STATEMENT_FOR_FAMILY",
            Self::StrategyNotAnchoredToRun => "STRATEGY_NOT_ANCHORED_TO_RUN",
        }
    }
}

/// Whether a committed run recorded anything to draw.
///
/// Serializes as its [`Self::code`], which is the only spelling a consumer receives.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BacktestRunReportStateV1 {
    /// The run recorded at least one observation, and both result quantities are present.
    Available,
    /// The run recorded no observation, and both result quantities are absent. Executions may
    /// still be present: a run can trade without recording a return.
    Empty,
}

impl BacktestRunReportStateV1 {
    /// Returns the stable code a consumer switches on.
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::Available => "AVAILABLE",
            Self::Empty => "EMPTY",
        }
    }
}

/// Which committed run a report was read from.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct BacktestRunIdentityV1 {
    pub result_identity: String,
    pub request_identity: String,
    pub attempt_identity: String,
    /// The digest the run's outcome evidence binds for the exact engine bytes this was read from.
    pub engine_result_digest: String,
}

/// One observation of the run's return series.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct BacktestRunReportPointV1 {
    /// RFC 3339 with exactly nine fractional digits and a `Z` offset.
    pub at: String,
    /// A fraction, where 0.01 is one percent.
    pub value: f64,
}

/// One execution the run produced.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct BacktestRunReportFillV1 {
    /// RFC 3339 with exactly nine fractional digits and a `Z` offset.
    pub at: String,
    /// `BUY` or `SELL`.
    pub side: String,
    /// The fill price exactly as the engine wrote it: the instrument's price precision, trailing
    /// zeros kept, a leading `-` allowed, never an exponent.
    pub price: String,
    /// The filled quantity exactly as the engine wrote it: the instrument's size precision,
    /// trailing zeros kept, never signed, never an exponent.
    pub quantity: String,
}

/// The strategy a run executed, as the admitted single-threshold family states it.
///
/// Every field is read back from the frozen Design and program and then proven by authoring them
/// again, so this is the statement the program runs, not a description of it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct BacktestRunStrategyV1 {
    /// Always [`SINGLE_THRESHOLD_FAMILY_V1`]: a run outside the family has no statement at all.
    pub family: &'static str,
    /// The one Market Data channel the program reads, which is also its decision clock.
    pub channel: SingleThresholdChannelV1,
    /// The threshold as a plain decimal in the channel's unit, at the channel's scale.
    pub threshold: String,
    /// How the channel is compared against the threshold, e.g. `GREATER`.
    pub comparison: BoundedFeaturePredicateV1,
    /// What the program proposes when the comparison holds.
    pub when_true: SingleThresholdOutcomeV1,
    /// What it proposes otherwise.
    pub otherwise: SingleThresholdOutcomeV1,
    /// The statement the program can be wrong about.
    pub falsifier: String,
}

/// The one strategy family this report can state.
pub const SINGLE_THRESHOLD_FAMILY_V1: &str = "SINGLE_THRESHOLD_V1";

/// The data a run consumed, as its replay request bound it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct BacktestRunDataWindowV1 {
    /// The channel's instrument.
    pub instrument: String,
    /// The channel's bar timeframe.
    pub granularity: String,
    /// Canonical UTC of the window's first event.
    pub start: String,
    /// Canonical UTC of the window's end. The end is exclusive: no event at this instant is in
    /// the window.
    pub end_exclusive: String,
    /// How many PIT snapshots the request binds.
    pub snapshot_count: u64,
    /// The identity of the PIT snapshot the request binds, which is the data cut the run consumed.
    pub cut_identity: String,
}

/// One committed run's `BacktestRunReport`: which run, what strategy, on which data, and what it
/// produced.
///
/// This type's serialization is the wire shape: one flat object, field names as written here,
/// absent quantities as `null` rather than omitted, and every number finite, so a consumer never
/// has to define it.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct BacktestRunReportProjectionV1 {
    pub run: BacktestRunIdentityV1,
    pub strategy: BacktestRunStrategyV1,
    pub data_window: BacktestRunDataWindowV1,
    #[serde(flatten)]
    pub result: BacktestRunResultV1,
}

/// What a run produced, read from its committed canonical result.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct BacktestRunResultV1 {
    /// Decided by the Owner from the series, so a consumer never infers it.
    pub state: BacktestRunReportStateV1,
    /// Every observation the run recorded, strictly ordered by time.
    pub series: Vec<BacktestRunReportPointV1>,
    /// A fraction, where 0.01 is one percent. Absent exactly when [`Self::state`] is `Empty`.
    ///
    /// Not necessarily an equity return: a run whose portfolio snapshots span fewer than two UTC
    /// days compounds closed-position price returns instead, and this projection does not yet
    /// carry which.
    pub net_return: Option<f64>,
    /// A fraction in `[-1, 0]`, on the same basis as [`Self::net_return`]. Absent exactly when
    /// [`Self::state`] is `Empty`.
    pub max_drawdown: Option<f64>,
    /// Always equal to `fills.len()`.
    pub fill_count: u64,
    /// Every execution, in run order. Two executions may share a timestamp.
    pub fills: Vec<BacktestRunReportFillV1>,
}

/// Formats one engine timestamp for the report.
///
/// The report contract fixes canonical UTC as RFC 3339 with exactly nine fractional digits and a
/// `Z` offset. `vibe_core::datetime::unix_nanos_to_iso8601` already produces exactly that for every
/// `u64` nanosecond value, whose largest instant falls in the year 2554, so this conversion is
/// total and has no failure branch to report. It stays one named function so that the format has
/// one place to change.
#[must_use]
pub fn canonical_utc_v1(nanos: u64) -> String {
    unix_nanos_to_iso8601(UnixNanos::from(nanos))
}

/// Reads one committed run's report through the R&D Owner pool.
///
/// Three reads, all in one transaction this function opens as `REPEATABLE READ, READ ONLY`: the
/// run's outcome readback from Backtest custody, the replay request it answered, and the Design
/// and program frozen under the Design that request names. `REPEATABLE READ` gives the three one
/// snapshot. `READ ONLY` makes PostgreSQL refuse any row lock on this path, so a read that locks
/// fails on its first call and names itself, instead of holding a lock until the report returns.
/// A shared row lock held on a read path is what deadlocked the Dashboard read in entry 28.
///
/// # Errors
///
/// Returns the refusal naming why the read could not be answered. `Ok(None)` is an address with no
/// committed run behind it, which is an empty result rather than a refusal. A run whose program is
/// outside the single-threshold family is refused as a whole with
/// [`BacktestRunReportRefusalV1::NoStrategyStatementForFamily`]: the report answers four questions
/// or none.
pub async fn resolve_backtest_run_report_v1(
    pool: &sqlx::PgPool,
    locator: ExploratoryReplayResultLocatorV2<'_>,
) -> Result<Option<BacktestRunReportProjectionV1>, BacktestRunReportRefusalV1> {
    let mut transaction = begin_report_read_v1(pool).await?;
    let report = read_report_in_transaction(&mut transaction, locator).await;
    // Nothing a read-only transaction did can need keeping, and a refusal is still a completed
    // read, so the transaction ends the same way on every path.
    transaction
        .rollback()
        .await
        .map_err(|e| BacktestRunReportRefusalV1::ReadTransactionUnavailable(e.to_string()))?;
    report
}

/// Opens the report's `REPEATABLE READ, READ ONLY` transaction.
///
/// `SET TRANSACTION` must be the transaction's first statement, which is why the report opens its
/// own rather than taking one from its caller.
pub(crate) async fn begin_report_read_v1(
    pool: &sqlx::PgPool,
) -> Result<sqlx::Transaction<'static, sqlx::Postgres>, BacktestRunReportRefusalV1> {
    let unavailable =
        |e: sqlx::Error| BacktestRunReportRefusalV1::ReadTransactionUnavailable(e.to_string());
    let mut transaction = pool.begin().await.map_err(unavailable)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        .execute(&mut *transaction)
        .await
        .map_err(unavailable)?;
    Ok(transaction)
}

/// The report's three reads inside a transaction the caller opened with [`begin_report_read_v1`].
pub(crate) async fn read_report_in_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    locator: ExploratoryReplayResultLocatorV2<'_>,
) -> Result<Option<BacktestRunReportProjectionV1>, BacktestRunReportRefusalV1> {
    let Some(read) = resolve_backtest_run_result_v1(transaction, locator).await? else {
        return Ok(None);
    };
    let request = match read_for_report_in_transaction_v2(
        transaction,
        &ExploratoryReplayRecoverySelectorV2 {
            request_identity: read.run.request_identity.clone(),
            meaning_digest: read.request_meaning_digest.clone(),
        },
    )
    .await
    .map_err(|e| BacktestRunReportRefusalV1::ReplayRequestUnavailable(e.to_string()))?
    {
        ReportRequestReadV2::Found(request) => request,
        ReportRequestReadV2::ComposerV3 => {
            return Err(BacktestRunReportRefusalV1::ReplayRequestV3NotYetReported);
        }
        ReportRequestReadV2::Absent => {
            return Err(BacktestRunReportRefusalV1::ReplayRequestUnavailable(
                "no sealed request at the meaning the outcome evidence binds".to_owned(),
            ));
        }
    };
    let (strategy, data_window) =
        resolve_strategy_and_window(transaction, request.request().as_dto()).await?;

    Ok(Some(BacktestRunReportProjectionV1 {
        run: read.run,
        strategy,
        data_window,
        result: read.result,
    }))
}

/// The result half of one run's report, with what the other half needs to find its request.
pub(crate) struct BacktestRunResultReadV1 {
    pub(crate) run: BacktestRunIdentityV1,
    pub(crate) request_meaning_digest: String,
    pub(crate) result: BacktestRunResultV1,
}

/// Reads only what a run produced, from Backtest custody, in the caller's transaction.
///
/// It is the first of [`resolve_backtest_run_report_v1`]'s reads, separate so that what a run
/// produced can be read and proven for a run whose strategy this report cannot state.
///
/// # Errors
///
/// The same outcome and engine-result refusals as [`resolve_backtest_run_report_v1`].
pub(crate) async fn resolve_backtest_run_result_v1(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    locator: ExploratoryReplayResultLocatorV2<'_>,
) -> Result<Option<BacktestRunResultReadV1>, BacktestRunReportRefusalV1> {
    let Some(locked) =
        resolve_exploratory_replay_outcome_for_rd_in_transaction(transaction, locator)
            .await
            .map_err(|e| match e {
                BacktestResultCustodyErrorV2::Refused(refusal) => {
                    BacktestRunReportRefusalV1::OutcomeEvidenceRefused(refusal)
                }
                other => BacktestRunReportRefusalV1::OutcomeEvidenceUnavailable(other.to_string()),
            })?
    else {
        return Ok(None);
    };
    let evidence = locked.outcome_evidence();
    Ok(Some(BacktestRunResultReadV1 {
        run: BacktestRunIdentityV1 {
            result_identity: evidence.result_identity.as_str().to_owned(),
            request_identity: evidence.request_identity.as_str().to_owned(),
            attempt_identity: evidence.attempt_identity.as_str().to_owned(),
            engine_result_digest: evidence
                .canonical_result
                .canonical_bytes_digest
                .as_str()
                .to_owned(),
        },
        request_meaning_digest: evidence.request_meaning_digest.as_str().to_owned(),
        result: project_engine_result_v1(locked.engine_canonical_result_bytes())?,
    }))
}

/// States the strategy and data window of the run a replay request describes.
async fn resolve_strategy_and_window(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    request: &ReplayRequestDtoV2,
) -> Result<(BacktestRunStrategyV1, BacktestRunDataWindowV1), BacktestRunReportRefusalV1> {
    // Composer-backed requests name their Design as `sha256:` identity and digest. A Design named
    // any other way was not frozen with a bounded program, so no program of this family exists.
    let (Some(design_identity), Some(design_digest)) = (
        parse_digest_suffix(request.strategy_design.identity.as_str(), "sha256:"),
        parse_digest_suffix(request.strategy_design.digest.as_str(), "sha256:"),
    ) else {
        return Err(BacktestRunReportRefusalV1::NoStrategyStatementForFamily);
    };
    let (design, program) =
        read_frozen_design_program_in_transaction_v1(transaction, design_identity, design_digest)
            .await
            .map_err(|_| BacktestRunReportRefusalV1::FrozenDesignUnavailable)?
            .ok_or(BacktestRunReportRefusalV1::NoStrategyStatementForFamily)?;
    let authored = recover_single_threshold_request_v1(&design, &program)
        .ok_or(BacktestRunReportRefusalV1::NoStrategyStatementForFamily)?;
    anchor_frozen_program_to_run(request)?;

    // Typed on purpose. The request binds one PIT snapshot today; when it binds several, this
    // field changes type and the annotation stops compiling, instead of `from_ref` quietly
    // counting one collection as one snapshot.
    let snapshots: &[ContentIdentityV2] = std::slice::from_ref(&request.pit_snapshot);
    let data_window = BacktestRunDataWindowV1 {
        instrument: authored.channel.instrument.clone(),
        granularity: authored.channel.timeframe.clone(),
        start: canonical_utc_v1(request.window.start_event_ns),
        end_exclusive: canonical_utc_v1(request.window.end_event_ns_exclusive),
        snapshot_count: u64::try_from(snapshots.len()).unwrap_or(u64::MAX),
        cut_identity: request.pit_snapshot.identity.as_str().to_owned(),
    };
    let strategy = BacktestRunStrategyV1 {
        family: SINGLE_THRESHOLD_FAMILY_V1,
        threshold: fixed_point_decimal(authored.threshold_coefficient, authored.channel.scale),
        channel: authored.channel,
        comparison: authored.comparison,
        when_true: authored.when_true,
        otherwise: authored.otherwise,
        falsifier: authored.falsifier,
    };
    Ok((strategy, data_window))
}

/// Proves the frozen program is the one the run's artifact was built from, or refuses.
///
/// The request names its Design, and the freeze table holds one program per Design, but a Design
/// does not decide which program a run executed: the artifact does. Composer seals a V3 plugin
/// build to the joint freeze it was built from, and the anchor is that build receipt's
/// `joint_freeze_digest` equalling the freeze row's. A V2 build carries no joint freeze at all,
/// and Composer accepts one for any Design, so an artifact built that way can never be anchored.
///
/// The build receipts live in Composer custody, and no Composer Owner API function lets the R&D
/// Owner read them without locking: the only one it may call, `lock_accepted_develop_composer_v2`,
/// takes a table-level SHARE lock on Composer custody, which blocks Composer's writers for as long
/// as the caller's transaction runs, and a report must not hold that on a read path. Until a lock-free read exists, nothing can prove the anchor, so every run is
/// refused here rather than stated from its Design alone. Stating a strategy the run did not
/// execute is the error this report exists to rule out.
///
/// It takes the request because the anchor it will check is the request's `artifact`.
///
/// # Errors
///
/// Always [`BacktestRunReportRefusalV1::StrategyNotAnchoredToRun`] today.
const fn anchor_frozen_program_to_run(
    _request: &ReplayRequestDtoV2,
) -> Result<(), BacktestRunReportRefusalV1> {
    Err(BacktestRunReportRefusalV1::StrategyNotAnchoredToRun)
}

/// Writes a fixed-point coefficient as a plain decimal with exactly `scale` fractional digits.
///
/// Exact for every `i128`, which a conversion through a decimal type with a narrower mantissa is
/// not, and in the same plain form the report uses for prices.
fn fixed_point_decimal(coefficient: i128, scale: u8) -> String {
    let digits = coefficient.unsigned_abs().to_string();
    let scale = usize::from(scale);
    let digits = format!("{digits:0>width$}", width = scale + 1);
    let (whole, fraction) = digits.split_at(digits.len() - scale);
    let sign = if coefficient < 0 { "-" } else { "" };
    if fraction.is_empty() {
        format!("{sign}{whole}")
    } else {
        format!("{sign}{whole}.{fraction}")
    }
}

fn project_engine_result_v1(
    engine_result_bytes: &[u8],
) -> Result<BacktestRunResultV1, BacktestRunReportRefusalV1> {
    let canonical = CanonicalBacktestResult::from_slice(engine_result_bytes)
        .map_err(|e| BacktestRunReportRefusalV1::EngineResultNoncanonical(format!("{e:#}")))?;
    let report = OwnerBacktestReportV1::from_canonical_result(&canonical)
        .map_err(|e| BacktestRunReportRefusalV1::EngineResultNoncanonical(format!("{e:#}")))?;

    let series = project_series(&report.returns_series)?;

    if let Some(value) = report.net_return {
        finite("net_return", value)?;
    }

    if let Some(value) = report.max_drawdown {
        finite("max_drawdown", value)?;
    }
    let fills = report
        .fills
        .iter()
        .map(project_fill)
        .collect::<Result<Vec<_>, _>>()?;

    // `OwnerBacktestReportV1` sets both quantities exactly when the series is non-empty, so the
    // series alone decides the state.
    let state = if series.is_empty() {
        BacktestRunReportStateV1::Empty
    } else {
        BacktestRunReportStateV1::Available
    };

    Ok(BacktestRunResultV1 {
        state,
        series,
        net_return: report.net_return,
        max_drawdown: report.max_drawdown,
        fill_count: u64::try_from(fills.len()).unwrap_or(u64::MAX),
        fills,
    })
}

/// `OwnerBacktestReportV1` returns the series in timestamp order, so the only way it can fail to be
/// strictly ordered is two points at one instant.
fn project_series(
    returns_series: &[(u64, f64)],
) -> Result<Vec<BacktestRunReportPointV1>, BacktestRunReportRefusalV1> {
    let mut series = Vec::with_capacity(returns_series.len());
    let mut previous: Option<u64> = None;

    for &(timestamp, value) in returns_series {
        if previous == Some(timestamp) {
            return Err(BacktestRunReportRefusalV1::DuplicateSeriesTime(timestamp));
        }
        finite("series", value)?;
        series.push(BacktestRunReportPointV1 {
            at: canonical_utc_v1(timestamp),
            value,
        });
        previous = Some(timestamp);
    }
    Ok(series)
}

fn project_fill(
    fill: &OwnerBacktestFillV1,
) -> Result<BacktestRunReportFillV1, BacktestRunReportRefusalV1> {
    if fill.order_side != "BUY" && fill.order_side != "SELL" {
        return Err(BacktestRunReportRefusalV1::UnknownSide(
            fill.order_side.clone(),
        ));
    }
    plain_decimal("price", &fill.last_px, true)?;
    plain_decimal("quantity", &fill.last_qty, false)?;
    Ok(BacktestRunReportFillV1 {
        at: canonical_utc_v1(fill.ts_event_ns),
        side: fill.order_side.clone(),
        price: fill.last_px.clone(),
        quantity: fill.last_qty.clone(),
    })
}

fn finite(field: &'static str, value: f64) -> Result<(), BacktestRunReportRefusalV1> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(BacktestRunReportRefusalV1::NonFiniteValue(field))
    }
}

/// Accepts the decimals `Price` and `Quantity` display: digits, then optionally a point and more
/// digits, with a leading `-` only where the value may be signed.
fn plain_decimal(
    field: &'static str,
    value: &str,
    signed: bool,
) -> Result<(), BacktestRunReportRefusalV1> {
    let unsigned = if signed {
        value.strip_prefix('-').unwrap_or(value)
    } else {
        value
    };
    let (whole, fraction) = unsigned.split_once('.').unwrap_or((unsigned, "0"));
    let digits = |part: &str| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit());

    if digits(whole) && digits(fraction) {
        Ok(())
    } else {
        Err(BacktestRunReportRefusalV1::DecimalNotPlain {
            field,
            value: value.to_owned(),
        })
    }
}

/// One real engine run whose series spans several UTC days, and readers that check a report of it
/// without the code under test.
#[cfg(test)]
pub(crate) mod report_test_support_v1 {
    use vibe_backtest::{
        config::{BacktestEngineConfig, SimulatedVenueConfig},
        engine::BacktestEngine,
        result::CanonicalBacktestResult,
    };
    use vibe_model::{
        data::{Data, QuoteTick},
        enums::{AccountType, BookType, OmsType},
        identifiers::{InstrumentId, Symbol, Venue},
        instruments::{CryptoPerpetual, InstrumentAny},
        types::{Currency, Money, Price, Quantity},
    };
    use vibe_trading::examples::strategies::EmaCross;

    const RUN_CONFIG_ID: &str = "backtest-run-report-multi-day-v1";
    const INSTRUMENT: &str = "BTCUSDT-PERP.SIM";
    /// 2024-01-01T00:00:00Z, so the run crosses real UTC midnights rather than starting at the
    /// epoch.
    const FIRST_QUOTE_NS: u64 = 1_704_067_200_000_000_000;
    const HOUR_NS: u64 = 3_600_000_000_000;
    /// Four days of hourly quotes.
    const QUOTES: u64 = 96;

    /// Runs the engine, the simulated venue and the portfolio over four days of hourly quotes.
    ///
    /// THE QUOTES ARE CONSTRUCTED, NOT MARKET DATA. They rise, fall and rise again so a 2/3 EMA
    /// crossing opens, closes and reopens a position across different UTC days; that is the only
    /// thing their shape was chosen for. Nothing asserts what the run earns, and the equity
    /// observation cadence is the engine's default: no snapshot interval is configured, so every
    /// point the series carries is one the engine records for any run of this length.
    pub(crate) fn run_multi_day_round_trip_v1() -> CanonicalBacktestResult {
        let instrument_id = InstrumentId::from(INSTRUMENT);
        let mut engine = BacktestEngine::new(BacktestEngineConfig {
            bypass_logging: true,
            run_analysis: false,
            ..Default::default()
        })
        .expect("backtest engine");
        engine
            .add_venue(
                SimulatedVenueConfig::builder()
                    .venue(Venue::from("SIM"))
                    .oms_type(OmsType::Netting)
                    .account_type(AccountType::Margin)
                    .book_type(BookType::L1_MBP)
                    .starting_balances(vec![Money::from("1_000_000 USD")])
                    .bar_execution(false)
                    .use_random_ids(false)
                    .build()
                    .expect("simulated venue config"),
            )
            .expect("simulated venue");
        engine
            .add_instrument(&instrument())
            .expect("perpetual instrument");
        engine
            .add_strategy(EmaCross::new(instrument_id, Quantity::from("1"), 2, 3))
            .expect("EMA cross strategy");
        engine
            .add_data(quotes(instrument_id), None, true, true)
            .expect("constructed quotes");
        engine
            .run(None, None, Some(RUN_CONFIG_ID.to_owned()), false)
            .expect("engine run");
        engine.get_canonical_result().expect("canonical result")
    }

    /// Reads the series straight out of the canonical JSON, without `OwnerBacktestReportV1`, so a
    /// fault in the Owner's reader cannot agree with itself.
    pub(crate) fn independently_counted_points(engine_result_bytes: &[u8]) -> Vec<(u64, f64)> {
        let document: serde_json::Value =
            serde_json::from_slice(engine_result_bytes).expect("engine JSON");
        let mut points = document["statistics"]["returns_series"]
            .as_array()
            .expect("returns_series array")
            .iter()
            .map(|entry| {
                let timestamp = entry["timestamp_ns"]
                    .as_str()
                    .expect("timestamp text")
                    .parse::<u64>()
                    .expect("timestamp nanoseconds");
                let bits = u64::from_str_radix(entry["value"].as_str().expect("value text"), 16)
                    .expect("finite values are sixteen hex digits");
                (timestamp, f64::from_bits(bits))
            })
            .collect::<Vec<_>>();
        points.sort_by_key(|&(timestamp, _)| timestamp);
        points
    }

    /// Checks the report's time spelling and returns the instant it names, parsed by `jiff` rather
    /// than by the formatter that wrote it.
    pub(crate) fn instant_of(at: &str) -> u64 {
        let bytes = at.as_bytes();
        assert_eq!(bytes.len(), 30, "{at} is not RFC 3339 with nine digits");
        assert_eq!(bytes[19], b'.', "{at} has no fractional point");
        assert!(bytes[20..29].iter().all(u8::is_ascii_digit), "{at}");
        assert_eq!(bytes[29], b'Z', "{at} is not UTC");
        u64::try_from(
            at.parse::<jiff::Timestamp>()
                .expect("RFC 3339 instant")
                .as_nanosecond(),
        )
        .expect("an engine instant is after the epoch")
    }

    /// The one comparison both the unit test and the ordered-chain entry make: every point the
    /// report carries equals, in order, timestamp and value, a point counted independently from
    /// `engine_result_bytes`, and there are at least two, so a dropped point cannot hide.
    ///
    /// It is one function so that the mutations proven against the unit test prove this comparison
    /// wherever it runs, rather than a copy of it.
    pub(crate) fn assert_series_reads_back_every_counted_point(
        series: &[super::BacktestRunReportPointV1],
        engine_result_bytes: &[u8],
    ) {
        let expected = independently_counted_points(engine_result_bytes);
        assert!(
            expected.len() >= 2,
            "a dropped point is only visible when the run recorded at least two, it recorded {}",
            expected.len()
        );
        let read_back = series
            .iter()
            .map(|point| (instant_of(&point.at), point.value))
            .collect::<Vec<_>>();
        assert_eq!(read_back, expected);
    }

    fn instrument() -> InstrumentAny {
        InstrumentAny::CryptoPerpetual(CryptoPerpetual::new(
            InstrumentId::from(INSTRUMENT),
            Symbol::from("BTCUSDT-PERP"),
            Currency::BTC(),
            Currency::USD(),
            Currency::USD(),
            false,
            2,
            0,
            Price::from("0.01"),
            Quantity::from("1"),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            0.into(),
            0.into(),
        ))
    }

    fn quotes(instrument_id: InstrumentId) -> Vec<Data> {
        let mut price = 100.0_f64;
        (0..QUOTES)
            .map(|ordinal| {
                match ordinal {
                    0..3 => {}
                    3..40 | 60.. => price += 0.5,
                    _ => price -= 0.5,
                }
                let ts = FIRST_QUOTE_NS + ordinal * HOUR_NS;
                Data::Quote(QuoteTick::new(
                    instrument_id,
                    Price::new(price - 0.01, 2),
                    Price::new(price + 0.01, 2),
                    Quantity::from("100"),
                    Quantity::from("100"),
                    ts.into(),
                    ts.into(),
                ))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::{
        report_test_support_v1::{
            assert_series_reads_back_every_counted_point, instant_of, run_multi_day_round_trip_v1,
        },
        *,
    };

    fn run() -> BacktestRunIdentityV1 {
        BacktestRunIdentityV1 {
            result_identity: "backtest-result-1".to_owned(),
            request_identity: "exploratory-request-1".to_owned(),
            attempt_identity: "backtest-attempt-1".to_owned(),
            engine_result_digest: format!("blake3:{}", "e".repeat(64)),
        }
    }

    fn engine_bytes() -> Vec<u8> {
        run_multi_day_round_trip_v1()
            .to_bytes()
            .expect("canonical engine bytes")
    }

    fn fill(side: &str, price: &str, quantity: &str) -> OwnerBacktestFillV1 {
        OwnerBacktestFillV1 {
            ts_event_ns: 1_704_067_200_000_000_000,
            order_event_ordinal: 2,
            client_order_id: "O-1".to_owned(),
            instrument_id: "BTCUSDT-PERP.SIM".to_owned(),
            order_side: side.to_owned(),
            last_qty: quantity.to_owned(),
            last_px: price.to_owned(),
            commission: None,
        }
    }

    #[rstest]
    fn a_real_multi_day_run_projects_every_point_it_recorded_and_nothing_else() {
        let bytes = engine_bytes();
        let result = project_engine_result_v1(&bytes).expect("result projection");

        assert_eq!(result.state, BacktestRunReportStateV1::Available);
        assert_series_reads_back_every_counted_point(&result.series, &bytes);
        assert!(result.net_return.is_some_and(f64::is_finite));
        assert!(result.max_drawdown.is_some_and(|value| value <= 0.0));
        assert!(!result.fills.is_empty(), "the run must have traded");
        assert_eq!(result.fill_count, result.fills.len() as u64);
    }

    #[rstest]
    fn a_run_that_recorded_no_point_is_empty_and_keeps_its_executions() {
        let mut document: serde_json::Value =
            serde_json::from_slice(&engine_bytes()).expect("engine JSON");
        document["statistics"]["returns_series"] = serde_json::json!([]);
        let bytes = serde_json::to_vec(&document).expect("edited engine bytes");

        let result = project_engine_result_v1(&bytes).expect("result projection");

        assert_eq!(result.state, BacktestRunReportStateV1::Empty);
        assert!(result.series.is_empty());
        assert_eq!(result.net_return, None);
        assert_eq!(result.max_drawdown, None);
        assert!(!result.fills.is_empty());
    }

    #[rstest]
    fn bytes_that_are_not_the_canonical_encoding_are_refused() {
        let mut bytes = engine_bytes();
        bytes.push(b' ');

        assert_eq!(
            project_engine_result_v1(&bytes)
                .expect_err("trailing byte")
                .code(),
            "ENGINE_RESULT_NONCANONICAL"
        );
    }

    #[rstest]
    fn a_series_point_at_an_instant_already_used_is_refused() {
        assert_eq!(
            project_series(&[(10, 0.1), (10, 0.2)]),
            Err(BacktestRunReportRefusalV1::DuplicateSeriesTime(10))
        );
        assert_eq!(
            project_series(&[(10, 0.1), (11, 0.2)])
                .expect("strictly ordered")
                .len(),
            2
        );
    }

    #[rstest]
    #[case(f64::NAN)]
    #[case(f64::INFINITY)]
    #[case(f64::NEG_INFINITY)]
    fn a_non_finite_series_value_is_refused(#[case] value: f64) {
        assert_eq!(
            project_series(&[(10, 0.1), (11, value)]),
            Err(BacktestRunReportRefusalV1::NonFiniteValue("series"))
        );
    }

    #[rstest]
    #[case("BUY")]
    #[case("SELL")]
    fn a_stated_side_is_carried_as_written(#[case] side: &str) {
        let projected = project_fill(&fill(side, "187.25", "2.0")).expect("fill");

        assert_eq!(projected.side, side);
        assert_eq!(projected.price, "187.25");
        assert_eq!(projected.quantity, "2.0");
        assert_eq!(projected.at, "2024-01-01T00:00:00.000000000Z");
    }

    #[rstest]
    #[case("NO_ORDER_SIDE")]
    #[case("buy")]
    #[case("")]
    fn a_side_the_report_cannot_state_is_refused(#[case] side: &str) {
        assert_eq!(
            project_fill(&fill(side, "1", "1")),
            Err(BacktestRunReportRefusalV1::UnknownSide(side.to_owned()))
        );
    }

    #[rstest]
    #[case("187")]
    #[case("187.25")]
    #[case("-0.50")]
    #[case("0.0000000000000001")]
    fn a_plain_price_is_accepted(#[case] price: &str) {
        assert!(project_fill(&fill("BUY", price, "1")).is_ok());
    }

    #[rstest]
    #[case("1e3")]
    #[case("+1")]
    #[case("1.")]
    #[case(".5")]
    #[case("1,000")]
    #[case("--1")]
    #[case("")]
    fn a_price_that_is_not_plain_is_refused(#[case] price: &str) {
        assert_eq!(
            project_fill(&fill("BUY", price, "1")),
            Err(BacktestRunReportRefusalV1::DecimalNotPlain {
                field: "price",
                value: price.to_owned(),
            })
        );
    }

    #[rstest]
    #[case("-1")]
    #[case("1e3")]
    fn a_quantity_that_is_signed_or_not_plain_is_refused(#[case] quantity: &str) {
        assert_eq!(
            project_fill(&fill("BUY", "1", quantity)),
            Err(BacktestRunReportRefusalV1::DecimalNotPlain {
                field: "quantity",
                value: quantity.to_owned(),
            })
        );
    }

    #[rstest]
    #[case(0, "1970-01-01T00:00:00.000000000Z")]
    #[case(1_704_067_200_000_000_001, "2024-01-01T00:00:00.000000001Z")]
    #[case(u64::MAX, "2554-07-21T23:34:33.709551615Z")]
    fn every_engine_instant_has_one_canonical_spelling(#[case] nanos: u64, #[case] at: &str) {
        assert_eq!(canonical_utc_v1(nanos), at);
        assert_eq!(instant_of(at), nanos);
    }

    fn strategy() -> BacktestRunStrategyV1 {
        let outcome = |position: &str, units| SingleThresholdOutcomeV1 {
            position_intent_semantic_id: position.to_owned(),
            target_variant_semantic_id: "kernel.target.position.v1".to_owned(),
            target_position_units: units,
        };
        BacktestRunStrategyV1 {
            family: SINGLE_THRESHOLD_FAMILY_V1,
            channel: SingleThresholdChannelV1 {
                role_semantic_id: "research.input.close.daily.v1".to_owned(),
                instrument: "BTCUSDT-PERP.BINANCE".to_owned(),
                field_semantic_id: "MARKET_DATA.BAR.CLOSE.PRICE.V1".to_owned(),
                timeframe: "1D".to_owned(),
                unit: "PRICE".to_owned(),
                scale: 2,
            },
            threshold: fixed_point_decimal(10_000, 2),
            comparison: BoundedFeaturePredicateV1::Greater,
            when_true: outcome("kernel.position.enter.v1", 1),
            otherwise: outcome("kernel.position.exit.v1", 0),
            falsifier: "the channel never crosses the threshold".to_owned(),
        }
    }

    fn data_window() -> BacktestRunDataWindowV1 {
        BacktestRunDataWindowV1 {
            instrument: "BTCUSDT-PERP.BINANCE".to_owned(),
            granularity: "1D".to_owned(),
            start: canonical_utc_v1(1_704_067_200_000_000_000),
            end_exclusive: canonical_utc_v1(1_704_412_800_000_000_000),
            snapshot_count: 1,
            cut_identity: format!("sha256:{}", "c".repeat(64)),
        }
    }

    #[rstest]
    fn the_wire_shape_is_the_owner_s_and_keeps_absent_quantities_as_null() {
        let mut document: serde_json::Value =
            serde_json::from_slice(&engine_bytes()).expect("engine JSON");
        let projection = |document: &serde_json::Value| {
            serde_json::to_value(BacktestRunReportProjectionV1 {
                run: run(),
                strategy: strategy(),
                data_window: data_window(),
                result: project_engine_result_v1(&serde_json::to_vec(document).expect("bytes"))
                    .expect("result projection"),
            })
            .expect("wire value")
        };
        let available = projection(&document);
        document["statistics"]["returns_series"] = serde_json::json!([]);
        let empty = projection(&document);

        // Sorted, so the comparison does not depend on whether `serde_json` preserves order in
        // whichever feature set this build unified.
        let keys = |value: &serde_json::Value| {
            let mut keys = value
                .as_object()
                .expect("object")
                .keys()
                .cloned()
                .collect::<Vec<_>>();
            keys.sort();
            keys
        };
        // One flat object: the result half is flattened into it, not nested under a key.
        let expected = [
            "data_window",
            "fill_count",
            "fills",
            "max_drawdown",
            "net_return",
            "run",
            "series",
            "state",
            "strategy",
        ];
        assert_eq!(keys(&available), expected);
        assert_eq!(keys(&empty), expected);
        assert_eq!(
            keys(&available["run"]),
            [
                "attempt_identity",
                "engine_result_digest",
                "request_identity",
                "result_identity"
            ]
        );
        assert_eq!(
            keys(&available["strategy"]),
            [
                "channel",
                "comparison",
                "falsifier",
                "family",
                "otherwise",
                "threshold",
                "when_true"
            ]
        );
        assert_eq!(
            keys(&available["strategy"]["channel"]),
            [
                "field_semantic_id",
                "instrument",
                "role_semantic_id",
                "scale",
                "timeframe",
                "unit"
            ]
        );
        assert_eq!(
            keys(&available["strategy"]["when_true"]),
            [
                "position_intent_semantic_id",
                "target_position_units",
                "target_variant_semantic_id"
            ]
        );
        assert_eq!(available["strategy"]["family"], "SINGLE_THRESHOLD_V1");
        assert_eq!(available["strategy"]["comparison"], "GREATER");
        assert_eq!(available["strategy"]["threshold"], "100.00");
        assert_eq!(
            keys(&available["data_window"]),
            [
                "cut_identity",
                "end_exclusive",
                "granularity",
                "instrument",
                "snapshot_count",
                "start"
            ]
        );
        assert_eq!(keys(&available["series"][0]), ["at", "value"]);
        assert_eq!(
            keys(&available["fills"][0]),
            ["at", "price", "quantity", "side"]
        );
        assert_eq!(
            available["state"],
            BacktestRunReportStateV1::Available.code()
        );
        assert_eq!(empty["state"], BacktestRunReportStateV1::Empty.code());
        assert!(available["net_return"].is_f64());
        assert!(empty["net_return"].is_null());
        assert!(empty["max_drawdown"].is_null());
        assert_eq!(empty["series"], serde_json::json!([]));
    }

    #[rstest]
    #[case(10_000, 2, "100.00")]
    #[case(-12_345, 2, "-123.45")]
    #[case(5, 3, "0.005")]
    #[case(-5, 3, "-0.005")]
    #[case(0, 2, "0.00")]
    #[case(-7, 0, "-7")]
    #[case(i128::MIN, 0, "-170141183460469231731687303715884105728")]
    #[case(i128::MAX, 38, "1.70141183460469231731687303715884105727")]
    fn a_threshold_is_written_exactly_at_its_scale(
        #[case] coefficient: i128,
        #[case] scale: u8,
        #[case] expected: &str,
    ) {
        assert_eq!(fixed_point_decimal(coefficient, scale), expected);
    }

    #[rstest]
    #[case(
        BacktestReadbackRefusalV1::OutcomeEvidenceAbsent,
        "OUTCOME_EVIDENCE_ABSENT"
    )]
    #[case(
        BacktestReadbackRefusalV1::SemanticTraceAbsent,
        "SEMANTIC_TRACE_ABSENT"
    )]
    #[case(
        BacktestReadbackRefusalV1::TransactionIsolationRejected,
        "TRANSACTION_ISOLATION_REJECTED"
    )]
    fn an_owner_refusal_keeps_the_owner_s_own_code(
        #[case] refusal: BacktestReadbackRefusalV1,
        #[case] code: &str,
    ) {
        assert_eq!(
            BacktestRunReportRefusalV1::OutcomeEvidenceRefused(refusal).code(),
            code
        );
    }

    /// Source lines with comments removed, so a doc that names a lock does not read as taking one.
    fn code_of(source: &str) -> String {
        source
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// The text from `start` to the end of the item it opens, which ends at the first line that is a
    /// lone closing brace or string terminator.
    fn item<'a>(source: &'a str, start: &str, end: &str) -> &'a str {
        let at = source
            .find(start)
            .unwrap_or_else(|| panic!("{start} is in its file"));
        let rest = &source[at..];
        &rest[..rest.find(end).unwrap_or_else(|| panic!("{start} ends"))]
    }

    /// The report path names no read that takes a row lock.
    ///
    /// `READ ONLY` refuses such a read at run time; this refuses naming one at all, so the next
    /// reader added to the path is checked before a database is in reach. The positive control
    /// runs first: the locking resolver's own source must show its lock to this probe, or a probe
    /// that saw nothing would pass everything.
    #[rstest]
    fn the_report_read_path_names_no_locking_read() {
        let replay = include_str!("exploratory_replay/postgres.rs");
        let locking = item(
            replay,
            "const SELECTOR_RESOLVER_SOURCE_V2: &str = \"",
            "\";\n",
        );
        assert!(locking.contains("FOR SHARE"), "the probe sees a lock");

        let forbidden = [
            "FOR SHARE",
            "FOR UPDATE",
            "LOCK TABLE",
            "pg_advisory",
            "resolve_exploratory_replay_request_v2",
            "resolve_for_rd_v2",
            "lock_accepted_develop_composer",
        ];
        let report = code_of(item(
            include_str!("backtest_run_report_read_v1.rs"),
            "use serde::Serialize;",
            "#[cfg(test)]\npub(crate) mod report_test_support_v1",
        ));
        let request_read = code_of(item(
            replay,
            "pub(crate) async fn read_for_report_in_transaction_v2(",
            "\n}\n",
        ));
        let lock_free_sql = item(replay, "const READ_SELECTOR_SOURCE_V2: &str = \"", "\";\n");
        let frozen_read = code_of(item(
            include_str!("rd_bounded_feature_program_v1.rs"),
            "pub(crate) async fn read_frozen_design_program_in_transaction_v1(",
            "\n}\n",
        ));
        assert!(request_read.contains("rd_owner_api.read_exploratory_replay_request_v2("));
        assert!(report.contains("READ ONLY"));

        for (name, text) in [
            ("report", report.as_str()),
            ("request read", request_read.as_str()),
            ("lock-free SQL", lock_free_sql),
            ("frozen read", frozen_read.as_str()),
        ] {
            for word in forbidden {
                assert!(!text.contains(word), "{name} names {word}");
            }
        }
    }

    /// Every variant, sorted by whether it is a conclusion. The list is the classification written
    /// down a second time on purpose: a variant moved between classes without updating this is a
    /// change of meaning a consumer relies on, and it should fail here first.
    #[rstest]
    #[case(
        BacktestRunReportRefusalV1::OutcomeEvidenceUnavailable(String::new()),
        false
    )]
    #[case(
        BacktestRunReportRefusalV1::ReadTransactionUnavailable(String::new()),
        false
    )]
    #[case(
        BacktestRunReportRefusalV1::ReplayRequestUnavailable(String::new()),
        false
    )]
    #[case(BacktestRunReportRefusalV1::FrozenDesignUnavailable, false)]
    #[case(
        BacktestRunReportRefusalV1::OutcomeEvidenceRefused(
            BacktestReadbackRefusalV1::SemanticTraceAbsent
        ),
        true
    )]
    #[case(
        BacktestRunReportRefusalV1::EngineResultNoncanonical(String::new()),
        true
    )]
    #[case(BacktestRunReportRefusalV1::NonFiniteValue("series"), true)]
    #[case(BacktestRunReportRefusalV1::DuplicateSeriesTime(0), true)]
    #[case(BacktestRunReportRefusalV1::UnknownSide(String::new()), true)]
    #[case(
        BacktestRunReportRefusalV1::DecimalNotPlain { field: "price", value: String::new() },
        true
    )]
    #[case(BacktestRunReportRefusalV1::ReplayRequestV3NotYetReported, true)]
    #[case(BacktestRunReportRefusalV1::NoStrategyStatementForFamily, true)]
    #[case(BacktestRunReportRefusalV1::StrategyNotAnchoredToRun, true)]
    fn every_refusal_is_either_a_conclusion_or_a_failure_to_read(
        #[case] refusal: BacktestRunReportRefusalV1,
        #[case] conclusion: bool,
    ) {
        assert_eq!(
            refusal.is_owner_judgement(),
            conclusion,
            "{}",
            refusal.code()
        );
    }

    #[rstest]
    fn every_refusal_and_state_has_its_own_code() {
        let codes = [
            BacktestRunReportRefusalV1::OutcomeEvidenceRefused(
                BacktestReadbackRefusalV1::OutcomeEvidenceAbsent,
            )
            .code(),
            BacktestRunReportRefusalV1::OutcomeEvidenceUnavailable(String::new()).code(),
            BacktestRunReportRefusalV1::EngineResultNoncanonical(String::new()).code(),
            BacktestRunReportRefusalV1::NonFiniteValue("series").code(),
            BacktestRunReportRefusalV1::DuplicateSeriesTime(0).code(),
            BacktestRunReportRefusalV1::UnknownSide(String::new()).code(),
            BacktestRunReportRefusalV1::DecimalNotPlain {
                field: "price",
                value: String::new(),
            }
            .code(),
            BacktestRunReportRefusalV1::ReadTransactionUnavailable(String::new()).code(),
            BacktestRunReportRefusalV1::ReplayRequestUnavailable(String::new()).code(),
            BacktestRunReportRefusalV1::ReplayRequestV3NotYetReported.code(),
            BacktestRunReportRefusalV1::FrozenDesignUnavailable.code(),
            BacktestRunReportRefusalV1::NoStrategyStatementForFamily.code(),
            BacktestRunReportRefusalV1::StrategyNotAnchoredToRun.code(),
            BacktestRunReportStateV1::Available.code(),
            BacktestRunReportStateV1::Empty.code(),
        ];
        let distinct = codes.iter().collect::<std::collections::BTreeSet<_>>();

        assert_eq!(distinct.len(), codes.len());
    }
}
