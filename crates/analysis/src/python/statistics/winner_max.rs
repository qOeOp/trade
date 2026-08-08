use std::collections::BTreeMap;

use pyo3::prelude::*;
#[allow(unused_imports)] // Used in template pattern for returns conversion
use vibe_core::UnixNanos;

use crate::{statistic::PortfolioStatistic, statistics::winner_max::MaxWinner};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl MaxWinner {
    /// Calculates the largest winning trade from realized PnLs.
    ///
    /// Only positive PnLs count as winners. Returns `NaN` for an empty series or
    /// when there are no winning trades.
    #[new]
    fn py_new() -> Self {
        Self {}
    }

    fn __repr__(&self) -> String {
        self.to_string()
    }

    #[getter]
    #[pyo3(name = "name")]
    fn py_name(&self) -> String {
        self.name()
    }

    #[pyo3(name = "calculate_from_realized_pnls")]
    #[expect(clippy::needless_pass_by_value)]
    fn py_calculate_from_realized_pnls(&mut self, realized_pnls: Vec<f64>) -> Option<f64> {
        self.calculate_from_realized_pnls(&realized_pnls)
    }

    #[pyo3(name = "calculate_from_returns")]
    #[allow(unused_variables)] // Pattern preserved for consistency across statistics
    #[expect(clippy::needless_pass_by_value)]
    fn py_calculate_from_returns(&mut self, returns: BTreeMap<u64, f64>) -> Option<f64> {
        None
    }

    #[pyo3(name = "calculate_from_positions")]
    fn py_calculate_from_positions(&mut self, _positions: Vec<Py<PyAny>>) -> Option<f64> {
        None
    }
}
