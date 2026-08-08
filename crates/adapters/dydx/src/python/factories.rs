//! Python bindings for dYdX factories.

use pyo3::prelude::*;

use crate::factories::{DydxDataClientFactory, DydxExecutionClientFactory};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl DydxDataClientFactory {
    /// Factory for creating dYdX data clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &'static str {
        "DYDX"
    }
}

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl DydxExecutionClientFactory {
    /// Factory for creating dYdX execution clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &'static str {
        "DYDX"
    }
}
