//! Trade-by-trade comparison of a run against a reference trade list, such as research's T0.
//!
//! A trade is keyed by its instrument, side and entry day - the day its entry filled. Two trades
//! with one key match when they leave on the same exit signal day - the day whose close decided
//! the exit - and, when both state an entry price, their prices agree within a relative band.
//! Only trades inside the instrument's comparison window count, so neither side's warmup nor a
//! position still open at the end of the data is read as a difference.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::TradeSideV1;

/// The match rate research T0's replication must reach.
pub const T0_REPLICATION_THRESHOLD_V1: f64 = 0.995;
/// Bars a comparison window skips at the start of a run's data, for every indicator to warm.
pub const T0_REPLICATION_WARMUP_BARS_V1: usize = 200;

/// One trade of either list, by day: days since 1970-01-01, UTC.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ReplicationTradeV1 {
    pub instrument: String,
    pub side: TradeSideV1,
    /// The day the entry filled.
    pub entry_day: i64,
    /// The day whose close decided the exit.
    pub exit_signal_day: i64,
    /// The entry's fill price, when the list states it.
    pub entry_price: Option<f64>,
}

/// The days of one instrument's data that are compared: a trade counts when it enters on or after
/// `first_day` and its exit is decided before `last_day`, the last day with a bar to fill it on.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ReplicationWindowV1 {
    pub instrument: String,
    pub first_day: i64,
    pub last_day: i64,
}

/// Why a key did not match.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplicationMismatchKindV1 {
    /// The reference has the trade and the run does not.
    MissingFromRun,
    /// The run has the trade and the reference does not.
    ExtraInRun,
    /// Both have it; they leave on different exit signal days.
    ExitSignalDayDiffers,
    /// Both have it and leave together; their entry prices disagree beyond the band.
    EntryPriceOutsideBand,
}

/// One key that did not match, with both sides' values where they exist.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ReplicationMismatchV1 {
    pub kind: ReplicationMismatchKindV1,
    pub instrument: String,
    pub side: TradeSideV1,
    pub entry_day: i64,
    pub reference_exit_signal_day: Option<i64>,
    pub run_exit_signal_day: Option<i64>,
    pub reference_entry_price: Option<f64>,
    pub run_entry_price: Option<f64>,
}

/// The comparison's outcome.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ReplicationReportV1 {
    /// Keys compared: every key either list has inside its window.
    pub compared: usize,
    pub matched: usize,
    /// `matched / compared`, or `None` with nothing to compare.
    pub match_rate: Option<f64>,
    pub threshold: f64,
    /// Whether `match_rate` reaches `threshold`; never with nothing compared.
    pub accepted: bool,
    /// The relative band entry prices are held to.
    pub price_band: f64,
    pub mismatches: Vec<ReplicationMismatchV1>,
}

/// A window that starts after the first `warmup_bars` of an instrument's daily bars.
///
/// `bar_days` are the days of the run's bars for that instrument, ascending; with no more bars
/// than the warmup, the window is empty.
#[must_use]
pub fn window_after_warmup(
    instrument: &str,
    bar_days: &[i64],
    warmup_bars: usize,
) -> ReplicationWindowV1 {
    let last_day = bar_days.last().copied().unwrap_or(i64::MIN);
    ReplicationWindowV1 {
        instrument: instrument.to_owned(),
        first_day: bar_days.get(warmup_bars).copied().unwrap_or(i64::MAX),
        last_day,
    }
}

