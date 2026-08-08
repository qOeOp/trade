use std::collections::BTreeMap;

use pyo3::prelude::*;

use super::transform_returns;
use crate::{statistic::PortfolioStatistic, statistics::treynor_ratio::TreynorRatio};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl TreynorRatio {
    /// Calculates the Treynor ratio of portfolio returns relative to a benchmark.
    ///
    /// The Treynor ratio measures excess return per unit of systematic risk (beta):
    ///
    /// `Treynor = (annualized_return - rf_annual) / beta`
    ///
    /// The portfolio's annualized return is computed geometrically (CAGR-style) from the
    /// aligned returns: `annualized_return = (prod(1 + r_i))^(period / n) - 1`. The
    /// per-period risk-free rate is annualized geometrically as
    /// `rf_annual = (1 + rf)^period - 1`. Beta is the sample (`ddof = 1`) beta of the
    /// portfolio against the benchmark. The period defaults to 252 trading days and `rf`
    /// defaults to 0.0.
    ///
    /// # References
    ///
    /// - Treynor, J. L. (1965). "How to Rate Management of Investment Funds".
    ///   *Harvard Business Review*, 43(1), 63-75.
    /// - CFA Institute Investment Foundations, 3rd Edition
    #[new]
    #[pyo3(signature = (period=None, risk_free_rate=None))]
    fn py_new(period: Option<usize>, risk_free_rate: Option<f64>) -> Self {
        Self::new(period, risk_free_rate)
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
    fn py_calculate_from_returns(&self, _returns: BTreeMap<u64, f64>) -> Option<f64> {
        None
    }

    #[pyo3(name = "calculate_from_realized_pnls")]
    fn py_calculate_from_realized_pnls(&self, _realized_pnls: Vec<f64>) -> Option<f64> {
        None
    }

    #[pyo3(name = "calculate_from_positions")]
    fn py_calculate_from_positions(&self, _positions: Vec<Py<PyAny>>) -> Option<f64> {
        None
    }

    #[pyo3(name = "calculate_from_returns_with_benchmark")]
    #[expect(clippy::needless_pass_by_value)]
    fn py_calculate_from_returns_with_benchmark(
        &self,
        returns: BTreeMap<u64, f64>,
        benchmark: BTreeMap<u64, f64>,
    ) -> Option<f64> {
        self.calculate_from_returns_with_benchmark(
            &transform_returns(&returns),
            &transform_returns(&benchmark),
        )
    }
}
