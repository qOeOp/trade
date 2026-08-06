//! Python bindings for Polymarket factories.

use pyo3::prelude::*;

use crate::factories::{PolymarketDataClientFactory, PolymarketExecutionClientFactory};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl PolymarketDataClientFactory {
    /// Factory for creating Polymarket data clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &'static str {
        "POLYMARKET"
    }
}

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl PolymarketExecutionClientFactory {
    /// Factory for creating Polymarket execution clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &'static str {
        "POLYMARKET"
    }
}
