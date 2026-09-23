//! The Backtest Owner's read of one committed run's economics, for `BacktestRunReport`.
//!
//! A committed exploratory run already persists the engine's canonical result beside its outcome
//! evidence, and that evidence already binds the exact bytes by digest and length. This module
//! reads those bytes back through the Owner's own outcome readback, projects them into the named
//! result fields the Dashboard report contract asks for, and carries the run identity and the
//! bytes' digest with them, so a consumer can tell which committed result a number came from.
//!
//! It adds no second computation. `OwnerBacktestReportV1` already reads a canonical result into a
//! return series, net return, maximum drawdown and executions; this is the read surface that had
//! been missing between that computation and the report that renders it.
//!
//! ## What the projection carries, and what it does not
//!
//! It carries only what a canonical backtest result contains: the observed series, net return,
//! maximum drawdown, and every execution. The report contract states that the strategy statement,
//! the instrument, the granularity, the snapshot count and the cut identity come from upstream
//! rather than from the backtest result, so none of them appears here, and a reader looking for a
//! threshold in this projection will not find one.
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
use vibe_backtest_result_custody::{
    BacktestReadbackRefusalV1, BacktestResultCustodyErrorV2, ExploratoryReplayResultLocatorV2,
    LockedExploratoryReplayResultV3,
};
use vibe_core::{UnixNanos, datetime::unix_nanos_to_iso8601};

use crate::{
    owner_backtest_report_v1::{OwnerBacktestFillV1, OwnerBacktestReportV1},
    rd_owner_postgres_custody::resolve_exploratory_replay_outcome_for_rd_in_transaction,
};

/// Why a committed run's report could not be read.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum BacktestRunReportRefusalV1 {
    /// The Backtest Owner answered and named why it could not answer with this run. Its code is the
    /// Owner's own, such as `OUTCOME_EVIDENCE_ABSENT` for a result committed without outcome
    /// evidence, so the cause reaches the consumer rather than a generic refusal.
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
}

impl BacktestRunReportRefusalV1 {
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

/// The named result fields of one committed run, for `BacktestRunReport`.
///
/// This type's serialization is the wire shape: field names as written here, absent quantities as
/// `null` rather than omitted, and every number finite, so a consumer never has to define it.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct BacktestRunReportProjectionV1 {
    pub run: BacktestRunIdentityV1,
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

/// Projects one committed run's outcome readback into its report fields.
///
/// # Errors
///
/// Returns the refusal naming the first thing the committed bytes do not supply in the shape the
/// report contract requires. No partial projection is produced.
pub fn project_backtest_run_report_v1(
    locked: &LockedExploratoryReplayResultV3,
) -> Result<BacktestRunReportProjectionV1, BacktestRunReportRefusalV1> {
    let evidence = locked.outcome_evidence();
    project_engine_result_v1(
        BacktestRunIdentityV1 {
            result_identity: evidence.result_identity.as_str().to_owned(),
            request_identity: evidence.request_identity.as_str().to_owned(),
            attempt_identity: evidence.attempt_identity.as_str().to_owned(),
            engine_result_digest: evidence
                .canonical_result
                .canonical_bytes_digest
                .as_str()
                .to_owned(),
        },
        locked.engine_canonical_result_bytes(),
    )
}

/// Reads one committed run's report under the caller's R&D transaction.
///
/// # Errors
///
/// Returns the refusal naming why the read could not be answered. `Ok(None)` is an address with no
/// committed run behind it, which is an empty result rather than a refusal.
pub async fn resolve_backtest_run_report_v1(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    locator: ExploratoryReplayResultLocatorV2<'_>,
) -> Result<Option<BacktestRunReportProjectionV1>, BacktestRunReportRefusalV1> {
    let locked = resolve_exploratory_replay_outcome_for_rd_in_transaction(transaction, locator)
        .await
        .map_err(|e| match e {
            BacktestResultCustodyErrorV2::Refused(refusal) => {
                BacktestRunReportRefusalV1::OutcomeEvidenceRefused(refusal)
            }
            other => BacktestRunReportRefusalV1::OutcomeEvidenceUnavailable(other.to_string()),
        })?;
    locked
        .as_ref()
        .map(project_backtest_run_report_v1)
        .transpose()
}

fn project_engine_result_v1(
    run: BacktestRunIdentityV1,
    engine_result_bytes: &[u8],
) -> Result<BacktestRunReportProjectionV1, BacktestRunReportRefusalV1> {
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

    Ok(BacktestRunReportProjectionV1 {
        run,
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
            independently_counted_points, instant_of, run_multi_day_round_trip_v1,
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
        let expected = independently_counted_points(&bytes);
        assert!(
            expected.len() >= 2,
            "the run must record at least two points for a dropped one to be visible, recorded {}",
            expected.len()
        );

        let projection = project_engine_result_v1(run(), &bytes).expect("report projection");

        assert_eq!(projection.run, run());
        assert_eq!(projection.state, BacktestRunReportStateV1::Available);
        let read_back = projection
            .series
            .iter()
            .map(|point| (instant_of(&point.at), point.value))
            .collect::<Vec<_>>();
        assert_eq!(read_back, expected);
        assert!(projection.net_return.is_some_and(f64::is_finite));
        assert!(projection.max_drawdown.is_some_and(|value| value <= 0.0));
        assert!(!projection.fills.is_empty(), "the run must have traded");
        assert_eq!(projection.fill_count, projection.fills.len() as u64);
    }

    #[rstest]
    fn a_run_that_recorded_no_point_is_empty_and_keeps_its_executions() {
        let mut document: serde_json::Value =
            serde_json::from_slice(&engine_bytes()).expect("engine JSON");
        document["statistics"]["returns_series"] = serde_json::json!([]);
        let bytes = serde_json::to_vec(&document).expect("edited engine bytes");

        let projection = project_engine_result_v1(run(), &bytes).expect("report projection");

        assert_eq!(projection.state, BacktestRunReportStateV1::Empty);
        assert!(projection.series.is_empty());
        assert_eq!(projection.net_return, None);
        assert_eq!(projection.max_drawdown, None);
        assert!(!projection.fills.is_empty());
    }

    #[rstest]
    fn bytes_that_are_not_the_canonical_encoding_are_refused() {
        let mut bytes = engine_bytes();
        bytes.push(b' ');

        assert_eq!(
            project_engine_result_v1(run(), &bytes)
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

    #[rstest]
    fn the_wire_shape_is_the_owner_s_and_keeps_absent_quantities_as_null() {
        let mut document: serde_json::Value =
            serde_json::from_slice(&engine_bytes()).expect("engine JSON");
        let available = serde_json::to_value(
            project_engine_result_v1(run(), &serde_json::to_vec(&document).expect("bytes"))
                .expect("available projection"),
        )
        .expect("available wire value");
        document["statistics"]["returns_series"] = serde_json::json!([]);
        let empty = serde_json::to_value(
            project_engine_result_v1(run(), &serde_json::to_vec(&document).expect("bytes"))
                .expect("empty projection"),
        )
        .expect("empty wire value");

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
        let expected = [
            "fill_count",
            "fills",
            "max_drawdown",
            "net_return",
            "run",
            "series",
            "state",
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
            BacktestRunReportStateV1::Available.code(),
            BacktestRunReportStateV1::Empty.code(),
        ];
        let distinct = codes.iter().collect::<std::collections::BTreeSet<_>>();

        assert_eq!(distinct.len(), codes.len());
    }
}
