//! Arrow helpers for Python-defined Hyperliquid custom data streams.

use pyo3::{prelude::*, types::PyBytes};
use vibe_core::python::to_pyvalue_err;
use vibe_serialization::{
    arrow::EncodeToRecordBatch, python::arrow::arrow_record_batch_to_pybytes,
};

use crate::data_types::HyperliquidPublicTrade;

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl HyperliquidPublicTrade {
    /// Encodes public Hyperliquid trades into Arrow IPC bytes for streaming persistence.
    ///
    /// # Errors
    ///
    /// Returns an error if no data is provided or Arrow encoding fails.
    #[staticmethod]
    #[expect(clippy::needless_pass_by_value)]
    fn to_arrow_record_batch_bytes(py: Python<'_>, data: Vec<Self>) -> PyResult<Py<PyBytes>> {
        let first = data
            .first()
            .ok_or_else(|| to_pyvalue_err("Cannot encode an empty HyperliquidPublicTrade batch"))?;
        let metadata = Self::metadata(first);
        let batch = Self::encode_batch(&metadata, &data).map_err(to_pyvalue_err)?;
        arrow_record_batch_to_pybytes(py, &batch)
    }
}
