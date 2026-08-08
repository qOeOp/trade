//! Python bindings for OKX factory types.

use pyo3::prelude::*;

use crate::{
    common::consts::OKX,
    factories::{OKXDataClientFactory, OKXExecutionClientFactory},
};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl OKXDataClientFactory {
    /// Factory for creating OKX data clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &str {
        OKX
    }
}

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl OKXExecutionClientFactory {
    /// Factory for creating OKX execution clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &str {
        OKX
    }
}
