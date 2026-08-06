//! Python bindings for Lighter factory types.

use pyo3::prelude::*;

use crate::{
    common::consts::LIGHTER,
    factories::{LighterDataClientFactory, LighterExecutionClientFactory},
};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl LighterDataClientFactory {
    /// Factory for creating Lighter data clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &'static str {
        LIGHTER
    }
}

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl LighterExecutionClientFactory {
    /// Factory for creating Lighter execution clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &'static str {
        LIGHTER
    }
}
