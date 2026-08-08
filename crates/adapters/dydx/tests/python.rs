#![cfg(feature = "python")]

use std::{cell::RefCell, rc::Rc};

use pyo3::{Py, Python, types::PyModule};
use rstest::rstest;
use vibe_common::{
    cache::Cache,
    clock::TestClock,
    live::runner::{replace_data_event_sender, replace_exec_event_sender},
    messages::{DataEvent, ExecutionEvent},
};
use vibe_dydx::{
    common::{consts::DYDX, enums::DydxNetwork},
    config::{DydxDataClientConfig, DydxExecClientConfig},
    factories::{DydxDataClientFactory, DydxExecutionClientFactory},
    python,
};
use vibe_model::identifiers::{AccountId, ClientId, TraderId};
use vibe_system::get_global_pyo3_registry;

const SMOKE_WALLET_ADDRESS: &str = "dydx1abc123";
const TEST_PRIVATE_KEY: &str = "0000000000000000000000000000000000000000000000000000000000000001";

#[rstest]
fn test_dydx_python_factories_extract_from_registry() {
    setup_data_event_sender();
    setup_exec_event_sender();
    Python::initialize();

    Python::attach(|py| {
        register_dydx_python_module(py);
        assert_data_factory_extracts_from_python_object(py);
        assert_exec_factory_extracts_from_python_object(py);
    });
}

fn setup_data_event_sender() {
    let (sender, _receiver) = tokio::sync::mpsc::unbounded_channel::<DataEvent>();
    replace_data_event_sender(sender);
}

fn setup_exec_event_sender() {
    let (sender, _receiver) = tokio::sync::mpsc::unbounded_channel::<ExecutionEvent>();
    replace_exec_event_sender(sender);
}

fn register_dydx_python_module(py: Python<'_>) {
    let module = PyModule::new(py, "dydx").expect("dYdX module should be created");
    python::dydx(py, &module).expect("dYdX Python module should register");
}

fn assert_data_factory_extracts_from_python_object(py: Python<'_>) {
    let factory = Py::new(py, DydxDataClientFactory::new())
        .expect("factory should convert to Python object")
        .into_any();
    let config = Py::new(
        py,
        DydxDataClientConfig {
            network: DydxNetwork::Testnet,
            ..DydxDataClientConfig::default()
        },
    )
    .expect("config should convert to Python object")
    .into_any();
    let registry = get_global_pyo3_registry();

    let extracted_factory = registry
        .extract_factory(py, factory)
        .expect("data factory should extract");
    let extracted_config = registry
        .extract_config(py, config)
        .expect("data config should extract");
    let dydx_config = extracted_config
        .as_any()
        .downcast_ref::<DydxDataClientConfig>()
        .expect("data config should downcast");
    let cache = Rc::new(RefCell::new(Cache::default()));
    let clock = Rc::new(RefCell::new(TestClock::new()));
    let client = extracted_factory
        .create(
            "DYDX-DATA-EXTRACTED",
            extracted_config.as_ref(),
            cache.into(),
            clock,
        )
        .expect("extracted factory should create data client");

    assert_eq!(extracted_factory.name(), DYDX);
    assert_eq!(extracted_factory.config_type(), "DydxDataClientConfig");
    assert_eq!(dydx_config.network, DydxNetwork::Testnet);
    assert_eq!(client.client_id(), ClientId::from("DYDX-DATA-EXTRACTED"));
}

fn assert_exec_factory_extracts_from_python_object(py: Python<'_>) {
    let trader_id = TraderId::from("TRADER-001");
    let account_id = AccountId::from("DYDX-001");
    let factory = Py::new(py, DydxExecutionClientFactory::new())
        .expect("factory should convert to Python object")
        .into_any();
    let config = Py::new(
        py,
        DydxExecClientConfig {
            trader_id,
            account_id,
            network: DydxNetwork::Testnet,
            wallet_address: Some(SMOKE_WALLET_ADDRESS.to_string()),
            private_key: Some(TEST_PRIVATE_KEY.to_string()),
            ..DydxExecClientConfig::default()
        },
    )
    .expect("config should convert to Python object")
    .into_any();
    let registry = get_global_pyo3_registry();

    let extracted_factory = registry
        .extract_exec_factory(py, factory)
        .expect("exec factory should extract");
    let extracted_config = registry
        .extract_config(py, config)
        .expect("exec config should extract");
    let dydx_config = extracted_config
        .as_any()
        .downcast_ref::<DydxExecClientConfig>()
        .expect("exec config should downcast");
    let cache = Rc::new(RefCell::new(Cache::default()));
    let client = extracted_factory
        .create(
            "DYDX-EXEC-EXTRACTED",
            extracted_config.as_ref(),
            cache.into(),
        )
        .expect("extracted factory should create exec client");

    assert_eq!(extracted_factory.name(), DYDX);
    assert_eq!(extracted_factory.config_type(), "DydxExecClientConfig");
    assert_eq!(dydx_config.trader_id, trader_id);
    assert_eq!(dydx_config.account_id, account_id);
    assert_eq!(
        dydx_config.wallet_address.as_deref(),
        Some(SMOKE_WALLET_ADDRESS)
    );
    assert_eq!(client.client_id(), ClientId::from("DYDX-EXEC-EXTRACTED"));
    assert_eq!(client.account_id(), account_id);
}
