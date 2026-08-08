//! BitMEX enumerations Python bindings.

use std::str::FromStr;

use pyo3::{PyTypeInfo, prelude::*, types::PyType};
use strum::IntoEnumIterator;
use vibe_core::python::to_pyvalue_err;

use crate::common::enums::{BitmexEnvironment, BitmexSymbolStatus};

#[pymethods]
impl BitmexSymbolStatus {
    /// Represents the status of a BitMEX symbol.
    #[new]
    fn py_new(py: Python<'_>, value: &Bound<'_, PyAny>) -> PyResult<Self> {
        let t = Self::type_object(py);
        Self::py_from_str(&t, value)
    }

    const fn __hash__(&self) -> isize {
        *self as isize
    }

    fn __repr__(&self) -> String {
        format!(
            "<{}.{}: '{}'>",
            stringify!(BitmexSymbolStatus),
            self.name(),
            self.value(),
        )
    }

    fn __str__(&self) -> String {
        self.to_string()
    }

    #[getter]
    #[must_use]
    pub fn name(&self) -> &str {
        self.as_ref()
    }

    #[getter]
    #[must_use]
    pub const fn value(&self) -> u8 {
        *self as u8
    }

    #[staticmethod]
    #[must_use]
    fn variants() -> Vec<String> {
        Self::iter().map(|x| x.to_string()).collect()
    }

    #[classmethod]
    #[pyo3(name = "from_str")]
    fn py_from_str(_cls: &Bound<'_, PyType>, data: &Bound<'_, PyAny>) -> PyResult<Self> {
        let data_str: String = data.str()?.extract()?;
        Self::from_str(&data_str).map_err(to_pyvalue_err)
    }
}

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl BitmexEnvironment {
    /// BitMEX API environment.
    #[new]
    fn py_new(py: Python<'_>, value: &Bound<'_, PyAny>) -> PyResult<Self> {
        let t = Self::type_object(py);
        Self::py_from_str(&t, value)
    }

    const fn __hash__(&self) -> isize {
        *self as isize
    }

    fn __str__(&self) -> String {
        self.to_string()
    }

    #[getter]
    #[must_use]
    pub fn name(&self) -> String {
        self.to_string()
    }

    #[getter]
    #[must_use]
    pub fn value(&self) -> u8 {
        *self as u8
    }

    #[classmethod]
    #[must_use]
    fn variants(_: &Bound<'_, PyType>) -> Vec<String> {
        Self::iter().map(|x| x.to_string()).collect()
    }

    #[classmethod]
    #[pyo3(name = "from_str")]
    fn py_from_str(_cls: &Bound<'_, PyType>, data: &Bound<'_, PyAny>) -> PyResult<Self> {
        let data_str: String = data.str()?.extract()?;
        Self::from_str(&data_str).map_err(to_pyvalue_err)
    }
}
