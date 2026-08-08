use pyo3::prelude::*;
use vibe_core::python::to_pyvalue_err;
use vibe_model::data::{Bar, QuoteTick, TradeTick};

use crate::{
    average::MovingAverageType, indicator::Indicator, momentum::cmo::ChandeMomentumOscillator,
};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl ChandeMomentumOscillator {
    /// Creates a new `ChandeMomentumOscillator` instance.
    #[new]
    #[pyo3(signature = (period, ma_type=None))]
    #[must_use]
    pub fn py_new(period: usize, ma_type: Option<MovingAverageType>) -> Self {
        Self::new(period, ma_type)
    }

    #[getter]
    #[pyo3(name = "name")]
    fn py_name(&self) -> String {
        self.name()
    }

    #[getter]
    #[pyo3(name = "period")]
    const fn py_period(&self) -> usize {
        self.period
    }

    #[getter]
    #[pyo3(name = "has_inputs")]
    fn py_has_inputs(&self) -> bool {
        self.has_inputs()
    }

    #[getter]
    #[pyo3(name = "count")]
    const fn py_count(&self) -> usize {
        self.count
    }

    #[getter]
    #[pyo3(name = "value")]
    const fn py_value(&self) -> f64 {
        self.value
    }

    #[getter]
    #[pyo3(name = "initialized")]
    const fn py_initialized(&self) -> bool {
        self.initialized
    }

    #[pyo3(name = "update_raw")]
    fn py_update_raw(&mut self, close: f64) {
        self.update_raw(close);
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
    fn py_reset(&mut self) {
        self.reset();
    }

    fn __repr__(&self) -> String {
        format!("ChandeMomentumOscillator({})", self.period)
    }
}
