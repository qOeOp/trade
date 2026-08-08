//! Python bindings for Binance factory types.

use pyo3::prelude::*;

use crate::{
    common::consts::BINANCE,
    factories::{BinanceDataClientFactory, BinanceExecutionClientFactory},
};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl BinanceDataClientFactory {
    /// Factory for creating Binance data clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &str {
        BINANCE
    }
}

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl BinanceExecutionClientFactory {
    /// Factory for creating Binance Spot execution clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &str {
        BINANCE
    }
}
