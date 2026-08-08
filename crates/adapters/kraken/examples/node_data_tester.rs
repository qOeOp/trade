//! Example demonstrating live data testing with the Kraken adapter.
//!
//! Edit the constants below to change the product type and target symbols.
//!
//! Run with: `cargo run -p vibe-kraken --example kraken-data-tester --features examples`
//!
//! Credentials are read from the environment when set (optional for public data):
//! - `KRAKEN_API_KEY`.
//! - `KRAKEN_API_SECRET`.

use vibe_common::enums::Environment;
use vibe_kraken::{
    common::{consts::KRAKEN_CLIENT_ID, enums::KrakenProductType},
    config::KrakenDataClientConfig,
    factories::KrakenDataClientFactory,
};
use vibe_live::node::LiveNode;
use vibe_model::{
    data::bar::BarType,
    identifiers::{InstrumentId, TraderId},
};
use vibe_testkit::testers::{DataTester, DataTesterConfig};

// *** THIS IS A TEST STRATEGY WITH NO ALPHA ADVANTAGE WHATSOEVER. ***
// *** IT IS NOT INTENDED TO BE USED TO TRADE LIVE WITH REAL MONEY. ***

const PRODUCT_TYPE: KrakenProductType = KrakenProductType::Futures;
const TRADER_ID: &str = "TESTER-001";
const NODE_NAME: &str = "KRAKEN-TESTER-001";

// Spot symbols are normalized to BTC (from Kraken's XBT).
const SPOT_SYMBOLS: &[&str] = &["BTC/USD"];
// Futures perpetual symbols use the PF_ prefix (e.g. PF_XBTUSD, PF_ETHUSD).
const FUTURES_SYMBOLS: &[&str] = &["PF_XBTUSD"];

const BOOK_INTERVAL_MS: usize = 10;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();

    let product_type = PRODUCT_TYPE;

    let (symbols, subscribe_bars): (&[&str], bool) = match product_type {
        KrakenProductType::Spot => (SPOT_SYMBOLS, true),
        KrakenProductType::Futures => (FUTURES_SYMBOLS, false),
    };

    let instrument_ids: Vec<InstrumentId> = symbols
        .iter()
        .map(|s| InstrumentId::from(format!("{s}.KRAKEN").as_str()))
        .collect();

    let bar_types: Vec<BarType> = if subscribe_bars {
        instrument_ids
            .iter()
            .map(|id| BarType::from(format!("{id}-1-MINUTE-LAST-EXTERNAL").as_str()))
            .collect()
    } else {
        vec![]
    };

    let environment = Environment::Live;
    let trader_id = TraderId::from(TRADER_ID);
    let node_name = NODE_NAME.to_string();
    let client_id = *KRAKEN_CLIENT_ID;

    let kraken_config = KrakenDataClientConfig {
        api_key: None,    // Will use 'KRAKEN_API_KEY' env var if available
        api_secret: None, // Will use 'KRAKEN_API_SECRET' env var if available
        product_type,
        ..Default::default()
    };

    let client_factory = KrakenDataClientFactory::new();

    let mut node = LiveNode::builder(trader_id, environment)?
        .with_name(node_name)
        .add_data_client(None, Box::new(client_factory), Box::new(kraken_config))?
        .with_delay_post_stop_secs(5)
        .build()?;

    let tester_config = DataTesterConfig::builder()
        .client_id(client_id)
        .instrument_ids(instrument_ids)
        .bar_types(bar_types)
        // .subscribe_quotes(true)
        // .subscribe_trades(true)
        // .subscribe_bars(subscribe_bars)
        // .subscribe_mark_prices(subscribe_mark_prices)
        // .subscribe_index_prices(subscribe_index_prices)
        // .request_trades(true)
        // .request_bars(subscribe_bars)
        .book_interval_ms(BOOK_INTERVAL_MS)
        .subscribe_book_at_interval(true)
        .manage_book(true)
        .build()?;

    let tester = DataTester::new(tester_config);

    node.add_actor(tester)?;
    node.run().await?;

    Ok(())
}
