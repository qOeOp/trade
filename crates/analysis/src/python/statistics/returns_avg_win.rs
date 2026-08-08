use std::collections::BTreeMap;

use pyo3::prelude::*;

use super::transform_returns;
use crate::{statistic::PortfolioStatistic, statistics::returns_avg_win::ReturnsAverageWin};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl ReturnsAverageWin {
    /// Calculates the arithmetic mean of the positive portfolio returns.
    ///
    /// Zero returns are excluded (neither wins nor losses). Returns `NaN` for an
    /// empty series or when there are no positive returns.
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

    #[pyo3(name = "calculate_from_returns")]
    #[expect(clippy::needless_pass_by_value)]
    fn py_calculate_from_returns(&mut self, raw_returns: BTreeMap<u64, f64>) -> Option<f64> {
        self.calculate_from_returns(&transform_returns(&raw_returns))
    }

    #[pyo3(name = "calculate_from_realized_pnls")]
    fn py_calculate_from_realized_pnls(&mut self, _realized_pnls: Vec<f64>) -> Option<f64> {
        None
    }

    #[pyo3(name = "calculate_from_positions")]
    fn py_calculate_from_positions(&mut self, _positions: Vec<Py<PyAny>>) -> Option<f64> {
        None
    }
}
