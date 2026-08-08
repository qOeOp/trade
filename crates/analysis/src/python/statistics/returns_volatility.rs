use std::collections::BTreeMap;

use pyo3::prelude::*;

use super::transform_returns;
use crate::{statistic::PortfolioStatistic, statistics::returns_volatility::ReturnsVolatility};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl ReturnsVolatility {
    /// Calculates the annualized volatility (standard deviation) of portfolio returns.
    ///
    /// Volatility is calculated as the standard deviation of returns, annualized by
    /// multiplying the daily standard deviation by the square root of the period:
    /// `Standard Deviation * sqrt(period)`
    ///
    /// Uses Bessel's correction (ddof=1) for sample standard deviation.
    /// This provides a measure of the portfolio's risk or uncertainty of returns.
    ///
    /// # References
    ///
    /// - CFA Institute Level I Curriculum: Quantitative Methods
    /// - Hull, J. C. (2018). *Options, Futures, and Other Derivatives* (10th ed.). Pearson.
    /// - Fabozzi, F. J., et al. (2002). *The Handbook of Financial Instruments*. Wiley.
    #[new]
    #[pyo3(signature = (period=None))]
    fn py_new(period: Option<usize>) -> Self {
        Self::new(period)
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
