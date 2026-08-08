use rstest::rstest;
use vibe_testkit::common::{
    ensure_histdata_eurusd_instrument_parquet, ensure_histdata_eurusd_quotes_parquet,
};

#[rstest]
fn ensure_histdata_eurusd_quotes_parquet_downloads() {
    let filepath = ensure_histdata_eurusd_quotes_parquet();

    assert!(filepath.exists());
    assert_eq!(
        filepath.file_name().unwrap().to_str().unwrap(),
        "histdata_EURUSD.SIM_2020-01_quotes.parquet",
    );
}

#[rstest]
fn ensure_histdata_eurusd_instrument_parquet_downloads() {
    let filepath = ensure_histdata_eurusd_instrument_parquet();

    assert!(filepath.exists());
    assert_eq!(
        filepath.file_name().unwrap().to_str().unwrap(),
        "histdata_EURUSD.SIM_2020-01_instrument.parquet",
    );
}
