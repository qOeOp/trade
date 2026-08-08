//! Python bindings for Coinbase factory types.

use pyo3::prelude::*;
use vibe_model::identifiers::{AccountId, TraderId};

use crate::{
    common::consts::COINBASE,
    factories::{CoinbaseDataClientFactory, CoinbaseExecutionClientFactory},
};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl CoinbaseDataClientFactory {
    /// Factory for creating Coinbase data clients.
    #[new]
    fn py_new() -> Self {
        Self::new()
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &'static str {
        COINBASE
    }
}

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl CoinbaseExecutionClientFactory {
    /// Factory for creating Coinbase execution clients.
    #[new]
    fn py_new(trader_id: TraderId, account_id: AccountId) -> Self {
        Self::new(trader_id, account_id)
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &'static str {
        COINBASE
    }
}
