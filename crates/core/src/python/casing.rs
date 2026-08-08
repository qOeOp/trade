//! String-case conversion helpers (`CamelCase` ⇄ `snake_case`).

use pyo3::prelude::*;
use pyo3_stub_gen::derive::gen_stub_pyfunction;

use crate::string::conversions::to_snake_case;

/// Convert the given string from any common case (PascalCase, camelCase, kebab-case, etc.)
/// to *lower* `snake_case`.
///
/// Parameters
/// ----------
/// input : str
///     The input string to convert.
///
/// Returns
/// -------
/// str
#[must_use]
#[pyfunction(name = "convert_to_snake_case")]
#[gen_stub_pyfunction(module = "vibe_trader.core")]
pub fn py_convert_to_snake_case(input: &str) -> String {
    to_snake_case(input)
}
