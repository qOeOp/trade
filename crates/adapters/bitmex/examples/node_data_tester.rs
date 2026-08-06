//! Example demonstrating live data testing with the BitMEX adapter.
//!
//! Edit the constants below to change the environment and target instrument.
//!
//! Run with: `cargo run --example bitmex-data-tester --package vibe-bitmex --features examples`
//!
//! Credentials are resolved from environment variables automatically when not passed
//! explicitly in the config (`api_key` / `api_secret` fields):
//! - Testnet: `BITMEX_TESTNET_API_KEY` / `BITMEX_TESTNET_API_SECRET`
//! - Mainnet: `BITMEX_API_KEY` / `BITMEX_API_SECRET`

use vibe_bitmex::{
    common::{consts::BITMEX_CLIENT_ID, enums::BitmexEnvironment},
    config::BitmexDataClientConfig,
    factories::BitmexDataClientFactory,
};
use vibe_common::enums::Environment;
use vibe_live::node::LiveNode;
use vibe_model::identifiers::{InstrumentId, TraderId};
use vibe_testkit::testers::{DataTester, DataTesterConfig};

const BITMEX_ENVIRONMENT: BitmexEnvironment = BitmexEnvironment::Testnet;
const TRADER_ID: &str = "TESTER-001";
const INSTRUMENT_ID: &str = "XBTUSD.BITMEX";

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();

    let environment = Environment::Live;
    let trader_id = TraderId::from(TRADER_ID);
    let instrument_ids = vec![InstrumentId::from(INSTRUMENT_ID)];

    let bitmex_config = BitmexDataClientConfig {
        environment: BITMEX_ENVIRONMENT,
        ..Default::default()
    };

    let client_factory = BitmexDataClientFactory::new();
    let client_id = *BITMEX_CLIENT_ID;

    let mut node = LiveNode::builder(trader_id, environment)?
        .with_delay_post_stop_secs(2)
        .add_data_client(None, Box::new(client_factory), Box::new(bitmex_config))?
        .build()?;

    let tester_config = DataTesterConfig::builder()
        .client_id(client_id)
        .instrument_ids(instrument_ids)
        .subscribe_quotes(true)
        .subscribe_trades(true)
        .subscribe_mark_prices(true)
        .subscribe_index_prices(true)
        .subscribe_funding_rates(true)
        .subscribe_instrument_status(true)
        .manage_book(true)
        .build()?;
    let tester = DataTester::new(tester_config);

    node.add_actor(tester)?;
    node.run().await?;

    Ok(())
}
