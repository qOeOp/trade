//! Python bindings from [PyO3](https://pyo3.rs).

#![expect(
    clippy::missing_errors_doc,
    reason = "errors documented on underlying Rust methods"
)]

pub mod algorithm;
pub mod controller;
pub mod sessions;
pub mod strategy;

#[cfg(feature = "examples")]
mod examples;

use pyo3::{prelude::*, pymodule};

/// Exposed through `vibe_trader.trading`.
///
/// # Errors
///
/// Returns a `PyErr` if registering any module components fails.
#[pymodule]
pub fn trading(_: Python<'_>, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<crate::sessions::ForexSession>()?;
    m.add_function(wrap_pyfunction!(sessions::py_fx_local_from_utc, m)?)?;
    m.add_function(wrap_pyfunction!(sessions::py_fx_next_start, m)?)?;
    m.add_function(wrap_pyfunction!(sessions::py_fx_prev_start, m)?)?;
    m.add_function(wrap_pyfunction!(sessions::py_fx_next_end, m)?)?;
    m.add_function(wrap_pyfunction!(sessions::py_fx_prev_end, m)?)?;
    m.add_class::<strategy::PyStrategy>()?;
    m.add_class::<crate::controller::ImportableControllerConfig>()?;
    m.add_class::<crate::strategy::StrategyConfig>()?;
    m.add_class::<crate::strategy::ImportableStrategyConfig>()?;
    m.add_class::<algorithm::PyExecutionAlgorithm>()?;
    m.add_class::<crate::algorithm::ExecutionAlgorithmConfig>()?;
    m.add_class::<crate::algorithm::ImportableExecAlgorithmConfig>()?;
    #[cfg(feature = "examples")]
    m.add_class::<crate::examples::strategies::CompositeMarketMakerConfig>()?;
    #[cfg(feature = "examples")]
    m.add_class::<crate::examples::strategies::EmaCrossConfig>()?;
    #[cfg(feature = "examples")]
    m.add_class::<crate::examples::strategies::GridMarketMakerConfig>()?;
    #[cfg(feature = "examples")]
    m.add_class::<crate::examples::strategies::DeltaNeutralVolConfig>()?;
    #[cfg(feature = "examples")]
    m.add_class::<crate::examples::strategies::HurstVpinDirectionalConfig>()?;
    #[cfg(feature = "examples")]
    m.add_class::<crate::examples::actors::BookImbalanceActorConfig>()?;
    Ok(())
}
