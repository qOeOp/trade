//! Python bindings for Interactive Brokers factory types.

use pyo3::prelude::*;
use vibe_model::identifiers::{AccountId, TraderId};

use crate::{
    common::consts::IB,
    factories::{InteractiveBrokersDataClientFactory, InteractiveBrokersExecutionClientFactory},
};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl InteractiveBrokersDataClientFactory {
    /// Factory for creating Interactive Brokers data clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &str {
        IB
    }
}

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl InteractiveBrokersExecutionClientFactory {
    /// Factory for creating Interactive Brokers execution clients.
    #[new]
    fn py_new(trader_id: TraderId, account_id: AccountId) -> Self {
        Self::new(trader_id, account_id)
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &str {
        IB
    }
}
