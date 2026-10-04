//! A `backtest.run` report: the run's four-question report, with how it was priced, what it cost,
//! the standing of its result and its matched-entry control, assembled from values.
//!
//! The four-question projection (`backtest_run_report_read_v1`) is carried unchanged, so the
//! Dashboard's report keeps answering exactly its four questions; everything a run report adds
//! sits beside it. The function reads no Owner and no clock: the run route reads the committed
//! result, the run's fills and its pinned bars, and hands them here.

use std::collections::BTreeMap;

use serde::Serialize;
use thiserror::Error;
use vibe_backtest_statistics::{
    BarOpenV1, FillSideV1, FillV1, MatchedEntryControlErrorV1, MatchedEntryControlInputV1,
    MatchedEntryControlV1, RoundTripsFromFillsErrorV1, matched_entry_control_v1,
    round_trips_from_fills, seed_from_request_identity,
};

use crate::{
    backtest_run_report_read_v1::BacktestRunReportProjectionV1,
    owner_backtest_report_v1::OwnerBacktestFillV1,
};

/// No holdout partition is registered, so a run's result is exploratory only.
pub const NO_HOLDOUT_PARTITION_DEFINED_V1: &str = "NO_HOLDOUT_PARTITION_DEFINED";
/// The standing of every run report until Qualification registers its holdout partition.
pub const EXPLORATORY_ONLY_V1: &str = "EXPLORATORY_ONLY";

/// How a run was priced.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct BacktestRunPricingV1 {
    /// Each order is decided at its frame's BAR close and filled at that frame's quote cut: a
    /// limit the quote crosses fills as taker at the touch, an uncrossed one rests and fills as
    /// maker at its limit.
    pub fills: &'static str,
    /// Commission at the maker or taker rate of the instrument's sealed economic terms.
    pub fees: &'static str,
    /// `STATED` when the run's funding was priced, `NOT_STATED` when no funding was read.
    pub funding: &'static str,
    /// The control's entries and exits are priced at bar opens (`vibe-backtest-statistics`).
    pub control: &'static str,
}

/// The fees a run paid in one currency.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct BacktestRunFeesV1 {
    pub currency: String,
    /// The exact sum of the run's commissions in that currency, as a decimal.
    pub total: String,
}

/// A run report.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct BacktestRunReportDocumentV1 {
    pub schema_version: u16,
    /// [`EXPLORATORY_ONLY_V1`].
    pub standing: &'static str,
    /// [`NO_HOLDOUT_PARTITION_DEFINED_V1`].
    pub holdout: &'static str,
    /// The four-question report, unchanged.
    pub report: BacktestRunReportProjectionV1,
    pub pricing: BacktestRunPricingV1,
    /// One total per commission currency, ascending by currency; empty when nothing was charged.
    pub fees: Vec<BacktestRunFeesV1>,
    pub control: MatchedEntryControlV1,
}

/// The values one report is assembled from.
#[derive(Clone, Copy, Debug)]
pub struct BacktestRunReportInputsV1<'a> {
    pub report: &'a BacktestRunReportProjectionV1,
    /// The run's fills, in the order it made them.
    pub fills: &'a [OwnerBacktestFillV1],
    /// The bars the run read, by open: the bars its pinned custody head reads back.
    pub bars: &'a [BarOpenV1],
    /// Funding per bar, or `None` when the run's funding is not stated.
    pub funding_per_bar: Option<&'a [f64]>,
    /// The instrument's taker fee rate, which the control charges each side.
    pub cost_per_side: f64,
    /// The run's request identity, from which the control's seed derives.
    pub request_identity: &'a [u8; 32],
}

/// Why a report was not assembled.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum BacktestRunReportDocumentErrorV1 {
    #[error("REPORT_FILL_UNREADABLE: fill {0} is not a side, quantity and price this report reads")]
    FillUnreadable(usize),
    #[error("REPORT_COMMISSION_UNREADABLE: fill {0}'s commission is not an amount and a currency")]
    CommissionUnreadable(usize),
    #[error("REPORT_FILLS_NOT_ROUND_TRIPS: {0}")]
    FillsNotRoundTrips(RoundTripsFromFillsErrorV1),
    #[error("REPORT_CONTROL_UNMEASURABLE: {0}")]
    ControlUnmeasurable(MatchedEntryControlErrorV1),
}

