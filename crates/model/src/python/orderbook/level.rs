use pyo3::prelude::*;

use crate::{
    data::order::BookOrder,
    orderbook::BookLevel,
    types::{price::Price, quantity::QuantityRaw},
};

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl BookLevel {
    fn __repr__(&self) -> String {
        format!("{self:?}")
    }

    fn __str__(&self) -> String {
        // TODO: Return debug string for now
        format!("{self:?}")
    }

    #[getter]
    #[pyo3(name = "price")]
    fn py_price(&self) -> Price {
        self.price.value
    }

    /// Returns the number of orders at this price level.
    #[pyo3(name = "len")]
    fn py_len(&self) -> usize {
        self.len()
    }

    /// Returns true if this price level has no orders.
    #[pyo3(name = "is_empty")]
    fn py_is_empty(&self) -> bool {
        self.is_empty()
    }

    /// Returns the total size of all orders at this price level as a float.
    #[pyo3(name = "size")]
    fn py_size(&self) -> f64 {
        self.size()
    }

    /// Returns the total size of all orders at this price level as raw integer units.
    #[pyo3(name = "size_raw")]
    fn py_size_raw(&self) -> QuantityRaw {
        self.size_raw()
    }

    /// Returns the total exposure (price * size) of all orders at this price level as a float.
    #[pyo3(name = "exposure")]
    fn py_exposure(&self) -> f64 {
        self.exposure()
    }

    /// Returns the total exposure (price * size) of all orders at this price level as raw integer units.
    ///
    /// Fixed-scale orders contribute `price.raw * size.raw / FIXED_SCALAR`.
    /// Native DeFi scales are normalized to the same fixed-scale result.
    /// Division truncates toward zero.
    /// Non-positive prices contribute zero.
    /// Saturates at `QuantityRaw::MAX` if the total exposure would overflow.
    #[pyo3(name = "exposure_raw")]
    fn py_exposure_raw(&self) -> QuantityRaw {
        self.exposure_raw()
    }

    #[pyo3(name = "first")]
    fn py_fist(&self) -> Option<BookOrder> {
        self.first().copied()
    }

    /// Returns all orders at this price level in FIFO insertion order.
    #[pyo3(name = "get_orders")]
    fn py_get_orders(&self) -> Vec<BookOrder> {
        self.get_orders()
    }
}
