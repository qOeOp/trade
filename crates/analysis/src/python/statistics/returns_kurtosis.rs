use std::collections::BTreeMap;

use pyo3::prelude::*;

use super::transform_returns;
use crate::{statistic::PortfolioStatistic, statistics::returns_kurtosis::ReturnsKurtosis};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl ReturnsKurtosis {
    /// Calculates the excess kurtosis of portfolio returns.
    ///
    /// Kurtosis measures the heaviness of the tails of the return distribution
    /// relative to a normal distribution. A positive value indicates fatter tails
    /// (more outliers); a negative value indicates thinner tails.
    ///
    /// Uses the bias-corrected sample excess kurtosis (adjusted Fisher-Pearson),
    /// matching `pandas.Series.kurt` and Excel `KURT`. A normal distribution yields 0:
    ///
    /// `G2 = n(n + 1) / ((n - 1)(n - 2)(n - 3)) * sum(((x - mean) / s)^4)
    ///       - 3(n - 1)^2 / ((n - 2)(n - 3))`
    ///
    /// where `s` is the sample standard deviation (Bessel's correction, ddof=1).
    /// Returns `NaN` for fewer than four returns or zero dispersion.
    ///
    /// # References
    ///
    /// - Joanes, D. N., & Gill, C. A. (1998). Comparing measures of sample skewness
    ///   and kurtosis. *Journal of the Royal Statistical Society: Series D*, 47(1), 183-189.
    #[new]
    fn py_new() -> Self {
        Self::new()
    }

    fn __repr__(&self) -> String {
        self.name()
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
