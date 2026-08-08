//! Python bindings for BitMEX factory types.

use pyo3::prelude::*;
use vibe_model::identifiers::{AccountId, TraderId};

use crate::{
    config::BitmexExecClientConfig,
    factories::{BitmexDataClientFactory, BitmexExecFactoryConfig, BitmexExecutionClientFactory},
};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl BitmexExecFactoryConfig {
    /// Configuration for creating BitMEX execution clients via factory.
    ///
    /// This wraps `BitmexExecClientConfig` with the additional trader and account
    /// identifiers required by the `ExecutionClientCore`.
    #[new]
    fn py_new(trader_id: TraderId, account_id: AccountId, config: BitmexExecClientConfig) -> Self {
        Self {
            trader_id,
            account_id,
            config,
        }
    }

    fn __repr__(&self) -> String {
        stringify!(BitmexExecFactoryConfig).to_string()
    }
}

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl BitmexDataClientFactory {
    /// Factory for creating BitMEX data clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &'static str {
        "BITMEX"
    }
}

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl BitmexExecutionClientFactory {
    /// Factory for creating BitMEX execution clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &'static str {
        "BITMEX"
    }
}
