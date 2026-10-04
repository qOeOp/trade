//! The inputs of the T0 replication comparison, read from their files: research's trade table and
//! a run's bars and fills.

use std::collections::BTreeMap;

use serde::Deserialize;
use thiserror::Error;

use crate::{
    BarOpenV1, FillSideV1, FillV1, ReplicationTradeV1, ReplicationWindowV1,
    RoundTripsFromFillsErrorV1, TradeSideV1, round_trips_from_fills, window_after_warmup,
};

const NANOS_PER_DAY: i64 = 86_400_000_000_000;

/// One instrument of a run: its daily bars and its fills, as the report states them.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunInstrumentV1 {
    pub bars: Vec<RunBarV1>,
    pub fills: Vec<RunFillV1>,
}

/// One daily bar's open time and open price.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunBarV1 {
    pub open_ns: i64,
    pub open: f64,
}

/// One fill.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunFillV1 {
    pub at_ns: i64,
    pub side: FillSideV1,
    pub quantity: f64,
    pub price: f64,
}

/// Why an input was not read.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ReplicationInputErrorV1 {
    #[error("REPLICATION_REFERENCE_HEADER: the reference table's header lacks {0}")]
    ReferenceHeader(&'static str),
    #[error("REPLICATION_REFERENCE_ROW: reference row {0} is not a trade")]
    ReferenceRow(usize),
    #[error("REPLICATION_RUN_FILLS: {instrument}: {source}")]
    RunFills {
        instrument: String,
        source: RoundTripsFromFillsErrorV1,
    },
}

/// Research T0's trades from its table (`research/ronnie/trend/trades.csv`): columns `coin`,
/// `time` (the entry's fill day), `side` (`1` long, `-1` short) and `days` (held, the entry day
/// counted), so the exit is decided on the entry day plus `days - 1`. Only the coins `instruments`
/// names are read, each under its instrument's name.
///
/// # Errors
///
/// Returns a header without one of those columns, or a row that does not read as a trade.
pub fn reference_trades_from_research_csv(
    table: &str,
    instruments: &BTreeMap<String, String>,
) -> Result<Vec<ReplicationTradeV1>, ReplicationInputErrorV1> {
    let mut lines = table.lines();
    let header: Vec<&str> = lines.next().unwrap_or("").split(',').collect();
    let column = |name: &'static str| {
        header
            .iter()
            .position(|cell| *cell == name)
            .ok_or(ReplicationInputErrorV1::ReferenceHeader(name))
    };
    let (coin, time, side, days) = (
        column("coin")?,
        column("time")?,
        column("side")?,
        column("days")?,
    );
    let mut trades = Vec::new();

    for (index, line) in lines.enumerate().filter(|(_, line)| !line.is_empty()) {
        let cells: Vec<&str> = line.split(',').collect();
        let row = ReplicationInputErrorV1::ReferenceRow(index + 1);
        let Some(instrument) = cells.get(coin).and_then(|coin| instruments.get(*coin)) else {
            continue;
        };
        let entry_day = cells
            .get(time)
            .and_then(|time| day_of_date(time))
            .ok_or(row.clone())?;
        let side = match cells.get(side).copied() {
            Some("1") => TradeSideV1::Long,
            Some("-1") => TradeSideV1::Short,
            _ => return Err(row),
        };
        let held: i64 = cells
            .get(days)
            .and_then(|days| days.parse().ok())
            .filter(|held| *held >= 1)
            .ok_or(row)?;
        trades.push(ReplicationTradeV1 {
            instrument: instrument.clone(),
            side,
            entry_day,
            exit_signal_day: entry_day + held - 1,
            entry_price: None,
        });
    }
    Ok(trades)
}

/// A run's trades and comparison windows from its instruments' daily bars and fills: fills pair
/// into round trips, each exit is decided on the bar before the one it fills at, and each window
/// starts after `warmup_bars` bars.
///
/// # Errors
///
/// Returns an instrument whose fills do not pair into round trips.
pub fn run_trades_from_fills(
    run: &BTreeMap<String, RunInstrumentV1>,
    warmup_bars: usize,
) -> Result<(Vec<ReplicationTradeV1>, Vec<ReplicationWindowV1>), ReplicationInputErrorV1> {
    let mut trades = Vec::new();
    let mut windows = Vec::new();

    for (instrument, data) in run {
        let bars: Vec<BarOpenV1> = data
            .bars
            .iter()
            .map(|bar| BarOpenV1 {
                open_ns: bar.open_ns,
                open: bar.open,
            })
            .collect();
        let fills: Vec<FillV1> = data
            .fills
            .iter()
            .map(|fill| FillV1 {
                at_ns: fill.at_ns,
                side: fill.side,
                quantity: fill.quantity,
                price: fill.price,
            })
            .collect();
        let paired = round_trips_from_fills(&fills, &bars).map_err(|source| {
            ReplicationInputErrorV1::RunFills {
                instrument: instrument.clone(),
                source,
            }
        })?;
        let day = |bar: usize| bars[bar].open_ns.div_euclid(NANOS_PER_DAY);
        trades.extend(paired.trades.iter().map(|trip| ReplicationTradeV1 {
            instrument: instrument.clone(),
            side: trip.side,
            entry_day: day(trip.entry_bar),
            exit_signal_day: day(trip.exit_bar - 1),
            entry_price: Some(trip.entry_price),
        }));
        let bar_days: Vec<i64> = (0..bars.len()).map(day).collect();
        windows.push(window_after_warmup(instrument, &bar_days, warmup_bars));
    }
    Ok((trades, windows))
}

