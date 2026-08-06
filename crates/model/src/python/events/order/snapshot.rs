use pyo3::{basic::CompareOp, prelude::*, types::PyDict};
use vibe_core::python::{IntoPyObjectVibeExt, serialization::from_dict_pyo3};

use crate::events::OrderSnapshot;

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl OrderSnapshot {
    fn __richcmp__(&self, other: &Self, op: CompareOp, py: Python<'_>) -> Py<PyAny> {
        match op {
            CompareOp::Eq => self.eq(other).into_py_any_unwrap(py),
            CompareOp::Ne => self.ne(other).into_py_any_unwrap(py),
            _ => py.NotImplemented(),
        }
    }

    fn __repr__(&self) -> String {
        format!("{self:?}")
    }

    #[staticmethod]
    #[pyo3(name = "from_dict")]
    fn py_from_dict(py: Python<'_>, values: Py<PyDict>) -> PyResult<Self> {
        from_dict_pyo3(py, values)
    }
}
