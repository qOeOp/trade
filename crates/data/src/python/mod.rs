//! Python bindings from [PyO3](https://pyo3.rs).

pub mod config;
pub mod option_chain_manager;

use pyo3::prelude::*;

/// Exposed through `vibe_trader.data`.
///
/// # Errors
///
/// Returns a `PyErr` if registering any module components fails.
#[pymodule]
pub fn data(_: Python<'_>, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<crate::engine::config::DataEngineConfig>()?;
    m.add_class::<option_chain_manager::PyOptionChainManager>()?;
    Ok(())
}
