use pyo3::prelude::*;

use crate::{common::consts::TARDIS, factories::TardisDataClientFactory};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl TardisDataClientFactory {
    /// Factory for creating Tardis data clients.
    #[new]
    fn py_new() -> Self {
        Self
    }

    #[pyo3(name = "name")]
    fn py_name(&self) -> &str {
        TARDIS
    }
}
