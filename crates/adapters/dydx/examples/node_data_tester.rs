//! Example demonstrating live data testing with the dYdX adapter.
//!
//! Edit the constants below to change the network, target instrument, and subscriptions.
//!
//! Run with: `cargo run --example dydx-data-tester --package vibe-dydx --features examples`

use log::LevelFilter;
use vibe_common::{enums::Environment, logging::logger::LoggerConfig};
use vibe_dydx::{
    common::{consts::DYDX_CLIENT_ID, enums::DydxNetwork},
    config::DydxDataClientConfig,
    factories::DydxDataClientFactory,
};
use vibe_live::node::LiveNode;
use vibe_model::identifiers::{InstrumentId, TraderId};
use vibe_testkit::testers::{DataTester, DataTesterConfig};

const DYDX_NETWORK: DydxNetwork = DydxNetwork::Mainnet;
const TRADER_ID: &str = "TESTER-001";
const NODE_NAME: &str = "DYDX-DATA-TESTER-001";
const INSTRUMENT_ID: &str = "BTC-USD-PERP.DYDX";

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();

    let environment = Environment::Live;
    let trader_id = TraderId::from(TRADER_ID);
    let node_name = NODE_NAME.to_string();
    let instrument_ids = vec![InstrumentId::from(INSTRUMENT_ID)];

    let dydx_config = DydxDataClientConfig {
        network: DYDX_NETWORK,
        ..Default::default()
    };

    let client_factory = DydxDataClientFactory::new();
    let client_id = *DYDX_CLIENT_ID;

    let log_config = LoggerConfig {
        stdout_level: LevelFilter::Info,
        ..Default::default()
    };

    let mut node = LiveNode::builder(trader_id, environment)?
        .with_name(node_name)
        .with_logging(log_config)
        .with_delay_post_stop_secs(2)
        .add_data_client(None, Box::new(client_factory), Box::new(dydx_config))?
        .build()?;

    let tester_config = DataTesterConfig::builder()
        .client_id(client_id)
        .instrument_ids(instrument_ids)
        // .subscribe_quotes(true)
        // .subscribe_trades(true)
        .subscribe_book_at_interval(true)
        .book_interval_ms(10)
        .manage_book(true)
        .build()?;
    let tester = DataTester::new(tester_config);

    node.add_actor(tester)?;
    node.run().await?;

    Ok(())
}
