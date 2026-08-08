//! Example demonstrating live execution testing with the OKX adapter.
//!
//! Edit the constants below to change the environment, target instrument, and order size.
//!
//! Run with: `cargo run --example okx-exec-tester --package vibe-okx --features examples`
//!
//! Required credential environment variables:
//! - `OKX_API_KEY`.
//! - `OKX_API_SECRET`.
//! - `OKX_API_PASSPHRASE`.

use vibe_common::enums::Environment;
use vibe_live::{config::LiveExecEngineConfig, node::LiveNode};
use vibe_model::{
    identifiers::{AccountId, InstrumentId, StrategyId, TraderId},
    types::Quantity,
};
use vibe_okx::{
    common::{
        consts::OKX_CLIENT_ID,
        enums::{OKXEnvironment, OKXInstrumentType},
    },
    config::{OKXDataClientConfig, OKXExecClientConfig},
    factories::{OKXDataClientFactory, OKXExecutionClientFactory},
};
use vibe_testkit::testers::{ExecTester, ExecTesterConfig};
use vibe_trading::strategy::StrategyConfig;

const OKX_ENVIRONMENT: OKXEnvironment = OKXEnvironment::Live;
const TRADER_ID: &str = "TESTER-001";
const ACCOUNT_ID: &str = "OKX-001";
const NODE_NAME: &str = "OKX-EXEC-TESTER-001";
const STRATEGY_ID: &str = "EXEC_TESTER-001";
const INSTRUMENT_ID: &str = "ETH-USDT-SWAP.OKX";
const ORDER_QTY: &str = "0.01";

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();

    let okx_environment = OKX_ENVIRONMENT;
    let environment = Environment::Live;
    let trader_id = TraderId::from(TRADER_ID);
    let account_id = AccountId::from(ACCOUNT_ID);
    let node_name = NODE_NAME.to_string();
    let client_id = *OKX_CLIENT_ID;
    let instrument_id = InstrumentId::from(INSTRUMENT_ID);

    let data_config = OKXDataClientConfig {
        api_key: None,        // Will use 'OKX_API_KEY' env var
        api_secret: None,     // Will use 'OKX_API_SECRET' env var
        api_passphrase: None, // Will use 'OKX_API_PASSPHRASE' env var
        instrument_types: vec![OKXInstrumentType::Spot, OKXInstrumentType::Swap],
        environment: okx_environment,
        ..Default::default()
    };

    let exec_config = OKXExecClientConfig {
        trader_id,
        account_id,
        api_key: None,        // Will use 'OKX_API_KEY' env var
        api_secret: None,     // Will use 'OKX_API_SECRET' env var
        api_passphrase: None, // Will use 'OKX_API_PASSPHRASE' env var
        instrument_types: vec![OKXInstrumentType::Spot, OKXInstrumentType::Swap],
        environment: okx_environment,
        ..Default::default()
    };

    let data_factory = OKXDataClientFactory::new();
    let exec_factory = OKXExecutionClientFactory::new();
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
        .with_reconciliation(true)
        .with_delay_post_stop_secs(5)
        .build()?;

    let order_qty = Quantity::from(ORDER_QTY);

    let tester_config = ExecTesterConfig::builder()
        .base(StrategyConfig {
            strategy_id: Some(StrategyId::from(STRATEGY_ID)),
            external_order_claims: Some(vec![instrument_id]),
            // OKX doesn't allow hyphens in client order IDs
            use_hyphens_in_client_order_ids: false,
            ..Default::default()
        })
        .instrument_id(instrument_id)
        .client_id(client_id)
        .order_qty(order_qty)
        .open_position_on_start_qty(order_qty.as_decimal())
        .log_data(false)
        // .enable_limit_buys(false)
        // .enable_limit_sells(false)
        // .enable_stop_sells(true)
        // .stop_order_type(OrderType::TrailingStopMarket)
        // .trailing_offset(Decimal::from(100))
        // .trailing_offset_type(TrailingOffsetType::BasisPoints)
        // .stop_offset_ticks(50)
        .build()?;

    let tester = ExecTester::new(tester_config);

    node.add_strategy(tester)?;
    node.run().await?;

    Ok(())
}
