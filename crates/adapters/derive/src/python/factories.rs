//! Python bindings for Derive factory types.

use pyo3::prelude::*;
use vibe_model::identifiers::{AccountId, TraderId};

use crate::{
    common::consts::DERIVE,
    config::DeriveExecClientConfig,
    factories::{DeriveDataClientFactory, DeriveExecFactoryConfig, DeriveExecutionClientFactory},
};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl DeriveDataClientFactory {
    /// Factory for creating Derive data clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &str {
        DERIVE
    }
}

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl DeriveExecFactoryConfig {
    /// Configuration for creating Derive execution clients via factory.
    #[new]
    fn py_new(trader_id: TraderId, account_id: AccountId, config: DeriveExecClientConfig) -> Self {
        Self {
            trader_id,
            account_id,
            config,
        }
    }

    fn __repr__(&self) -> String {
        stringify!(DeriveExecFactoryConfig).to_string()
    }
}

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl DeriveExecutionClientFactory {
    /// Factory for creating Derive execution clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &str {
        DERIVE
    }
}
