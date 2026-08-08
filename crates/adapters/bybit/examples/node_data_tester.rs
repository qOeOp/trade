//! Example demonstrating live data testing with the Bybit adapter.
//!
//! Edit the constants below to change the target instrument and subscriptions.
//!
//! Run with: `cargo run --example bybit-data-tester --package vibe-bybit --features examples`
//!
//! Credentials are read from the environment when set:
//! - `BYBIT_API_KEY`.
//! - `BYBIT_API_SECRET`.

use vibe_bybit::{
    common::{consts::BYBIT_CLIENT_ID, enums::BybitProductType},
    config::BybitDataClientConfig,
    factories::BybitDataClientFactory,
};
use vibe_common::enums::Environment;
use vibe_live::node::LiveNode;
use vibe_model::identifiers::{InstrumentId, TraderId};
use vibe_testkit::testers::{DataTester, DataTesterConfig};

const TRADER_ID: &str = "TESTER-001";
const NODE_NAME: &str = "BYBIT-TESTER-001";
const INSTRUMENT_ID: &str = "BTCUSDT-LINEAR.BYBIT";

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();

    let environment = Environment::Live;
    let trader_id = TraderId::from(TRADER_ID);
    let node_name = NODE_NAME.to_string();
    let instrument_ids = vec![InstrumentId::from(INSTRUMENT_ID)];

    let bybit_config = BybitDataClientConfig {
        api_key: None,    // Will use 'BYBIT_API_KEY' env var
        api_secret: None, // Will use 'BYBIT_API_SECRET' env var
        product_types: vec![BybitProductType::Linear],
        ..Default::default()
    };

    let client_factory = BybitDataClientFactory::new();
    let client_id = *BYBIT_CLIENT_ID;

    let mut node = LiveNode::builder(trader_id, environment)?
        .with_name(node_name)
        .with_delay_post_stop_secs(2)
        .add_data_client(None, Box::new(client_factory), Box::new(bybit_config))?
        .build()?;

    let tester_config = DataTesterConfig::builder()
        .client_id(client_id)
        .instrument_ids(instrument_ids)
        .subscribe_quotes(true)
        .subscribe_trades(true)
        .subscribe_mark_prices(true)
        .subscribe_index_prices(true)
        .subscribe_funding_rates(true)
        .manage_book(true)
        .build()?;
    let tester = DataTester::new(tester_config);

    node.add_actor(tester)?;
    node.run().await?;

    Ok(())
}
