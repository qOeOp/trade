//! Python bindings for Kraken factory types.

use pyo3::prelude::*;

use crate::factories::{KrakenDataClientFactory, KrakenExecutionClientFactory};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl KrakenDataClientFactory {
    /// Factory for creating Kraken data clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &'static str {
        "KRAKEN"
    }
}

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl KrakenExecutionClientFactory {
    /// Factory for creating Kraken execution clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &'static str {
        "KRAKEN"
    }
}
