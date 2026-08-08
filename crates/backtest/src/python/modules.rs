//! Python bindings for simulation module types.

use pyo3::prelude::*;
use vibe_core::python::to_pyvalue_err;

use crate::modules::fx_rollover::{FXRolloverInterestModule, InterestRateRecord};

#[pyo3_stub_gen::derive::gen_stub_pymethods]
#[pymethods]
impl InterestRateRecord {
    /// A single interest rate data entry.
    #[new]
    fn py_new(location: String, time: String, value: f64) -> PyResult<Self> {
        let record = Self {
            location,
            time,
            value,
        };
        record.validate().map_err(to_pyvalue_err)?;
        Ok(record)
    }

    fn __repr__(&self) -> String {
        format!("{self:?}")
    }
}

#[pyo3_stub_gen::derive::gen_stub_pymethods]
#[pymethods]
impl FXRolloverInterestModule {
    /// Simulates FX rollover (swap) interest applied at 5 PM US/Eastern daily.
    ///
    /// When holding FX positions overnight, the interest rate differential
    /// between the two currencies is credited or debited. Wednesday and Friday
    /// rollovers are tripled (Wednesday for T+2 settlement, Friday for the weekend).
    #[new]
    fn py_new(records: Vec<InterestRateRecord>) -> PyResult<Self> {
        Self::new(records).map_err(to_pyvalue_err)
    }

    fn __repr__(&self) -> String {
        format!("{self:?}")
    }
}