/// Assembles a run report from its values.
///
/// # Errors
///
/// Returns the first value the report cannot read, by name.
pub fn assemble_backtest_run_report_v1(
    inputs: &BacktestRunReportInputsV1<'_>,
) -> Result<BacktestRunReportDocumentV1, BacktestRunReportDocumentErrorV1> {
    let fills = inputs
        .fills
        .iter()
        .enumerate()
        .map(|(index, fill)| statistics_fill(index, fill))
        .collect::<Result<Vec<_>, _>>()?;
    let trips = round_trips_from_fills(&fills, inputs.bars)
        .map_err(BacktestRunReportDocumentErrorV1::FillsNotRoundTrips)?;
    let control = matched_entry_control_v1(&MatchedEntryControlInputV1 {
        bars: inputs.bars,
        funding_per_bar: inputs.funding_per_bar,
        cost_per_side: inputs.cost_per_side,
        trades: &trips.trades,
        seed: seed_from_request_identity(inputs.request_identity),
    })
    .map_err(BacktestRunReportDocumentErrorV1::ControlUnmeasurable)?;
    Ok(BacktestRunReportDocumentV1 {
        schema_version: 1,
        standing: EXPLORATORY_ONLY_V1,
        holdout: NO_HOLDOUT_PARTITION_DEFINED_V1,
        report: inputs.report.clone(),
        pricing: BacktestRunPricingV1 {
            fills: "FRAME_CLOSE_DECISION_FILLED_AT_FRAME_QUOTE_CUT",
            fees: "SEALED_INSTRUMENT_TERMS",
            funding: if inputs.funding_per_bar.is_some() {
                "STATED"
            } else {
                "NOT_STATED"
            },
            control: "BAR_OPEN",
        },
        fees: fee_totals(inputs.fills)?,
        control,
    })
}

fn statistics_fill(
    index: usize,
    fill: &OwnerBacktestFillV1,
) -> Result<FillV1, BacktestRunReportDocumentErrorV1> {
    let unreadable = || BacktestRunReportDocumentErrorV1::FillUnreadable(index);
    let side = match fill.order_side.as_str() {
        "BUY" => FillSideV1::Buy,
        "SELL" => FillSideV1::Sell,
        _ => return Err(unreadable()),
    };
    Ok(FillV1 {
        at_ns: i64::try_from(fill.ts_event_ns).map_err(|_| unreadable())?,
        side,
        quantity: fill.last_qty.parse().map_err(|_| unreadable())?,
        price: fill.last_px.parse().map_err(|_| unreadable())?,
    })
}

/// Sums the commissions exactly, per currency: each amount is read as a decimal and added at the
/// finest scale any of them states.
fn fee_totals(
    fills: &[OwnerBacktestFillV1],
) -> Result<Vec<BacktestRunFeesV1>, BacktestRunReportDocumentErrorV1> {
    let mut totals: BTreeMap<String, Vec<(i128, u32)>> = BTreeMap::new();

    for (index, fill) in fills.iter().enumerate() {
        let Some(commission) = &fill.commission else {
            continue;
        };
        let unreadable = || BacktestRunReportDocumentErrorV1::CommissionUnreadable(index);
        let (amount, currency) = commission.split_once(' ').ok_or_else(unreadable)?;

        if currency.is_empty() || currency.contains(' ') {
            return Err(unreadable());
        }
        totals
            .entry(currency.to_owned())
            .or_default()
            .push(decimal(amount).ok_or_else(unreadable)?);
    }
    totals
        .into_iter()
        .map(|(currency, amounts)| {
            let scale = amounts.iter().map(|(_, scale)| *scale).max().unwrap_or(0);
            let sum = amounts.iter().try_fold(0_i128, |sum, (coefficient, own)| {
                10_i128
                    .checked_pow(scale - own)
                    .and_then(|factor| coefficient.checked_mul(factor))
                    .and_then(|scaled| sum.checked_add(scaled))
            });
            let sum = sum.ok_or(BacktestRunReportDocumentErrorV1::CommissionUnreadable(0))?;
            Ok(BacktestRunFeesV1 {
                currency,
                total: decimal_text(sum, scale),
            })
        })
        .collect()
}

/// A decimal's coefficient and scale: `"0.125"` is `(125, 3)`.
fn decimal(text: &str) -> Option<(i128, u32)> {
    let (negative, digits) = text
        .strip_prefix('-')
        .map_or((false, text), |rest| (true, rest));
    let (whole, fraction) = digits.split_once('.').unwrap_or((digits, ""));

    if whole.is_empty()
        || !whole
            .bytes()
            .chain(fraction.bytes())
            .all(|byte| byte.is_ascii_digit())
        || fraction.len() > 18
    {
        return None;
    }
    let coefficient: i128 = format!("{whole}{fraction}").parse().ok()?;
    let scale = u32::try_from(fraction.len()).ok()?;
    Some((if negative { -coefficient } else { coefficient }, scale))
}

fn decimal_text(coefficient: i128, scale: u32) -> String {
    let sign = if coefficient < 0 { "-" } else { "" };
    let digits = coefficient.unsigned_abs().to_string();

    if scale == 0 {
        return format!("{sign}{digits}");
    }
    let scale = scale as usize;
    let padded = format!("{digits:0>width$}", width = scale + 1);
    let (whole, fraction) = padded.split_at(padded.len() - scale);
    format!("{sign}{whole}.{fraction}")
}

#[cfg(test)]
#[path = "backtest_run_report_document_v1_tests.rs"]
mod tests;
