//! Vibe core test kit from [PyO3](https://pyo3.rs).

pub mod files;
pub mod testers;

use pyo3::{prelude::*, wrap_pyfunction};

use crate::{DataTesterConfig, ExecTesterConfig};

/// Exposed through `vibe_trader.testkit`.
///
/// # Errors
///
/// Returns a `PyErr` if registering any module components fails.
#[pymodule]
pub fn testkit(_: Python<'_>, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<DataTesterConfig>()?;
    m.add_class::<ExecTesterConfig>()?;
    m.add_function(wrap_pyfunction!(
        files::py_ensure_file_exists_or_download_http,
        m
    )?)?;
    Ok(())
}
