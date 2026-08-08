//! Example demonstrating live execution testing with the Deribit adapter.
//!
//! Edit the constants below to change the environment, target instrument, and order size.
//! `USE_TESTNET` defaults to testnet for safety; set it to `false` to trade on mainnet.
//!
//! Run with: `cargo run --example deribit-exec-tester --package vibe-deribit --features examples`
//!
//! Required credential environment variables (testnet variants used when
//! `USE_TESTNET` is `true`):
//! - `DERIBIT_API_KEY` / `DERIBIT_TESTNET_API_KEY`.
//! - `DERIBIT_API_SECRET` / `DERIBIT_TESTNET_API_SECRET`.

use vibe_common::enums::Environment;
use vibe_deribit::{
    common::{consts::DERIBIT_CLIENT_ID, enums::DeribitEnvironment},
    config::{DeribitDataClientConfig, DeribitExecClientConfig},
    factories::{DeribitDataClientFactory, DeribitExecutionClientFactory},
    http::models::DeribitProductType,
};
use vibe_live::{config::LiveExecEngineConfig, node::LiveNode};
use vibe_model::{
    identifiers::{AccountId, InstrumentId, StrategyId, TraderId},
    types::Quantity,
};
use vibe_testkit::testers::{ExecTester, ExecTesterConfig};
use vibe_trading::strategy::StrategyConfig;

const USE_TESTNET: bool = true;
const TRADER_ID: &str = "TESTER-001";
const ACCOUNT_ID: &str = "DERIBIT-001";
const NODE_NAME: &str = "DERIBIT-EXEC-TESTER-001";
const STRATEGY_ID: &str = "EXEC_TESTER-001";
const INSTRUMENT_ID: &str = "BTC-PERPETUAL.DERIBIT";
const ORDER_QTY: u64 = 10; // 10 USD contracts (Deribit minimum)

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();

    let deribit_environment = if USE_TESTNET {
        DeribitEnvironment::Testnet
    } else {
        DeribitEnvironment::Mainnet
    };

    let environment = Environment::Live;
    let trader_id = TraderId::from(TRADER_ID);
    let account_id = AccountId::from(ACCOUNT_ID);
    let node_name = NODE_NAME.to_string();
    let client_id = *DERIBIT_CLIENT_ID;
    let instrument_id = InstrumentId::from(INSTRUMENT_ID);

    let data_config = DeribitDataClientConfig {
        api_key: None,    // Will use env var
        api_secret: None, // Will use env var
        product_types: vec![DeribitProductType::Future],
        environment: deribit_environment,
        ..Default::default()
    };

    let exec_config = DeribitExecClientConfig {
        trader_id,
        account_id,
        api_key: None,    // Will use env var
        api_secret: None, // Will use env var
        product_types: vec![DeribitProductType::Future],
        environment: deribit_environment,
        ..Default::default()
    };

    let data_factory = DeribitDataClientFactory::new();
    let exec_factory = DeribitExecutionClientFactory::new();
    let exec_engine_config = LiveExecEngineConfig {
        open_check_interval_secs: Some(10.0),
        position_check_interval_secs: Some(30.0),
        ..Default::default()
    };

    let mut node = LiveNode::builder(trader_id, environment)?
        .with_name(node_name)
        .with_exec_engine_config(exec_engine_config)
        .add_data_client(None, Box::new(data_factory), Box::new(data_config))?
        .add_exec_client(None, Box::new(exec_factory), Box::new(exec_config))?
        .with_delay_post_stop_secs(5)
        .build()?;

    let order_qty = Quantity::from(ORDER_QTY);

    let tester_config = ExecTesterConfig::builder()
        .base(StrategyConfig {
            strategy_id: Some(StrategyId::from(STRATEGY_ID)),
            external_order_claims: Some(vec![instrument_id]),
            ..Default::default()
        })
        .instrument_id(instrument_id)
        .client_id(client_id)
        .order_qty(order_qty)
        .open_position_on_start_qty(order_qty.as_decimal())
        .use_post_only(true)
        .log_data(false)
        .build()?;

    let tester = ExecTester::new(tester_config);

    node.add_strategy(tester)?;
    node.run().await?;

    Ok(())
}
