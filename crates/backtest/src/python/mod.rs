//! Python bindings from [PyO3](https://pyo3.rs).

pub mod config;
pub mod engine;
pub mod modules;
pub mod node;
pub mod result;

use pyo3::prelude::*;

/// Exposed through `vibe_trader.backtest`.
///
/// # Errors
///
/// Returns a `PyErr` if registering any module components fails.
#[pymodule]
pub fn backtest(_: Python<'_>, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<crate::config::BacktestEngineConfig>()?;
    m.add_class::<crate::config::BacktestVenueConfig>()?;
    m.add_class::<crate::config::BacktestDataConfig>()?;
    m.add_class::<crate::config::BacktestRunConfig>()?;
    m.add_class::<crate::result::BacktestResult>()?;
    m.add_class::<crate::node::BacktestNode>()?;
    m.add_class::<engine::PyBacktestEngine>()?;
    m.add_class::<crate::modules::fx_rollover::InterestRateRecord>()?;
    m.add_class::<crate::modules::fx_rollover::FXRolloverInterestModule>()?;
    Ok(())
}