/// Compares a run's trades with the reference's, trade by trade, inside each instrument's window.
#[must_use]
pub fn compare_replication_v1(
    reference: &[ReplicationTradeV1],
    run: &[ReplicationTradeV1],
    windows: &[ReplicationWindowV1],
    price_band: f64,
) -> ReplicationReportV1 {
    let windows: BTreeMap<&str, &ReplicationWindowV1> = windows
        .iter()
        .map(|window| (window.instrument.as_str(), window))
        .collect();
    let inside = |trade: &&ReplicationTradeV1| {
        windows
            .get(trade.instrument.as_str())
            .is_some_and(|window| {
                window.first_day <= trade.entry_day && trade.exit_signal_day < window.last_day
            })
    };
    let keyed =
        |trades: &'_ [ReplicationTradeV1]| -> BTreeMap<(String, u8, i64), ReplicationTradeV1> {
            trades
                .iter()
                .filter(inside)
                .map(|trade| {
                    let side = u8::from(trade.side == TradeSideV1::Short);
                    (
                        (trade.instrument.clone(), side, trade.entry_day),
                        trade.clone(),
                    )
                })
                .collect()
        };
    let reference = keyed(reference);
    let run = keyed(run);
    let mut keys: Vec<_> = reference.keys().chain(run.keys()).cloned().collect();
    keys.sort();
    keys.dedup();
    let mut mismatches = Vec::new();

    for key in &keys {
        let (expected, actual) = (reference.get(key), run.get(key));
        let kind = match (expected, actual) {
            (Some(_), None) => Some(ReplicationMismatchKindV1::MissingFromRun),
            (None, Some(_)) => Some(ReplicationMismatchKindV1::ExtraInRun),
            (Some(expected), Some(actual))
                if expected.exit_signal_day != actual.exit_signal_day =>
            {
                Some(ReplicationMismatchKindV1::ExitSignalDayDiffers)
            }
            (Some(expected), Some(actual)) => match (expected.entry_price, actual.entry_price) {
                (Some(want), Some(got)) if (got / want - 1.0).abs() > price_band => {
                    Some(ReplicationMismatchKindV1::EntryPriceOutsideBand)
                }
                _ => None,
            },
            (None, None) => None,
        };

        if let Some(kind) = kind {
            let trade = expected
                .or(actual)
                .expect("a key comes from one of the lists");
            mismatches.push(ReplicationMismatchV1 {
                kind,
                instrument: trade.instrument.clone(),
                side: trade.side,
                entry_day: trade.entry_day,
                reference_exit_signal_day: expected.map(|trade| trade.exit_signal_day),
                run_exit_signal_day: actual.map(|trade| trade.exit_signal_day),
                reference_entry_price: expected.and_then(|trade| trade.entry_price),
                run_entry_price: actual.and_then(|trade| trade.entry_price),
            });
        }
    }
    let compared = keys.len();
    let matched = compared - mismatches.len();
    let match_rate = (compared > 0).then(|| matched as f64 / compared as f64);
    ReplicationReportV1 {
        compared,
        matched,
        match_rate,
        threshold: T0_REPLICATION_THRESHOLD_V1,
        accepted: match_rate.is_some_and(|rate| rate >= T0_REPLICATION_THRESHOLD_V1),
        price_band,
        mismatches,
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn trade(
        side: TradeSideV1,
        entry_day: i64,
        exit_signal_day: i64,
        price: Option<f64>,
    ) -> ReplicationTradeV1 {
        ReplicationTradeV1 {
            instrument: "BTC".to_owned(),
            side,
            entry_day,
            exit_signal_day,
            entry_price: price,
        }
    }

    fn window(first_day: i64, last_day: i64) -> ReplicationWindowV1 {
        ReplicationWindowV1 {
            instrument: "BTC".to_owned(),
            first_day,
            last_day,
        }
    }

    /// Each kind of difference is found once, every other trade matches, and the rate counts both
    /// lists' keys.
    #[rstest]
    fn each_difference_is_named_and_the_rate_counts_both_lists() {
        let long = TradeSideV1::Long;
        let short = TradeSideV1::Short;
        let reference = [
            trade(long, 300, 310, None),
            trade(short, 320, 330, Some(100.0)),
            trade(long, 340, 350, Some(100.0)),
            trade(long, 360, 370, Some(100.0)),
            trade(short, 380, 390, None),
        ];
        let run = [
            trade(long, 300, 310, Some(101.0)),
            trade(short, 320, 331, Some(100.0)),
            trade(long, 340, 350, Some(100.4)),
            trade(long, 360, 370, Some(101.0)),
            trade(long, 395, 399, None),
        ];
        let report = compare_replication_v1(&reference, &run, &[window(200, 500)], 0.005);

        assert_eq!((report.compared, report.matched), (6, 2));
        assert_eq!(
            report
                .mismatches
                .iter()
                .map(|mismatch| mismatch.kind)
                .collect::<Vec<_>>(),
            // In key order: instrument, then longs before shorts, then entry day.
            [
                ReplicationMismatchKindV1::EntryPriceOutsideBand,
                ReplicationMismatchKindV1::ExtraInRun,
                ReplicationMismatchKindV1::ExitSignalDayDiffers,
                ReplicationMismatchKindV1::MissingFromRun,
            ]
        );
        assert!(!report.accepted);
        assert!((report.match_rate.unwrap() - 2.0 / 6.0).abs() < 1e-12);
    }

    /// Trades entering in the warmup, or whose exit is decided on the last day, are not compared.
    #[rstest]
    fn trades_outside_the_window_are_not_compared() {
        let reference = [
            trade(TradeSideV1::Long, 150, 160, None),
            trade(TradeSideV1::Long, 250, 260, None),
            trade(TradeSideV1::Long, 480, 500, None),
        ];
        let run = [trade(TradeSideV1::Long, 250, 260, None)];
        let report = compare_replication_v1(&reference, &run, &[window(200, 500)], 0.005);

        assert_eq!((report.compared, report.matched), (1, 1));
        assert!(report.accepted);
    }

    /// An instrument with no window is not compared, and nothing compared is never accepted.
    #[rstest]
    fn nothing_compared_is_not_acceptance() {
        let report =
            compare_replication_v1(&[trade(TradeSideV1::Long, 250, 260, None)], &[], &[], 0.005);

        assert_eq!(
            (report.compared, report.match_rate, report.accepted),
            (0, None, false)
        );
    }

    #[rstest]
    fn the_window_starts_after_the_warmup_bars() {
        let days: Vec<i64> = (1_000..1_300).collect();
        assert_eq!(window_after_warmup("BTC", &days, 200), window(1_200, 1_299));
        assert_eq!(
            window_after_warmup("BTC", &days[..150], 200).first_day,
            i64::MAX
        );
    }
}
