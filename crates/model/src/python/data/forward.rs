use pyo3::prelude::*;
use rust_decimal::Decimal;
use vibe_core::{UnixNanos, python::to_pyvalue_err};

use crate::{data::forward::ForwardPrice, identifiers::InstrumentId};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl ForwardPrice {
    /// Represents a forward/underlying price for a derivatives instrument.
    ///
    /// This is a general derivatives concept used for ATM determination in option chains
    /// and other forward-price dependent calculations.
    #[new]
    #[pyo3(signature = (instrument_id, forward_price, underlying_index=None, ts_event=0, ts_init=0))]
    fn py_new(
        instrument_id: InstrumentId,
        forward_price: &str,
        underlying_index: Option<String>,
        ts_event: u64,
        ts_init: u64,
    ) -> PyResult<Self> {
        let price = forward_price.parse::<Decimal>().map_err(to_pyvalue_err)?;
        Ok(Self {
            instrument_id,
            forward_price: price,
            underlying_index,
            ts_event: UnixNanos::from(ts_event),
            ts_init: UnixNanos::from(ts_init),
        })
    }

    #[getter]
    #[pyo3(name = "instrument_id")]
    fn py_instrument_id(&self) -> InstrumentId {
        self.instrument_id
    }

    #[getter]
    #[pyo3(name = "forward_price")]
    fn py_forward_price(&self) -> String {
        self.forward_price.to_string()
    }

    #[getter]
    #[pyo3(name = "underlying_index")]
    fn py_underlying_index(&self) -> Option<String> {
        self.underlying_index.clone()
    }

    #[getter]
    #[pyo3(name = "ts_event")]
    fn py_ts_event(&self) -> u64 {
        self.ts_event.as_u64()
    }

    #[getter]
    #[pyo3(name = "ts_init")]
    fn py_ts_init(&self) -> u64 {
        self.ts_init.as_u64()
    }

    fn __repr__(&self) -> String {
        format!(
            "ForwardPrice({}, price={}, index={:?})",
            self.instrument_id, self.forward_price, self.underlying_index
        )
    }

    fn __str__(&self) -> String {
        format!(
            "ForwardPrice({}, {})",
            self.instrument_id, self.forward_price
        )
    }
}
