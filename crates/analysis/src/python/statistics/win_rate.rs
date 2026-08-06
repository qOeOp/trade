use std::collections::BTreeMap;

use pyo3::prelude::*;
#[allow(unused_imports)] // Used in template pattern for returns conversion
use vibe_core::UnixNanos;

use crate::{statistic::PortfolioStatistic, statistics::win_rate::WinRate};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl WinRate {
    /// Calculates the win rate of a trading strategy based on realized PnLs.
    ///
    /// Win rate is the percentage of profitable trades out of total trades:
    /// `Count(Trades with PnL > 0) / Total Trades`
    ///
    /// Returns a value between 0.0 and 1.0, where 1.0 represents 100% winning trades.
    ///
    /// Note: While a high win rate is desirable, it should be considered alongside
    /// average win/loss sizes and profit factor for complete system evaluation.
    ///
    /// # References
    ///
    /// - Standard trading performance metric across the industry
    /// - Tharp, V. K. (1998). *Trade Your Way to Financial Freedom*. McGraw-Hill.
    /// - Kaufman, P. J. (2013). *Trading Systems and Methods* (5th ed.). Wiley.
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
    fn py_calculate_from_returns(&mut self, _returns: BTreeMap<u64, f64>) -> Option<f64> {
        None
    }

    #[pyo3(name = "calculate_from_positions")]
    fn py_calculate_from_positions(&mut self, _positions: Vec<Py<PyAny>>) -> Option<f64> {
        None
    }
}
