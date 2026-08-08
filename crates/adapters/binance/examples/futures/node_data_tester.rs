//! Example demonstrating live data testing with the Binance Futures USD-M adapter.
//!
//! Edit the constants below to change the environment and subscriptions. Set
//! `BINANCE_FUTURES_INSTRUMENT_ID` to override the target instrument.
//!
//! Run with: `cargo run --example binance-futures-data-tester --package vibe-binance --features examples`
//!
//! Uses testnet by default for safety.

use vibe_binance::{
    common::{
        consts::BINANCE_CLIENT_ID,
        enums::{BinanceEnvironment, BinanceProductType},
    },
    config::BinanceDataClientConfig,
    factories::BinanceDataClientFactory,
};
use vibe_common::enums::Environment;
use vibe_live::node::LiveNode;
use vibe_model::identifiers::{InstrumentId, TraderId};
use vibe_testkit::testers::{DataTester, DataTesterConfig};

const BINANCE_ENVIRONMENT: BinanceEnvironment = BinanceEnvironment::Testnet;
const TRADER_ID: &str = "TESTER-001";
const NODE_NAME: &str = "BINANCE-FUTURES-TESTER-001";
const DEFAULT_INSTRUMENT_ID: &str = "BTCUSDT-PERP.BINANCE";

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();

    let environment = Environment::Live;
    let trader_id = TraderId::from(TRADER_ID);
    let node_name = NODE_NAME.to_string();
    let instrument_id = std::env::var("BINANCE_FUTURES_INSTRUMENT_ID")
        .unwrap_or_else(|_| DEFAULT_INSTRUMENT_ID.to_string());
    let instrument_ids = vec![
        InstrumentId::from(instrument_id.as_str()),
        // InstrumentId::from("ETHUSDT-PERP.BINANCE"),
    ];

    let binance_config = BinanceDataClientConfig {
        product_type: BinanceProductType::UsdM,
        environment: BINANCE_ENVIRONMENT,
        api_key: None,
        api_secret: None,
        ..Default::default()
    };

    let client_factory = BinanceDataClientFactory::new();
    let client_id = *BINANCE_CLIENT_ID;

    let mut node = LiveNode::builder(trader_id, environment)?
        .with_name(node_name)
        .with_delay_post_stop_secs(2)
        .add_data_client(None, Box::new(client_factory), Box::new(binance_config))?
        .build()?;

    let tester_config = DataTesterConfig::builder()
        .client_id(client_id)
        .instrument_ids(instrument_ids)
        .subscribe_book_at_interval(true)
        .book_depth(20)
        .book_interval_ms(10)
        .manage_book(true)
        .build()?;
    let tester = DataTester::new(tester_config);

    node.add_actor(tester)?;
    node.run().await?;

    Ok(())
}
