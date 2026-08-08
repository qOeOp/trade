//! Example running the Hurst/VPIN directional strategy live against Kraken
//! Futures (`PF_XBTUSD`).
//!
//! Edit the constants below to change the target instrument, bar type, and
//! strategy tuning parameters.
//!
//! Run with: `cargo run -p vibe-kraken --features examples --example kraken-hurst-vpin-live`
//!
//! Required credential environment variables:
//! - `KRAKEN_FUTURES_API_KEY`.
//! - `KRAKEN_FUTURES_API_SECRET`.
//!
//! Point at [demo-futures.kraken.com](https://demo-futures.kraken.com) for
//! paper trading by setting `demo=true` on `resolve_futures` or by using a
//! demo key pair.

use vibe_common::enums::Environment;
use vibe_kraken::{
    common::{consts::KRAKEN_CLIENT_ID, credential::KrakenCredential, enums::KrakenProductType},
    config::{KrakenDataClientConfig, KrakenExecClientConfig},
    factories::{KrakenDataClientFactory, KrakenExecutionClientFactory},
};
use vibe_live::node::LiveNode;
use vibe_model::{
    data::BarType,
    identifiers::{AccountId, InstrumentId, TraderId},
    types::Quantity,
};
use vibe_trading::examples::strategies::{HurstVpinDirectional, HurstVpinDirectionalConfig};

// *** THIS IS A TEST STRATEGY WITH NO ALPHA ADVANTAGE WHATSOEVER. ***
// *** IT IS NOT INTENDED TO BE USED TO TRADE LIVE WITH REAL MONEY. ***

const PRODUCT_TYPE: KrakenProductType = KrakenProductType::Futures;
const TRADER_ID: &str = "TESTER-001";
const ACCOUNT_ID: &str = "KRAKEN-001";
const NODE_NAME: &str = "KRAKEN-HURST-VPIN-001";
const INSTRUMENT_ID: &str = "PF_XBTUSD.KRAKEN";
const BAR_TYPE: &str = "PF_XBTUSD.KRAKEN-2000000-VALUE-LAST-INTERNAL";

const TRADE_SIZE: &str = "0.0100";
const MAX_HOLDING_SECS: u64 = 1800;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();

    let product_type = PRODUCT_TYPE;
    let instrument_id = InstrumentId::from(INSTRUMENT_ID);
    let bar_type = BarType::from(BAR_TYPE);

    let environment = Environment::Live;
    let trader_id = TraderId::from(TRADER_ID);
    let account_id = AccountId::from(ACCOUNT_ID);
    let node_name = NODE_NAME.to_string();
    let client_id = *KRAKEN_CLIENT_ID;

    let credential = KrakenCredential::resolve_futures(None, None, false)
        .ok_or("API credentials required (set KRAKEN_FUTURES_API_KEY/KRAKEN_FUTURES_API_SECRET)")?;
    let (api_key, api_secret) = credential.into_parts();

    let data_config = KrakenDataClientConfig {
        api_key: Some(api_key.clone()),
        api_secret: Some(api_secret.clone()),
        product_type,
        ..Default::default()
    };

    let exec_config = KrakenExecClientConfig {
        trader_id,
        account_id,
        api_key,
        api_secret,
        product_type,
        ..Default::default()
    };

    let data_factory = KrakenDataClientFactory::new();
    let exec_factory = KrakenExecutionClientFactory::new();

    let mut node = LiveNode::builder(trader_id, environment)?
        .with_name(node_name)
        .add_data_client(None, Box::new(data_factory), Box::new(data_config))?
        .add_exec_client(None, Box::new(exec_factory), Box::new(exec_config))?
        .with_delay_post_stop_secs(5)
        .build()?;

    let config = HurstVpinDirectionalConfig::builder()
        .instrument_id(instrument_id)
        .bar_type(bar_type)
        .trade_size(Quantity::from(TRADE_SIZE))
        .max_holding_secs(MAX_HOLDING_SECS)
        .build();
    let strategy = HurstVpinDirectional::new(config);

    node.add_strategy(strategy)?;
    let _ = client_id;
    node.run().await?;

    Ok(())
}
