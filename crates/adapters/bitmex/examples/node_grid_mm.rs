//! Example demonstrating the GridMarketMaker strategy on BitMEX with deadman's switch.
//!
//! The deadman's switch periodically calls the BitMEX `cancelAllAfter` endpoint. If the
//! client loses connectivity the server-side timer expires and all open orders are cancelled.
//!
//! Edit the constants below to change the environment, target instrument, and grid
//! market-making parameters.
//!
//! Run with: `cargo run --example bitmex-grid-mm --package vibe-bitmex --features examples`
//!
//! Credentials are resolved from environment variables automatically when not passed
//! explicitly in the config (`api_key` / `api_secret` fields):
//! - Testnet: `BITMEX_TESTNET_API_KEY` / `BITMEX_TESTNET_API_SECRET`
//! - Mainnet: `BITMEX_API_KEY` / `BITMEX_API_SECRET`

use log::LevelFilter;
use vibe_bitmex::{
    common::enums::BitmexEnvironment,
    config::{BitmexDataClientConfig, BitmexExecClientConfig},
    factories::{BitmexDataClientFactory, BitmexExecFactoryConfig, BitmexExecutionClientFactory},
};
use vibe_common::{enums::Environment, logging::logger::LoggerConfig};
use vibe_live::node::LiveNode;
use vibe_model::{
    identifiers::{InstrumentId, TraderId},
    types::Quantity,
};
use vibe_trading::examples::strategies::{GridMarketMaker, GridMarketMakerConfig};

const BITMEX_ENVIRONMENT: BitmexEnvironment = BitmexEnvironment::Testnet;
const TRADER_ID: &str = "TESTER-001";
const INSTRUMENT_ID: &str = "XBTUSD.BITMEX";
const DEADMANS_SWITCH_TIMEOUT_SECS: u64 = 60;

const MAX_POSITION: &str = "300";
const NUM_LEVELS: usize = 3;
const GRID_STEP_BPS: u32 = 100;
const SKEW_FACTOR: f64 = 0.5;
const REQUOTE_THRESHOLD_BPS: u32 = 10;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();

    let environment = Environment::Live;
    let trader_id = TraderId::from(TRADER_ID);
    let instrument_id = InstrumentId::from(INSTRUMENT_ID);

    let data_config = BitmexDataClientConfig {
        environment: BITMEX_ENVIRONMENT,
        ..Default::default()
    };

    let exec_config = BitmexExecFactoryConfig::new(
        trader_id,
        BitmexExecClientConfig {
            environment: BITMEX_ENVIRONMENT,
            deadmans_switch_timeout_secs: Some(DEADMANS_SWITCH_TIMEOUT_SECS),
            ..Default::default()
        },
    );

    let data_factory = BitmexDataClientFactory::new();
    let exec_factory = BitmexExecutionClientFactory::new();

    let log_config = LoggerConfig {
        stdout_level: LevelFilter::Info,
        ..Default::default()
    };

    let mut node = LiveNode::builder(trader_id, environment)?
        .with_logging(log_config)
        .add_data_client(None, Box::new(data_factory), Box::new(data_config))?
        .add_exec_client(None, Box::new(exec_factory), Box::new(exec_config))?
        .with_reconciliation(true)
        .with_reconciliation_lookback_mins(2880)
        .with_delay_post_stop_secs(5)
        .build()?;

    let config = GridMarketMakerConfig::builder()
        .instrument_id(instrument_id)
        .max_position(Quantity::from(MAX_POSITION))
        .num_levels(NUM_LEVELS)
        .grid_step_bps(GRID_STEP_BPS)
        .skew_factor(SKEW_FACTOR)
        .requote_threshold_bps(REQUOTE_THRESHOLD_BPS)
        .build();
    let strategy = GridMarketMaker::new(config);

    node.add_strategy(strategy)?;
    node.run().await?;

    Ok(())
}
