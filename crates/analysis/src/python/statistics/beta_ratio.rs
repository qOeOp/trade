use std::collections::BTreeMap;

use pyo3::prelude::*;

use super::transform_returns;
use crate::{statistic::PortfolioStatistic, statistics::beta_ratio::BetaRatio};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl BetaRatio {
    /// Calculates the beta of portfolio returns relative to a benchmark.
    ///
    /// Beta measures the systematic risk (market sensitivity) of a portfolio and is
    /// calculated as the covariance of the portfolio and benchmark returns divided by
    /// the variance of the benchmark returns:
    ///
    /// `Beta = Cov(portfolio, benchmark) / Var(benchmark)`
    ///
    /// Sample (Bessel-corrected, `ddof = 1`) covariance and variance are used to match
    /// the standard deviation convention elsewhere in this crate. Beta is not annualized.
    ///
    /// # References
    ///
    /// - Sharpe, W. F. (1964). "Capital Asset Prices: A Theory of Market Equilibrium under
    ///   Conditions of Risk". *Journal of Finance*, 19(3), 425-442.
    /// - CFA Institute Investment Foundations, 3rd Edition
    #[new]
    fn py_new() -> Self {
        Self::new()
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
