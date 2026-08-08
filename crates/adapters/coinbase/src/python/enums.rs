//! Coinbase enumerations Python bindings.

use pyo3::prelude::*;

use crate::common::enums::CoinbaseEnvironment;

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl CoinbaseEnvironment {
    /// Coinbase environment selection (live vs sandbox).
    #[new]
    fn py_new() -> Self {
        Self::default()
    }

    const fn __hash__(&self) -> isize {
        *self as isize
    }

    fn __str__(&self) -> &'static str {
        match self {
            Self::Live => "LIVE",
            Self::Sandbox => "SANDBOX",
        }
    }

    fn __repr__(&self) -> String {
        format!("CoinbaseEnvironment.{}", self.__str__())
    }

    #[getter]
    #[must_use]
    pub fn name(&self) -> String {
        self.__str__().to_string()
    }

    #[getter]
    #[must_use]
    pub fn value(&self) -> u8 {
        *self as u8
    }
}
