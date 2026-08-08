//! Example demonstrating live execution testing with the dYdX adapter.
//!
//! Edit the constants below to change the network, target instrument, and order size.
//!
//! Run with: `cargo run --example dydx-exec-tester --package vibe-dydx --features examples`
//!
//! Required credential environment variables:
//! - `DYDX_PRIVATE_KEY` (or `DYDX_TESTNET_PRIVATE_KEY` for testnet).
//! - `DYDX_WALLET_ADDRESS` (optional, derived from the private key if not set).

use log::LevelFilter;
use vibe_common::{enums::Environment, logging::logger::LoggerConfig};
use vibe_dydx::{
    common::{consts::DYDX_CLIENT_ID, enums::DydxNetwork},
    config::{DydxDataClientConfig, DydxExecClientConfig},
    factories::{DydxDataClientFactory, DydxExecutionClientFactory},
};
use vibe_live::{config::LiveExecEngineConfig, node::LiveNode};
use vibe_model::{
    identifiers::{AccountId, InstrumentId, StrategyId, TraderId},
    types::Quantity,
};
use vibe_testkit::testers::{ExecTester, ExecTesterConfig};
use vibe_trading::strategy::StrategyConfig;

const DYDX_NETWORK: DydxNetwork = DydxNetwork::Mainnet;
const TRADER_ID: &str = "TESTER-001";
const ACCOUNT_ID: &str = "DYDX-001";
const NODE_NAME: &str = "DYDX-EXEC-TESTER-001";
const STRATEGY_ID: &str = "EXEC_TESTER-001";
const INSTRUMENT_ID: &str = "ETH-USD-PERP.DYDX";
const ORDER_QTY: &str = "0.001"; // Minimum order size for ETH-USD-PERP

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();

    let network = DYDX_NETWORK;

    let environment = Environment::Live;
    let trader_id = TraderId::from(TRADER_ID);
    let account_id = AccountId::from(ACCOUNT_ID);
    let node_name = NODE_NAME.to_string();
    let client_id = *DYDX_CLIENT_ID;
    let instrument_id = InstrumentId::from(INSTRUMENT_ID);

    let data_config = DydxDataClientConfig {
        network,
        ..Default::default()
    };

    let exec_config = DydxExecClientConfig {
        trader_id,
        account_id,
        network,
        ..Default::default()
    };

    let data_factory = DydxDataClientFactory::new();
    let exec_factory = DydxExecutionClientFactory::new();

    let log_config = LoggerConfig {
        stdout_level: LevelFilter::Info,
        ..Default::default()
    };
    let exec_engine_config = LiveExecEngineConfig {
        open_check_interval_secs: Some(10.0),
        position_check_interval_secs: Some(30.0),
        ..Default::default()
    };

    let mut node = LiveNode::builder(trader_id, environment)?
        .with_name(node_name)
        .with_logging(log_config)
        .with_exec_engine_config(exec_engine_config)
        .add_data_client(None, Box::new(data_factory), Box::new(data_config))?
        .add_exec_client(None, Box::new(exec_factory), Box::new(exec_config))?
        .with_reconciliation(true)
        .with_delay_post_stop_secs(5)
        .build()?;

    let order_qty = Quantity::from(ORDER_QTY);

    let tester_config = ExecTesterConfig::builder()
        .base(StrategyConfig {
            strategy_id: Some(StrategyId::from(STRATEGY_ID)),
            external_order_claims: Some(vec![instrument_id]),
            // dYdX uses u32 client order IDs internally, UUIDs are mapped
            use_hyphens_in_client_order_ids: false,
            ..Default::default()
        })
        .instrument_id(instrument_id)
        .client_id(client_id)
        .order_qty(order_qty)
        .log_data(false)
        .use_post_only(true)
        .build()?;

    let tester = ExecTester::new(tester_config);

    node.add_strategy(tester)?;
    node.run().await?;

    Ok(())
}
