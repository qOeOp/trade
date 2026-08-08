//! Example demonstrating live data testing with the AX Exchange adapter.
//!
//! Edit the constants below to change the environment, target symbol, and subscriptions.
//!
//! Run with: `cargo run --example ax-data-tester --package vibe-architect-ax --features examples`
//!
//! Credentials are read from the environment when set:
//! - `AX_API_KEY`.
//! - `AX_API_SECRET`.

use vibe_architect_ax::{
    common::{consts::AX_CLIENT_ID, enums::AxEnvironment},
    config::AxDataClientConfig,
    factories::AxDataClientFactory,
};
use vibe_common::enums::Environment;
use vibe_live::node::LiveNode;
use vibe_model::{
    data::BarType,
    identifiers::{InstrumentId, TraderId},
};
use vibe_testkit::testers::{DataTester, DataTesterConfig};

const AX_ENVIRONMENT: AxEnvironment = AxEnvironment::Sandbox;
const TRADER_ID: &str = "TESTER-001";
const NODE_NAME: &str = "AX-TESTER-001";
const SYMBOL: &str = "JPYUSD";

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();

    let environment = Environment::Live;
    let trader_id = TraderId::from(TRADER_ID);
    let node_name = NODE_NAME.to_string();

    let instrument_ids = vec![
        InstrumentId::from(format!("{SYMBOL}-PERP.AX")),
        // InstrumentId::from("EURUSD-PERP.AX"),
        // InstrumentId::from("BTCUSD-PERP.AX"),
    ];

    let ax_config = AxDataClientConfig {
        api_key: std::env::var("AX_API_KEY").ok(),
        api_secret: std::env::var("AX_API_SECRET").ok(),
        environment: AX_ENVIRONMENT,
        ..Default::default()
    };

    let client_factory = AxDataClientFactory::new();
    let client_id = *AX_CLIENT_ID;

    let mut node = LiveNode::builder(trader_id, environment)?
        .with_name(node_name)
        .with_delay_post_stop_secs(2)
        .add_data_client(None, Box::new(client_factory), Box::new(ax_config))?
        .build()?;

    let bar_types = vec![BarType::from(format!(
        "{SYMBOL}-PERP.AX-1-MINUTE-LAST-EXTERNAL"
    ))];

    let tester_config = DataTesterConfig::builder()
        .client_id(client_id)
        .instrument_ids(instrument_ids)
        .bar_types(bar_types)
        .subscribe_quotes(true)
        .subscribe_trades(true)
        .subscribe_mark_prices(true)
        .subscribe_index_prices(true)
        .subscribe_funding_rates(true)
        // .subscribe_book_deltas(true)
        .subscribe_bars(true)
        // .request_instruments(true)
        // .request_bars(true)
        .request_funding_rates(true)
        .manage_book(true)
        .build()?;
    let tester = DataTester::new(tester_config);

    node.add_actor(tester)?;
    node.run().await?;

    Ok(())
}
