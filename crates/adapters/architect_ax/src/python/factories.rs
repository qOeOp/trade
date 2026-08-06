//! Python bindings for Ax factory types.

use pyo3::prelude::*;

use crate::factories::{AxDataClientFactory, AxExecutionClientFactory};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl AxDataClientFactory {
    /// Factory for creating AX Exchange data clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &'static str {
        "AX"
    }
}

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl AxExecutionClientFactory {
    /// Factory for creating AX Exchange execution clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &'static str {
        "AX"
    }
}
