use std::collections::BTreeMap;

use pyo3::prelude::*;
#[allow(unused_imports)] // Used in template pattern for returns conversion
use vibe_core::UnixNanos;
use vibe_model::enums::OrderSide;

use crate::{statistic::PortfolioStatistic, statistics::long_ratio::LongRatio};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl LongRatio {
    /// Calculates the ratio of long positions to total positions.
    ///
    /// A position counts as long when its entry (opening order) side is `Buy`.
    /// The result is in `[0, 1]`, rounded to `precision` decimal places, and is
    /// `None` for an empty position list.
    #[new]
    #[pyo3(signature = (precision=None))]
    fn py_new(precision: Option<usize>) -> Self {
        Self::new(precision)
    }

    fn __repr__(&self) -> String {
        self.to_string()
    }

    #[getter]
    #[pyo3(name = "name")]
    fn py_name(&self) -> String {
        self.name()
    }

    #[pyo3(name = "calculate_from_positions")]
    #[expect(clippy::needless_pass_by_value)]
    fn py_calculate_from_positions(
        &mut self,
        py: Python,
        positions: Vec<Py<PyAny>>,
    ) -> PyResult<Option<f64>> {
        if positions.is_empty() {
            return Ok(None);
        }

        // Extract entry side from each Cython Position object
        // OrderSide.Buy has value 1 in both Cython and Rust
        let mut longs = 0;

        for position in &positions {
            let entry = position.getattr(py, "entry")?;
            let entry_value: u8 = entry.extract(py)?;
            if entry_value == OrderSide::Buy as u8 {
                longs += 1;
            }
        }

        let value = f64::from(longs) / positions.len() as f64;
        let scale = 10f64.powi(self.precision as i32);
        Ok(Some((value * scale).round() / scale))
    }

    #[pyo3(name = "calculate_from_realized_pnls")]
    fn py_calculate_from_realized_pnls(&mut self, _realized_pnls: Vec<f64>) -> Option<f64> {
        None
    }

    #[pyo3(name = "calculate_from_returns")]
    #[allow(unused_variables)] // Pattern preserved for consistency across statistics
    fn py_calculate_from_returns(&mut self, _returns: BTreeMap<u64, f64>) -> Option<f64> {
        None
    }
}
