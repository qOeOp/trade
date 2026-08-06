//! Python bindings for Hyperliquid URL helper functions.

use pyo3::prelude::*;

use crate::common::{
    consts::{info_url, ws_url},
    enums::HyperliquidEnvironment,
};

/// Get the HTTP base URL for Hyperliquid API (info endpoint).
///
/// # Returns
///
/// The HTTP base URL string.
#[pyfunction]
#[pyo3_stub_gen::derive::gen_stub_pyfunction(module = "vibe_trader.adapters.hyperliquid")]
#[pyo3(name = "get_hyperliquid_http_base_url")]
pub fn py_get_hyperliquid_http_base_url(environment: HyperliquidEnvironment) -> String {
    info_url(environment).to_string()
}

/// Get the WebSocket URL for Hyperliquid API.
///
/// # Returns
///
/// The WebSocket URL string.
#[pyfunction]
#[pyo3_stub_gen::derive::gen_stub_pyfunction(module = "vibe_trader.adapters.hyperliquid")]
#[pyo3(name = "get_hyperliquid_ws_url")]
pub fn py_get_hyperliquid_ws_url(environment: HyperliquidEnvironment) -> String {
    ws_url(environment).to_string()
}
