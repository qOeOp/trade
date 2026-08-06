//! Python bindings for Deribit factory types.

use pyo3::prelude::*;

use crate::factories::{DeribitDataClientFactory, DeribitExecutionClientFactory};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl DeribitDataClientFactory {
    /// Factory for creating Deribit data clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &'static str {
        "DERIBIT"
    }
}

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl DeribitExecutionClientFactory {
    /// Factory for creating Deribit execution clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &'static str {
        "DERIBIT"
    }
}
