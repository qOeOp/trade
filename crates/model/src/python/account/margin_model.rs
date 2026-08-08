//! Python bindings for margin model types.

use pyo3::prelude::*;

use crate::accounts::margin_model::{LeveragedMarginModel, StandardMarginModel};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl StandardMarginModel {
    /// Uses fixed margin percentages without leverage division.
    ///
    /// Margin is calculated as `notional_value * margin_rate`, ignoring the
    /// account leverage. Appropriate for traditional brokers where margin
    /// requirements are fixed percentages of notional value.
    #[new]
    fn py_new() -> Self {
        Self
    }

    fn __repr__(&self) -> String {
        format!("{self:?}")
    }
}

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl LeveragedMarginModel {
    /// Divides notional value by leverage before applying margin rates.
    ///
    /// Margin is calculated as `(notional_value / leverage) * margin_rate`.
    /// This is the default model, appropriate for crypto exchanges and venues
    /// where leverage directly reduces margin requirements.
    #[new]
    fn py_new() -> Self {
        Self
    }

    fn __repr__(&self) -> String {
        format!("{self:?}")
    }
}
