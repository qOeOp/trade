use std::{
    fs::File,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use vibe_core::paths::get_test_data_path;
use vibe_model::{
    data::OrderBookDelta,
    instruments::{InstrumentAny, stubs::equity_aapl_itch},
    types::fixed::PRECISION_BYTES,
};
use vibe_serialization::arrow::DecodeFromRecordBatch;

use crate::files::ensure_file_exists_or_download_http;

const TEST_DATA_BASE_URL_ENV: &str = "VIBE_TEST_DATA_BASE_URL";

fn large_test_data_url(filename: &str) -> String {
    let base_url = std::env::var(TEST_DATA_BASE_URL_ENV).unwrap_or_else(|_| {
        panic!("{TEST_DATA_BASE_URL_ENV} must be set to download large test fixtures")
    });
    format!("{}/large/{filename}", base_url.trim_end_matches('/'))
}

/// Returns the full path to the test data file at the specified relative `path` within the standard test data directory.
///
/// # Panics
///
/// Panics if the computed path cannot be represented as a valid UTF-8 string.
#[must_use]
pub fn get_test_data_file_path(path: &str) -> String {
    get_test_data_path()
        .join(path)
        .to_str()
        .unwrap()
        .to_string()
}

/// Returns the full path to the Vibe-specific test data file given by `filename`, within the configured precision directory ("64-bit" or "128-bit").
///
/// # Panics
///
/// Panics if the computed path cannot be represented as a valid UTF-8 string.
#[must_use]
pub fn get_vibe_test_data_file_path(filename: &str) -> String {
    let precision_directory = format!("{}-bit", PRECISION_BYTES * 8);
    let path = get_test_data_path().join("vibe").join(precision_directory);

    path.join(filename).to_str().unwrap().to_string()
}

/// Returns the path to the checksums file for large test data files.
#[must_use]
pub fn get_test_data_large_checksums_filepath() -> PathBuf {
    get_test_data_path().join("large").join("checksums.json")
}

/// Ensures that the specified test data file exists locally by downloading it if necessary, using the provided `url`.
///
/// # Panics
///
/// Panics if the download or checksum verification fails, or if the resulting path cannot be represented as a valid UTF-8 string.
#[must_use]
pub fn ensure_test_data_exists(filename: &str, url: &str) -> PathBuf {
    let filepath = get_test_data_path().join("large").join(filename);
    let checksums_filepath = get_test_data_large_checksums_filepath();
    ensure_file_exists_or_download_http(&filepath, url, Some(&checksums_filepath), None).unwrap();
    filepath
}

/// Ensures the NASDAQ ITCH AAPL deltas Parquet file exists locally, downloading from R2 if necessary.
///
/// # Panics
///
/// Panics if the download or checksum verification fails.
#[must_use]
pub fn ensure_itch_aapl_deltas_parquet() -> PathBuf {
    let filename = "itch_AAPL.XNAS_2019-01-30_deltas.parquet";
    ensure_test_data_exists(filename, &large_test_data_url(filename))
}

/// Ensures the Tardis Deribit BTC-PERPETUAL deltas Parquet file exists locally, downloading from R2 if necessary.
///
/// # Panics
///
/// Panics if the download or checksum verification fails.
#[must_use]
pub fn ensure_tardis_deribit_deltas_parquet() -> PathBuf {
    let filename = "tardis_BTC-PERPETUAL.DERIBIT_2020-04-01_deltas.parquet";
    ensure_test_data_exists(filename, &large_test_data_url(filename))
}

/// Ensures the HISTDATA EURUSD.SIM quotes Parquet file exists locally, downloading from R2
/// if necessary.
///
/// # Panics
///
/// Panics if the download or checksum verification fails.
#[must_use]
pub fn ensure_histdata_eurusd_quotes_parquet() -> PathBuf {
    let filename = "histdata_EURUSD.SIM_2020-01_quotes.parquet";
    ensure_test_data_exists(filename, &large_test_data_url(filename))
}

/// Ensures the HISTDATA EURUSD.SIM instrument Parquet file exists locally, downloading from R2
/// if necessary.
///
/// # Panics
///
/// Panics if the download or checksum verification fails.
#[must_use]
pub fn ensure_histdata_eurusd_instrument_parquet() -> PathBuf {
    let filename = "histdata_EURUSD.SIM_2020-01_instrument.parquet";
    ensure_test_data_exists(filename, &large_test_data_url(filename))
}

/// Returns the path to the Tardis Deribit incremental book L2 test data.
#[must_use]
pub fn get_tardis_deribit_book_l2_path() -> PathBuf {
    get_test_data_path()
        .join("tardis")
        .join("deribit_incremental_book_L2_BTC-PERPETUAL.csv")
}

/// Returns the path to the Tardis Binance Futures book snapshot (depth 5) test data.
#[must_use]
pub fn get_tardis_binance_snapshot5_path() -> PathBuf {
    get_test_data_path()
        .join("tardis")
        .join("binance-futures_book_snapshot_5_BTCUSDT.csv")
}

/// Returns the path to the Tardis Binance Futures book snapshot (depth 25) test data.
#[must_use]
pub fn get_tardis_binance_snapshot25_path() -> PathBuf {
    get_test_data_path()
        .join("tardis")
        .join("binance-futures_book_snapshot_25_BTCUSDT.csv")
}

/// Returns the path to the Tardis Huobi quotes test data.
#[must_use]
pub fn get_tardis_huobi_quotes_path() -> PathBuf {
    get_test_data_path()
        .join("tardis")
        .join("huobi-dm-swap_quotes_BTC-USD.csv")
}

/// Returns the path to the Tardis Bitmex trades test data.
#[must_use]
pub fn get_tardis_bitmex_trades_path() -> PathBuf {
    get_test_data_path()
        .join("tardis")
        .join("bitmex_trades_XBTUSD.csv")
}

/// Returns an AAPL equity instrument with ITCH-compatible precision
/// (`price_precision=4`, `price_increment=0.0001`).
#[must_use]
pub fn itch_aapl_equity() -> InstrumentAny {
    InstrumentAny::Equity(equity_aapl_itch())
}

/// Loads ITCH AAPL order book deltas from the parquet test dataset.
///
/// Downloads the file on first access. Pass `limit` to subsample.
#[must_use]
pub fn load_itch_aapl_deltas(limit: Option<usize>) -> Vec<OrderBookDelta> {
    static PATH: OnceLock<PathBuf> = OnceLock::new();
    let filepath = PATH.get_or_init(ensure_itch_aapl_deltas_parquet);
    load_deltas_from_parquet(filepath, limit)
}

/// Loads Tardis Deribit BTC-PERPETUAL order book deltas from the parquet test dataset.
///
/// Downloads the file on first access. Pass `limit` to subsample.
#[must_use]
pub fn load_tardis_deribit_deltas(limit: Option<usize>) -> Vec<OrderBookDelta> {
    static PATH: OnceLock<PathBuf> = OnceLock::new();
    let filepath = PATH.get_or_init(ensure_tardis_deribit_deltas_parquet);
    load_deltas_from_parquet(filepath, limit)
}

fn load_deltas_from_parquet(filepath: &Path, limit: Option<usize>) -> Vec<OrderBookDelta> {
    let file = File::open(filepath).unwrap();
    let mut builder = ParquetRecordBatchReaderBuilder::try_new(file).unwrap();
    let metadata = builder.schema().metadata().clone();

    if let Some(limit) = limit {
        builder = builder.with_limit(limit);
    }
    let reader = builder.build().unwrap();

    let mut deltas = Vec::new();

    for batch_result in reader {
        let batch = batch_result.unwrap();
        let batch_deltas = OrderBookDelta::decode_batch(&metadata, batch).unwrap();
        deltas.extend(batch_deltas);
    }
    deltas
}
