//! Python bindings from [PyO3](https://pyo3.rs).

pub mod config;
pub mod sizing;

use pyo3::prelude::*;

/// Exposed through `vibe_trader.risk`.
///
/// # Errors
///
/// Returns a `PyErr` if registering any module components fails.
#[pymodule]
pub fn risk(_: Python<'_>, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<crate::engine::config::RiskEngineConfig>()?;
    m.add_class::<crate::python::sizing::PositionSizer>()?;
    m.add_class::<crate::python::sizing::FixedRiskSizer>()?;
    Ok(())
}
