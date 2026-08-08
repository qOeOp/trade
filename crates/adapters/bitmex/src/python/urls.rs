//! Python wrapper functions for BitMEX URL helpers.

use pyo3::prelude::*;

use crate::common::{enums::BitmexEnvironment, urls};

/// Gets the BitMEX HTTP base URL.
#[pyfunction]
#[pyo3_stub_gen::derive::gen_stub_pyfunction(module = "vibe_trader.adapters.bitmex")]
pub fn get_bitmex_http_base_url(environment: BitmexEnvironment) -> String {
    urls::get_http_base_url(environment)
}

/// Gets the BitMEX WebSocket URL.
#[pyfunction]
#[pyo3_stub_gen::derive::gen_stub_pyfunction(module = "vibe_trader.adapters.bitmex")]
pub fn get_bitmex_ws_url(environment: BitmexEnvironment) -> String {
    urls::get_ws_url(environment)
}
