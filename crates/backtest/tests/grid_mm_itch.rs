//! Grid market maker acceptance tests using AAPL ITCH L3 data.
//!
//! Requires the `high-precision` feature because the ITCH parquet data
//! uses 128-bit fixed-point encoding.

#![cfg(all(feature = "high-precision", feature = "examples"))]

use rstest::rstest;
use tempfile::TempDir;
use vibe_backtest::{
    config::{BacktestEngineConfig, SimulatedVenueConfig},
    engine::BacktestEngine,
};
use vibe_common::throttler::RateLimit;
use vibe_model::{
    data::{Data, OrderBookDelta},
    enums::{AccountType, BookType, OmsType},
    identifiers::{InstrumentId, Venue},
    instruments::{Instrument, InstrumentAny},
    orderbook::OrderBook,
    types::{Currency, Money, Quantity},
};
use vibe_persistence::backend::catalog::ParquetDataCatalog;
use vibe_risk::engine::config::RiskEngineConfig;
use vibe_testkit::common::{itch_aapl_equity, load_itch_aapl_deltas};
use vibe_trading::examples::strategies::{GridMarketMaker, GridMarketMakerConfig};

// Subsample for CI (covers initial snapshot + active trading)
const CI_DELTA_LIMIT: usize = 10_000;

fn create_engine(instrument: &InstrumentAny) -> BacktestEngine {
    // Use an unrestricted throttle rate so the grid MM can place orders freely
    // without hitting the default 100/sec limit on high-frequency ITCH data.
    let unlimited = RateLimit::new(1_000_000, 1_000_000_000);
    let config = BacktestEngineConfig {
        risk_engine: Some(RiskEngineConfig {
            max_order_submit: unlimited,
            max_order_modify: unlimited,
            ..Default::default()
        }),
        ..Default::default()
    };
    let mut engine = BacktestEngine::new(config).unwrap();
    engine
        .add_venue(
            SimulatedVenueConfig::builder()
                .venue(Venue::from("XNAS"))
                .oms_type(OmsType::Netting)
                .account_type(AccountType::Margin)
                .book_type(BookType::L1_MBP)
                .starting_balances(vec![Money::from("1_000_000 USD")])
                .base_currency(Currency::from("USD"))
                .build()
                .unwrap(),
        )
        .unwrap();
    engine.add_instrument(instrument).unwrap();
    engine
}

fn create_strategy(instrument_id: InstrumentId) -> GridMarketMaker {
    let config = GridMarketMakerConfig::builder()
        .instrument_id(instrument_id)
        .max_position(Quantity::from("100"))
        .trade_size(Quantity::from("100"))
        .num_levels(3)
        .grid_step_bps(10)
        .skew_factor(0.01)
        .requote_threshold_bps(5)
        .build();
    GridMarketMaker::new(config)
}

#[rstest]
fn test_grid_mm_itch_direct_load() {
    let deltas = load_itch_aapl_deltas(Some(CI_DELTA_LIMIT));
    let quotes = OrderBook::deltas_to_quotes(BookType::L3_MBO, &deltas);
    let data: Vec<Data> = quotes.into_iter().map(Data::Quote).collect();
    let num_quotes = data.len();
    let instrument = itch_aapl_equity();
    let instrument_id = instrument.id();

    let mut engine = create_engine(&instrument);
    engine.add_strategy(create_strategy(instrument_id)).unwrap();
    engine.add_data(data, None, true, true).unwrap();

    engine.run(None, None, None, false).unwrap();

    let result = engine.get_result();
    assert_eq!(result.iterations, num_quotes);
    assert!(
        result.total_orders > 0,
        "Expected grid MM to place orders, was 0"
    );
}

#[rstest]
fn test_grid_mm_itch_catalog_load() {
    let deltas = load_itch_aapl_deltas(Some(CI_DELTA_LIMIT));
    let instrument = itch_aapl_equity();
    let instrument_id = instrument.id();

    // Write deltas to a temp catalog then query back
    let temp_dir = TempDir::new().unwrap();
    let catalog = ParquetDataCatalog::new(temp_dir.path(), None, None, None, None);
    catalog.write_to_parquet(&deltas, None, None, None).unwrap();
    catalog.write_instruments(vec![instrument.clone()]).unwrap();

    let mut catalog = ParquetDataCatalog::new(temp_dir.path(), None, None, None, None);
    let loaded_deltas: Vec<OrderBookDelta> = catalog
        .query_typed_data(
            Some(vec![instrument_id.to_string()]),
            None,
            None,
            None,
            None,
            true,
        )
        .unwrap();

    assert_eq!(loaded_deltas.len(), deltas.len());

    // Run backtest with catalog-loaded data
    let quotes = OrderBook::deltas_to_quotes(BookType::L3_MBO, &loaded_deltas);
    let data: Vec<Data> = quotes.into_iter().map(Data::Quote).collect();
    let num_quotes = data.len();
    let mut engine = create_engine(&instrument);
    engine.add_strategy(create_strategy(instrument_id)).unwrap();
    engine.add_data(data, None, true, true).unwrap();

    engine.run(None, None, None, false).unwrap();

    let result = engine.get_result();
    assert_eq!(result.iterations, num_quotes);
    assert!(
        result.total_orders > 0,
        "Expected grid MM to place orders, was 0"
    );
}

#[rstest]
fn test_grid_mm_itch_streaming() {
    let deltas = load_itch_aapl_deltas(Some(CI_DELTA_LIMIT));
    let instrument = itch_aapl_equity();
    let instrument_id = instrument.id();

    // Generate quotes from the full delta set, then split for streaming
    let all_quotes: Vec<Data> = OrderBook::deltas_to_quotes(BookType::L3_MBO, &deltas)
        .into_iter()
        .map(Data::Quote)
        .collect();
    let midpoint = all_quotes.len() / 2;
    let batch1 = all_quotes[..midpoint].to_vec();
    let batch2 = all_quotes[midpoint..].to_vec();

    // Streaming: two batches
    let mut engine = create_engine(&instrument);
    engine.add_strategy(create_strategy(instrument_id)).unwrap();

    engine.add_data(batch1, None, true, true).unwrap();
    engine.run(None, None, None, true).unwrap();

    engine.clear_data();
    engine.add_data(batch2, None, true, true).unwrap();
    engine.run(None, None, None, false).unwrap();

    let streaming_result = engine.get_result();
    assert_eq!(streaming_result.iterations, all_quotes.len());
    assert!(
        streaming_result.total_orders > 0,
        "Expected grid MM to place orders, was 0"
    );
}
