//! Python bindings for Bybit factory types.

use pyo3::prelude::*;
use vibe_model::identifiers::{AccountId, TraderId};

use crate::factories::{BybitDataClientFactory, BybitExecutionClientFactory};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl BybitDataClientFactory {
    /// Factory for creating Bybit data clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &'static str {
        "BYBIT"
    }
}

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl BybitExecutionClientFactory {
    /// Factory for creating Bybit execution clients.
    #[new]
    fn py_new(trader_id: TraderId, account_id: AccountId) -> Self {
        Self::new(trader_id, account_id)
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &'static str {
        "BYBIT"
    }
}
