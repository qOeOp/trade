//! Python wrapper functions for OKX URL helpers.

use pyo3::prelude::*;

use crate::common::{
    enums::{OKXEnvironment, OKXRegion},
    urls,
};

/// Returns the OKX HTTP base URL for the given region.
#[pyfunction]
#[pyo3(signature = (region = None))]
#[pyo3_stub_gen::derive::gen_stub_pyfunction(module = "vibe_trader.adapters.okx")]
pub fn get_okx_http_base_url(region: Option<OKXRegion>) -> String {
    urls::get_http_base_url(region.unwrap_or_default()).to_string()
}

/// Returns the OKX WebSocket URL for public data (market data).
#[pyfunction]
#[pyo3(signature = (environment, region = None))]
#[pyo3_stub_gen::derive::gen_stub_pyfunction(module = "vibe_trader.adapters.okx")]
pub fn get_okx_ws_url_public(environment: OKXEnvironment, region: Option<OKXRegion>) -> String {
    urls::get_ws_base_url_public(region.unwrap_or_default(), environment).to_string()
}

/// Returns the OKX WebSocket URL for private data (account/order management).
#[pyfunction]
#[pyo3(signature = (environment, region = None))]
#[pyo3_stub_gen::derive::gen_stub_pyfunction(module = "vibe_trader.adapters.okx")]
pub fn get_okx_ws_url_private(environment: OKXEnvironment, region: Option<OKXRegion>) -> String {
    urls::get_ws_base_url_private(region.unwrap_or_default(), environment).to_string()
}

/// Returns the OKX WebSocket URL for business data (bars/candlesticks).
#[pyfunction]
#[pyo3(signature = (environment, region = None))]
#[pyo3_stub_gen::derive::gen_stub_pyfunction(module = "vibe_trader.adapters.okx")]
pub fn get_okx_ws_url_business(environment: OKXEnvironment, region: Option<OKXRegion>) -> String {
    urls::get_ws_base_url_business(region.unwrap_or_default(), environment).to_string()
}

/// Derives a WebSocket URL for a given channel from a base URL.
#[pyfunction]
#[pyo3_stub_gen::derive::gen_stub_pyfunction(module = "vibe_trader.adapters.okx")]
pub fn derive_okx_ws_url(base_url: &str, channel: &str) -> String {
    urls::derive_ws_url(base_url, channel)
}

/// Checks if OKX endpoint requires authentication.
#[pyfunction]
#[pyo3_stub_gen::derive::gen_stub_pyfunction(module = "vibe_trader.adapters.okx")]
pub fn okx_requires_authentication(endpoint_type: urls::OKXEndpointType) -> bool {
    urls::requires_authentication(endpoint_type)
}
