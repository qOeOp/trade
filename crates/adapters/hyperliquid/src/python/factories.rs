//! Python bindings for Hyperliquid factory types.

use pyo3::prelude::*;
use vibe_model::identifiers::{AccountId, TraderId};

use crate::{
    config::HyperliquidExecClientConfig,
    factories::{
        HyperliquidDataClientFactory, HyperliquidExecFactoryConfig,
        HyperliquidExecutionClientFactory,
    },
};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl HyperliquidDataClientFactory {
    /// Factory for creating Hyperliquid data clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &'static str {
        "HYPERLIQUID"
    }
}

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl HyperliquidExecutionClientFactory {
    /// Factory for creating Hyperliquid execution clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &'static str {
        "HYPERLIQUID"
    }
}

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl HyperliquidExecFactoryConfig {
    /// Configuration for creating Hyperliquid execution clients via factory.
    ///
    /// This wraps `HyperliquidExecClientConfig` with the additional trader and account
    /// identifiers required by the `ExecutionClientCore`.
    #[new]
    fn py_new(
        trader_id: TraderId,
        account_id: AccountId,
        config: HyperliquidExecClientConfig,
    ) -> Self {
        Self {
            trader_id,
            account_id,
            config,
        }
    }

    fn __repr__(&self) -> String {
        stringify!(HyperliquidExecFactoryConfig).to_string()
    }
}
