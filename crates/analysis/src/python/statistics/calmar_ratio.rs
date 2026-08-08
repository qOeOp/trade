use std::collections::BTreeMap;

use pyo3::prelude::*;

use super::transform_returns;
use crate::{statistic::PortfolioStatistic, statistics::calmar_ratio::CalmarRatio};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl CalmarRatio {
    /// Calculates the Calmar Ratio for returns.
    ///
    /// The Calmar Ratio is a function of the fund's average compounded annual rate
    /// of return versus its maximum drawdown. The higher the Calmar ratio, the better
    /// it performed on a risk-adjusted basis during the given time frame.
    ///
    /// Formula: Calmar Ratio = CAGR / |Max Drawdown|
    ///
    /// # References
    ///
    /// - Young, T. W. (1991). "Calmar Ratio: A Smoother Tool". *Futures*, 20(1).
    /// - Bacon, C. R. (2008). *Practical Portfolio Performance Measurement and Attribution*
    ///   (2nd ed.). Wiley.
    #[new]
    #[pyo3(signature = (period=None))]
    fn py_new(period: Option<usize>) -> Self {
        Self::new(period)
    }

    #[getter]
    #[pyo3(name = "name")]
    fn py_name(&self) -> String {
        self.name()
    }

    #[pyo3(name = "calculate_from_returns")]
    #[expect(clippy::needless_pass_by_value)]
    fn py_calculate_from_returns(&self, raw_returns: BTreeMap<u64, f64>) -> Option<f64> {
        self.calculate_from_returns(&transform_returns(&raw_returns))
    }

    #[pyo3(name = "calculate_from_realized_pnls")]
    fn py_calculate_from_realized_pnls(&self, _realized_pnls: Vec<f64>) -> Option<f64> {
        None
    }

    #[pyo3(name = "calculate_from_positions")]
    fn py_calculate_from_positions(&self, _positions: Vec<Py<PyAny>>) -> Option<f64> {
        None
    }

    fn __repr__(&self) -> String {
        format!("CalmarRatio({})", self.name())
    }
}
