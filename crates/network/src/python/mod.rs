//! Python bindings for network configuration.

// We need to allow `unexpected_cfgs` because the PyO3 macros internally check for
// the `gil-refs` feature. We don't define or enable `gil-refs` ourselves (due to a
// memory leak), so the compiler raises an error about an unknown cfg feature.
// This attribute prevents those errors without actually enabling `gil-refs`.
#![allow(unexpected_cfgs)]
use pyo3::prelude::*;

/// Exposed through `vibe_trader.network`.
///
/// # Errors
///
/// Returns a `PyErr` if registering any module components fails.
#[pymodule]
pub fn network(_py: Python<'_>, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<crate::websocket::TransportBackend>()?;

    Ok(())
}
