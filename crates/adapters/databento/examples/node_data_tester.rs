//! Example demonstrating live data testing with the Databento adapter.
//!
//! Edit the constants below to change the target instrument and price precision.
//!
//! Live data flows only while the instrument's venue is in session (CME Globex for the defaults);
//! outside trading hours the node connects but receives no quotes or trades.
//!
//! Run with: `cargo run --example databento-data-tester --package vibe-databento`
//!
//! Required credential environment variables:
//! - `DATABENTO_API_KEY`.

use std::path::PathBuf;

use serde_json::json;
use vibe_common::enums::Environment;
use vibe_core::{Params, env::get_env_var};
use vibe_databento::{
    common::DATABENTO_CLIENT_ID,
    factories::{DatabentoDataClientFactory, DatabentoLiveClientConfig},
};
use vibe_live::node::LiveNode;
use vibe_model::identifiers::{InstrumentId, TraderId};
use vibe_testkit::testers::{DataTester, DataTesterConfig};

const TRADER_ID: &str = "TESTER-001";
const NODE_NAME: &str = "DATABENTO-TESTER-001";
const INSTRUMENT_ID: &str = "ESZ6.XCME";
const PRICE_PRECISION: Option<u8> = None;

const PRICE_PRECISION_PARAM: &str = "price_precision";

// Alternative instrument with a price-precision override:
// const INSTRUMENT_ID: &str = "6EM6.XCME";
// const PRICE_PRECISION: Option<u8> = Some(5);

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();

    let environment = Environment::Live;
    let trader_id = TraderId::from(TRADER_ID);
    let node_name = NODE_NAME.to_string();

    let api_key = get_env_var("DATABENTO_API_KEY")?;

    let publishers_filepath = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("publishers.json");
    if !publishers_filepath.exists() {
        println!(
            "WARNING: Publishers file not found at: {}",
            publishers_filepath.display()
        );
    }

    let databento_config = DatabentoLiveClientConfig::new(
        api_key,
        publishers_filepath,
        true, // use_exchange_as_venue
        true, // bars_timestamp_on_close
    );

    let client_factory = DatabentoDataClientFactory::new();
    let client_id = *DATABENTO_CLIENT_ID;
    let instrument_ids = vec![InstrumentId::from(INSTRUMENT_ID)];

    let mut node = LiveNode::builder(trader_id, environment)?
        .with_name(node_name)
        .with_load_state(false)
        .with_save_state(false)
        .with_delay_post_stop_secs(2)
        .add_data_client(None, Box::new(client_factory), Box::new(databento_config))?
        .build()?;

    // Databento applies the price-precision override through subscription params.
    let subscribe_params = PRICE_PRECISION.map(|price_precision| {
        let mut params = Params::new();
        params.insert(PRICE_PRECISION_PARAM.to_string(), json!(price_precision));
        params
    });

    let tester_config = DataTesterConfig::builder()
        .client_id(client_id)
        .instrument_ids(instrument_ids)
        .subscribe_quotes(true)
        .subscribe_trades(true)
        // Databento streams the full order book via MBO (market by order):
        // .subscribe_book_deltas(true)
        // .book_type(BookType::L3_MBO) // MBO is order-level (L3); requires a `BookType` import
        .maybe_subscribe_params(subscribe_params)
        .can_unsubscribe(false) // Databento does not support granular unsubscribing
        .build()?;

    let tester = DataTester::new(tester_config);

    node.add_actor(tester)?;
    node.run().await?;

    Ok(())
}