/// Days since 1970-01-01 of a value that starts `YYYY-MM-DD` (Hinnant's days-from-civil).
fn day_of_date(value: &str) -> Option<i64> {
    let date = value.get(..10)?;
    let mut parts = date.split('-');
    let year: i64 = parts.next()?.parse().ok()?;
    let month: i64 = parts.next()?.parse().ok()?;
    let day: i64 = parts.next()?.parse().ok()?;

    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    Some(era * 146_097 + day_of_era - 719_468)
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    #[case("1970-01-01", 0)]
    #[case("2018-01-23 00:00:00+00:00", 17_554)]
    #[case("2024-02-29", 19_782)]
    #[case("2024-01-01T00:00:00Z", 19_723)]
    fn a_date_is_its_day_since_the_epoch(#[case] value: &str, #[case] day: i64) {
        assert_eq!(day_of_date(value), Some(day));
    }

    /// Research's own first rows, read under the instruments named for their coins; a coin not
    /// named is skipped.
    #[rstest]
    fn research_rows_read_as_trades() {
        let table = "coin,time,side,R,control,E,S,X,weekly_ok,days,x_has_tp,set\n\
                     BTC,2018-01-23 00:00:00+00:00,-1,-0.127487,0.564699,-0.0918737,-0.0719228,-0.127487,False,28,True,dev\n\
                     BTC,2018-05-04 00:00:00+00:00,1,-1.03129,-0.336205,-1.03087,-1.0278,-1.03129,False,8,False,dev\n\
                     TRX,2018-05-04 00:00:00+00:00,1,0,0,0,0,0,False,3,False,dev\n";
        let instruments = BTreeMap::from([("BTC".to_owned(), "BTCUSDT-PERP.BINANCE".to_owned())]);
        let trades = reference_trades_from_research_csv(table, &instruments).expect("reads");

        assert_eq!(trades.len(), 2);
        assert_eq!(
            (
                trades[0].side,
                trades[0].entry_day,
                trades[0].exit_signal_day
            ),
            (TradeSideV1::Short, 17_554, 17_554 + 27)
        );
        assert_eq!(trades[1].instrument, "BTCUSDT-PERP.BINANCE");
    }

    #[rstest]
    fn a_header_without_days_is_refused() {
        let instruments = BTreeMap::new();
        assert_eq!(
            reference_trades_from_research_csv("coin,time,side\n", &instruments),
            Err(ReplicationInputErrorV1::ReferenceHeader("days"))
        );
    }

    /// A run's fills become trades whose exit is decided the bar before it fills, inside a window
    /// that skips the warmup.
    #[rstest]
    fn run_fills_read_as_trades_and_windows() {
        let bars: Vec<RunBarV1> = (0..10)
            .map(|day| RunBarV1 {
                open_ns: (19_723 + day) * NANOS_PER_DAY,
                open: 100.0,
            })
            .collect();
        let fills = vec![
            RunFillV1 {
                at_ns: (19_723 + 2) * NANOS_PER_DAY,
                side: FillSideV1::Buy,
                quantity: 1.0,
                price: 100.0,
            },
            RunFillV1 {
                at_ns: (19_723 + 6) * NANOS_PER_DAY,
                side: FillSideV1::Sell,
                quantity: 1.0,
                price: 103.0,
            },
        ];
        let run = BTreeMap::from([("BTC".to_owned(), RunInstrumentV1 { bars, fills })]);
        let (trades, windows) = run_trades_from_fills(&run, 1).expect("pairs");

        assert_eq!(
            (
                trades[0].entry_day,
                trades[0].exit_signal_day,
                trades[0].entry_price
            ),
            (19_725, 19_728, Some(100.0))
        );
        assert_eq!(
            (windows[0].first_day, windows[0].last_day),
            (19_724, 19_732)
        );
    }
}
