//! Compares a run's trades with research T0's, trade by trade, checks the run's entry prices
//! against its bars, and prints both as JSON.
//!
//! ```text
//! t0-replication --reference trades.csv --run run.json --instrument BTC=BTCUSDT-PERP.BINANCE \
//!     [--instrument ...] [--tick BTCUSDT-PERP.BINANCE=0.1 ...] [--warmup-bars 200]
//! ```
//!
//! `--reference` is research's `trend/trades.csv` (uncompressed). `--run` is a JSON object from
//! instrument to `{"bars": [{"open_ns", "open"}], "fills": [{"at_ns", "side", "quantity",
//! "price"}]}`, the run's daily bars and fills. `--tick` is an instrument's price tick, the
//! tolerance its entries are held to against their bars' opens (exact when not given). Exits 0
//! when the match rate reaches the threshold and every entry filled at its bar's open, 1 when not,
//! and 2 when an input cannot be read.

use std::{collections::BTreeMap, process::ExitCode};

use serde::Serialize;
use vibe_backtest_statistics::{
    EntryPriceCheckV1, ReplicationReportV1, RunInstrumentV1, T0_REPLICATION_WARMUP_BARS_V1,
    compare_replication_v1, reference_trades_from_research_csv, run_trades_from_fills,
};

#[derive(Serialize)]
struct Output {
    replication: ReplicationReportV1,
    entry_price_check: EntryPriceCheckV1,
}

fn main() -> ExitCode {
    match run() {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::from(1),
        Err(message) => {
            eprintln!("{message}");
            ExitCode::from(2)
        }
    }
}

fn pair(flag: &str, value: &str) -> Result<(String, String), String> {
    value
        .split_once('=')
        .map(|(left, right)| (left.to_owned(), right.to_owned()))
        .ok_or_else(|| format!("{flag} {value}: expected NAME=VALUE"))
}

fn run() -> Result<bool, String> {
    let mut reference = None;
    let mut run = None;
    let mut instruments = BTreeMap::new();
    let mut ticks = BTreeMap::new();
    let mut warmup_bars = T0_REPLICATION_WARMUP_BARS_V1;
    let mut arguments = std::env::args().skip(1);

    while let Some(flag) = arguments.next() {
        let value = arguments
            .next()
            .ok_or_else(|| format!("{flag} needs a value"))?;
        match flag.as_str() {
            "--reference" => reference = Some(value),
            "--run" => run = Some(value),
            "--instrument" => {
                let (coin, instrument) = pair(&flag, &value)?;
                instruments.insert(coin, instrument);
            }
            "--tick" => {
                let (instrument, tick) = pair(&flag, &value)?;
                let tick: f64 = tick.parse().map_err(|e| format!("--tick {value}: {e}"))?;
                ticks.insert(instrument, tick);
            }
            "--warmup-bars" => {
                warmup_bars = value
                    .parse()
                    .map_err(|e| format!("--warmup-bars {value}: {e}"))?;
            }
            _ => return Err(format!("unknown flag {flag}")),
        }
    }
    let reference = reference.ok_or("--reference is required")?;
    let run = run.ok_or("--run is required")?;
    let table = std::fs::read_to_string(&reference).map_err(|e| format!("{reference}: {e}"))?;
    let reference =
        reference_trades_from_research_csv(&table, &instruments).map_err(|e| e.to_string())?;
    let run: BTreeMap<String, RunInstrumentV1> =
        serde_json::from_str(&std::fs::read_to_string(&run).map_err(|e| format!("{run}: {e}"))?)
            .map_err(|e| format!("--run: {e}"))?;
    let read = run_trades_from_fills(&run, warmup_bars, &ticks).map_err(|e| e.to_string())?;
    let output = Output {
        replication: compare_replication_v1(&reference, &read.trades, &read.windows),
        entry_price_check: read.entry_price_check,
    };
    println!(
        "{}",
        serde_json::to_string_pretty(&output).map_err(|e| e.to_string())?
    );
    Ok(output.replication.accepted && output.entry_price_check.outside.is_empty())
}
