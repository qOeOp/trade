//! Python wrapper functions for dYdX URL helpers.

use pyo3::prelude::*;

use crate::common::{enums::DydxNetwork, urls};

#[pyfunction]
#[pyo3_stub_gen::derive::gen_stub_pyfunction(module = "vibe_trader.adapters.dydx")]
#[pyo3(name = "get_dydx_grpc_urls")]
#[must_use]
pub fn py_get_dydx_grpc_urls(network: DydxNetwork) -> Vec<String> {
    urls::grpc_urls(network)
        .iter()
        .map(|s| (*s).to_string())
        .collect()
}

#[pyfunction]
#[pyo3_stub_gen::derive::gen_stub_pyfunction(module = "vibe_trader.adapters.dydx")]
#[pyo3(name = "get_dydx_grpc_url")]
#[must_use]
pub fn py_get_dydx_grpc_url(network: DydxNetwork) -> String {
    urls::grpc_url(network).to_string()
}

#[pyfunction]
#[pyo3_stub_gen::derive::gen_stub_pyfunction(module = "vibe_trader.adapters.dydx")]
#[pyo3(name = "get_dydx_http_url")]
#[must_use]
pub fn py_get_dydx_http_url(network: DydxNetwork) -> String {
    urls::http_base_url(network).to_string()
}

#[pyfunction]
#[pyo3_stub_gen::derive::gen_stub_pyfunction(module = "vibe_trader.adapters.dydx")]
#[pyo3(name = "get_dydx_ws_url")]
#[must_use]
pub fn py_get_dydx_ws_url(network: DydxNetwork) -> String {
    urls::ws_url(network).to_string()
}
