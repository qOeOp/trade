//! Python bindings for Betfair factory types.

use pyo3::prelude::*;

use crate::{
    common::consts::BETFAIR,
    factories::{BetfairDataClientFactory, BetfairExecutionClientFactory},
};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl BetfairDataClientFactory {
    /// Factory for creating Betfair data clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &str {
        BETFAIR
    }
}

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl BetfairExecutionClientFactory {
    /// Factory for creating Betfair execution clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &str {
        BETFAIR
    }
}
