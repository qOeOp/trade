//! Python bindings for sandbox factories.

use pyo3::prelude::*;

use crate::factory::SandboxExecutionClientFactory;

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl SandboxExecutionClientFactory {
    /// Factory for creating sandbox execution clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &'static str {
        "SANDBOX"
    }
}
