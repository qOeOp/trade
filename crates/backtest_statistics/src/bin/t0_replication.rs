//! Compares a run's trades with research T0's, trade by trade, and prints the report as JSON.
//!
//! ```text
//! t0-replication --reference trades.csv --run run.json --instrument BTC=BTCUSDT-PERP.BINANCE \
//!     [--instrument ...] [--price-band 0.005] [--warmup-bars 200]
//! ```
//!
//! `--reference` is research's `trend/trades.csv` (uncompressed). `--run` is a JSON object from
//! instrument to `{"bars": [{"open_ns", "open"}], "fills": [{"at_ns", "side", "quantity",
//! "price"}]}`, the run's daily bars and fills. Exits 0 when the match rate reaches the threshold,
//! 1 when it does not, and 2 when an input cannot be read.

use std::{collections::BTreeMap, process::ExitCode};

use vibe_backtest_statistics::{
    RunInstrumentV1, T0_REPLICATION_WARMUP_BARS_V1, compare_replication_v1,
    reference_trades_from_research_csv, run_trades_from_fills,
};

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

fn run() -> Result<bool, String> {
    let mut reference = None;
    let mut run = None;
    let mut instruments = BTreeMap::new();
    let mut price_band = 0.005;
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
                let (coin, instrument) = value
                    .split_once('=')
                    .ok_or_else(|| format!("--instrument {value}: expected COIN=INSTRUMENT"))?;
                instruments.insert(coin.to_owned(), instrument.to_owned());
            }
            "--price-band" => {
                price_band = value
                    .parse()
                    .map_err(|e| format!("--price-band {value}: {e}"))?;
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
    let (run, windows) = run_trades_from_fills(&run, warmup_bars).map_err(|e| e.to_string())?;
    let report = compare_replication_v1(&reference, &run, &windows, price_band);
    println!(
        "{}",
        serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?
    );
    Ok(report.accepted)
}
