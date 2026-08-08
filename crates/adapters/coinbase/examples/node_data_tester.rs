//! Example demonstrating live data testing with the Coinbase adapter.
//!
//! Edit the constants below to change the environment, target instrument, and bar specification.
//!
//! Run with: `cargo run --example coinbase-data-tester --package vibe-coinbase --features examples`
//!
//! Credentials are read from the environment when set (optional for public market data):
//! - `COINBASE_API_KEY`: CDP API key name (`organizations/{org_id}/apiKeys/{key_id}`).
//! - `COINBASE_API_SECRET`: PEM-encoded EC private key.

use vibe_coinbase::{
    common::{consts::COINBASE_CLIENT_ID, enums::CoinbaseEnvironment},
    config::CoinbaseDataClientConfig,
    factories::CoinbaseDataClientFactory,
};
use vibe_common::enums::Environment;
use vibe_live::node::LiveNode;
use vibe_model::{
    data::bar::BarType,
    identifiers::{InstrumentId, TraderId},
};
use vibe_testkit::testers::{DataTester, DataTesterConfig};

const COINBASE_ENVIRONMENT: CoinbaseEnvironment = CoinbaseEnvironment::Live;
const TRADER_ID: &str = "TESTER-001";
const NODE_NAME: &str = "COINBASE-TESTER-001";
const INSTRUMENT_ID: &str = "BTC-USD.COINBASE";
const BAR_SPEC: &str = "1-MINUTE-LAST-EXTERNAL";

// *** THIS IS A TEST STRATEGY WITH NO ALPHA ADVANTAGE WHATSOEVER. ***
// *** IT IS NOT INTENDED TO BE USED TO TRADE LIVE WITH REAL MONEY. ***

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();

    let environment = Environment::Live;
    let coinbase_environment = COINBASE_ENVIRONMENT;
    let trader_id = TraderId::from(TRADER_ID);
    let node_name = NODE_NAME.to_string();
    let client_id = *COINBASE_CLIENT_ID;

    let instrument_ids = vec![InstrumentId::from(INSTRUMENT_ID)];

    let bar_types: Vec<BarType> = instrument_ids
        .iter()
        .map(|id| BarType::from(format!("{id}-{BAR_SPEC}").as_str()))
        .collect();

    let coinbase_config = CoinbaseDataClientConfig {
        environment: coinbase_environment,
        api_key: None,    // Will use 'COINBASE_API_KEY' env var if available
        api_secret: None, // Will use 'COINBASE_API_SECRET' env var if available
        ..Default::default()
    };

    let client_factory = CoinbaseDataClientFactory::new();

    let mut node = LiveNode::builder(trader_id, environment)?
        .with_name(node_name)
        .with_load_state(false)
        .with_save_state(false)
        .with_delay_post_stop_secs(2)
        .add_data_client(None, Box::new(client_factory), Box::new(coinbase_config))?
        .build()?;

    let tester_config = DataTesterConfig::builder()
        .client_id(client_id)
        .instrument_ids(instrument_ids)
        .subscribe_quotes(true)
        .subscribe_trades(true)
        .subscribe_book_deltas(true)
        .bar_types(bar_types)
        .subscribe_bars(true)
        .request_bars(true)
        .request_book_snapshot(true)
        .manage_book(true)
        .build()?;

    let tester = DataTester::new(tester_config);

    node.add_actor(tester)?;
    node.run().await?;

    Ok(())
}
