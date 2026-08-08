use pyo3::prelude::*;
use vibe_core::python::to_pyvalue_err;
use vibe_model::{
    data::{Bar, QuoteTick, TradeTick},
    enums::PriceType,
};

use crate::{
    average::ama::AdaptiveMovingAverage,
    indicator::{Indicator, MovingAverage},
};

#[pyo3_stub_gen::derive::gen_stub_pymethods]
#[pymethods]
impl AdaptiveMovingAverage {
    /// An indicator which calculates an adaptive moving average (AMA) across a
    /// rolling window. Developed by Perry Kaufman, the AMA is a moving average
    /// designed to account for market noise and volatility. The AMA will closely
    /// follow prices when the price swings are relatively small and the noise is
    /// low. The AMA will increase lag when the price swings increase.
    #[new]
    #[pyo3(signature = (period_efficiency_ratio, period_fast, period_slow, price_type=None))]
    #[must_use]
    pub fn py_new(
        period_efficiency_ratio: usize,
        period_fast: usize,
        period_slow: usize,
        price_type: Option<PriceType>,
    ) -> Self {
        Self::new(
            period_efficiency_ratio,
            period_fast,
            period_slow,
            price_type,
        )
    }

    fn __repr__(&self) -> String {
        format!(
            "WeightedMovingAverage({}({},{},{})",
            self.name(),
            self.period_efficiency_ratio,
            self.period_fast,
            self.period_slow
        )
    }

    #[getter]
    #[pyo3(name = "name")]
    fn py_name(&self) -> String {
        self.name()
    }

    #[getter]
    #[pyo3(name = "period_efficiency_ratio")]
    const fn py_period_efficiency_ratio(&self) -> usize {
        self.period_efficiency_ratio
    }

    #[getter]
    #[pyo3(name = "period_fast")]
    const fn py_period_fast(&self) -> usize {
        self.period_fast
    }

    #[getter]
    #[pyo3(name = "period_slow")]
    const fn py_period_slow(&self) -> usize {
        self.period_slow
    }

    #[getter]
    #[pyo3(name = "alpha_fast")]
    const fn py_alpha_fast(&self) -> f64 {
        self.alpha_fast()
    }

    #[getter]
    #[pyo3(name = "alpha_slow")]
    const fn py_alpha_slow(&self) -> f64 {
        self.alpha_slow()
    }

    #[getter]
    #[pyo3(name = "alpha_diff")]
    fn py_alpha_diff(&self) -> f64 {
        self.alpha_diff()
    }

    #[getter]
    #[pyo3(name = "price_type")]
    const fn py_price_type(&self) -> PriceType {
        self.price_type
    }

    #[getter]
    #[pyo3(name = "value")]
    const fn py_value(&self) -> f64 {
        self.value
    }

    #[getter]
    #[pyo3(name = "count")]
    const fn py_count(&self) -> usize {
        self.count
    }

    #[getter]
    #[pyo3(name = "has_inputs")]
    fn py_has_inputs(&self) -> bool {
        self.has_inputs()
    }

    #[getter]
    #[pyo3(name = "initialized")]
    const fn py_initialized(&self) -> bool {
        self.initialized
    }

    #[pyo3(name = "handle_quote_tick")]
    fn py_handle_quote_tick(&mut self, quote: &QuoteTick) -> PyResult<()> {
        self.handle_quote(quote).map_err(to_pyvalue_err)
    }

    #[pyo3(name = "handle_trade_tick")]
    fn py_handle_trade_tick(&mut self, trade: &TradeTick) {
        self.handle_trade(trade);
    }

    #[pyo3(name = "handle_bar")]
    fn py_handle_bar(&mut self, bar: &Bar) {
        self.handle_bar(bar);
    }

    #[pyo3(name = "reset")]
    const fn py_reset(&mut self) {
        self.reset();
    }

    #[pyo3(name = "update_raw")]
    fn py_update_raw(&mut self, value: f64) {
        self.update_raw(value);
    }
}
