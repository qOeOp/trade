//! Python URL helper functions for Deribit.

use pyo3::prelude::*;

use crate::common::{
    enums::DeribitEnvironment,
    urls::{get_http_base_url, get_ws_url},
};

#[pyfunction]
#[pyo3_stub_gen::derive::gen_stub_pyfunction(module = "vibe_trader.adapters.deribit")]
#[pyo3(name = "get_deribit_http_base_url")]
#[must_use]
pub fn py_get_deribit_http_base_url(environment: DeribitEnvironment) -> String {
    get_http_base_url(environment).to_string()
}

#[pyfunction]
#[pyo3_stub_gen::derive::gen_stub_pyfunction(module = "vibe_trader.adapters.deribit")]
#[pyo3(name = "get_deribit_ws_url")]
#[must_use]
pub fn py_get_deribit_ws_url(environment: DeribitEnvironment) -> String {
    get_ws_url(environment).to_string()
}
