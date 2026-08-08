//! Example smoke-test for the Lighter live data client.
//!
//! Edit the constants below to change the environment and target instrument.
//!
//! Run with: `cargo run --example lighter-data-tester --package vibe-lighter --features examples`

use log::LevelFilter;
use vibe_common::{enums::Environment, logging::logger::LoggerConfig};
use vibe_lighter::{
    common::enums::LighterEnvironment, config::LighterDataClientConfig,
    factories::LighterDataClientFactory,
};
use vibe_live::node::LiveNode;
use vibe_model::{
    data::{BarSpecification, BarType},
    enums::{AggregationSource, BarAggregation, PriceType},
    identifiers::{ClientId, InstrumentId, TraderId},
};
use vibe_testkit::testers::{DataTester, DataTesterConfig};

const LIGHTER_ENVIRONMENT: LighterEnvironment = LighterEnvironment::Mainnet;
const TRADER_ID: &str = "TESTER-001";
const NODE_NAME: &str = "LIGHTER-DATA-TESTER-001";
const CLIENT_ID: &str = "LIGHTER";
const INSTRUMENT_ID: &str = "BTC-PERP.LIGHTER";

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();

    let environment = Environment::Live;
    let trader_id = TraderId::from(TRADER_ID);
    let node_name = NODE_NAME.to_string();
    let instrument_id = InstrumentId::from(INSTRUMENT_ID);
    let instrument_ids = vec![
        instrument_id,
        // InstrumentId::from("ETH-PERP.LIGHTER"),
        // InstrumentId::from("SOL-PERP.LIGHTER"),
    ];
    let bar_types = vec![BarType::new(
        instrument_id,
        BarSpecification::new(1, BarAggregation::Minute, PriceType::Last),
        AggregationSource::External,
    )];

    let lighter_config = LighterDataClientConfig::builder()
        .environment(LIGHTER_ENVIRONMENT)
        .build();

    let client_factory = LighterDataClientFactory::new();
    let client_id = ClientId::new(CLIENT_ID);

    let log_config = LoggerConfig {
        stdout_level: LevelFilter::Info,
        ..Default::default()
    };

    let mut node = LiveNode::builder(trader_id, environment)?
        .with_name(node_name)
        .with_logging(log_config)
        .with_delay_post_stop_secs(2)
        .add_data_client(None, Box::new(client_factory), Box::new(lighter_config))?
        .build()?;

    let tester_config = DataTesterConfig::builder()
        .client_id(client_id)
        .instrument_ids(instrument_ids)
        .bar_types(bar_types)
        .request_instruments(true)
        .subscribe_book_deltas(true)
        .manage_book(true)
        // .request_funding_rates(true)
        // .request_bars(true)
        // .request_trades(true)
        // .subscribe_quotes(true)
        // .subscribe_trades(true)
        // .subscribe_bars(true)
        // .subscribe_index_prices(true)
        // .subscribe_mark_prices(true)
        // .subscribe_funding_rates(true)
        .build()?;
    let tester = DataTester::new(tester_config);

    node.add_actor(tester)?;
    node.run().await?;

    Ok(())
}
