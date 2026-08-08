//! Python bindings from `pyo3`.

#![expect(
    clippy::missing_errors_doc,
    reason = "errors documented on underlying Rust methods"
)]

pub mod config;
pub mod enums;
pub mod factories;
pub mod http;
pub mod urls;
pub mod websocket;

use pyo3::prelude::*;
use vibe_common::factories::{ClientConfig, DataClientFactory, ExecutionClientFactory};
use vibe_core::python::{to_pyruntime_err, to_pyvalue_err};
use vibe_model::data::ensure_rust_extractor_registered;
use vibe_system::get_global_pyo3_registry;

use crate::{
    common::consts::{DERIBIT, DERIBIT_CLIENT_ID, DERIBIT_VENUE},
    config::{DeribitDataClientConfig, DeribitExecClientConfig},
    data_types::{DeribitBookSummary, DeribitVolatilityIndex, register_deribit_custom_data},
    factories::{DeribitDataClientFactory, DeribitExecutionClientFactory},
};

#[expect(clippy::needless_pass_by_value)]
fn extract_deribit_data_factory(
    py: Python<'_>,
    factory: Py<PyAny>,
) -> PyResult<Box<dyn DataClientFactory>> {
    match factory.extract::<DeribitDataClientFactory>(py) {
        Ok(f) => Ok(Box::new(f)),
        Err(e) => Err(to_pyvalue_err(format!(
            "Failed to extract DeribitDataClientFactory: {e}"
        ))),
    }
}

#[expect(clippy::needless_pass_by_value)]
fn extract_deribit_exec_factory(
    py: Python<'_>,
    factory: Py<PyAny>,
) -> PyResult<Box<dyn ExecutionClientFactory>> {
    match factory.extract::<DeribitExecutionClientFactory>(py) {
        Ok(f) => Ok(Box::new(f)),
        Err(e) => Err(to_pyvalue_err(format!(
            "Failed to extract DeribitExecutionClientFactory: {e}"
        ))),
    }
}

#[expect(clippy::needless_pass_by_value)]
fn extract_deribit_data_config(
    py: Python<'_>,
    config: Py<PyAny>,
) -> PyResult<Box<dyn ClientConfig>> {
    match config.extract::<DeribitDataClientConfig>(py) {
        Ok(c) => Ok(Box::new(c)),
        Err(e) => Err(to_pyvalue_err(format!(
            "Failed to extract DeribitDataClientConfig: {e}"
        ))),
    }
}

#[expect(clippy::needless_pass_by_value)]
fn extract_deribit_exec_config(
    py: Python<'_>,
    config: Py<PyAny>,
) -> PyResult<Box<dyn ClientConfig>> {
    match config.extract::<DeribitExecClientConfig>(py) {
        Ok(c) => Ok(Box::new(c)),
        Err(e) => Err(to_pyvalue_err(format!(
            "Failed to extract DeribitExecClientConfig: {e}"
        ))),
    }
}

/// Exposed through `vibe_trader.adapters.deribit`.
///
/// # Errors
///
/// Returns an error if any bindings fail to register with the Python module.
#[pymodule]
pub fn deribit(_: Python<'_>, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add(stringify!(DERIBIT), DERIBIT)?;
    m.add(stringify!(DERIBIT_CLIENT_ID), *DERIBIT_CLIENT_ID)?;
    m.add(stringify!(DERIBIT_VENUE), *DERIBIT_VENUE)?;
    m.add_class::<super::http::client::DeribitHttpClient>()?;
    m.add_class::<super::websocket::client::DeribitWebSocketClient>()?;
    m.add_class::<crate::common::enums::DeribitCurrency>()?;
    m.add_class::<crate::common::enums::DeribitProductType>()?;
    m.add_class::<crate::common::enums::DeribitEnvironment>()?;
    m.add_class::<crate::websocket::enums::DeribitUpdateInterval>()?;
    m.add_class::<DeribitVolatilityIndex>()?;
    m.add_class::<DeribitBookSummary>()?;
    m.add_class::<DeribitDataClientConfig>()?;
    m.add_class::<DeribitExecClientConfig>()?;
    m.add_class::<DeribitDataClientFactory>()?;
    m.add_class::<DeribitExecutionClientFactory>()?;
    m.add_function(wrap_pyfunction!(urls::py_get_deribit_http_base_url, m)?)?;
    m.add_function(wrap_pyfunction!(urls::py_get_deribit_ws_url, m)?)?;

    let registry = get_global_pyo3_registry();

    if let Err(e) =
        registry.register_factory_extractor(DERIBIT.to_string(), extract_deribit_data_factory)
    {
        return Err(to_pyruntime_err(format!(
            "Failed to register Deribit data factory extractor: {e}"
        )));
    }

    if let Err(e) =
        registry.register_exec_factory_extractor(DERIBIT.to_string(), extract_deribit_exec_factory)
    {
        return Err(to_pyruntime_err(format!(
            "Failed to register Deribit exec factory extractor: {e}"
        )));
    }

    if let Err(e) = registry.register_config_extractor(
        "DeribitDataClientConfig".to_string(),
        extract_deribit_data_config,
    ) {
        return Err(to_pyruntime_err(format!(
            "Failed to register Deribit data config extractor: {e}"
        )));
    }

    if let Err(e) = registry.register_config_extractor(
        "DeribitExecClientConfig".to_string(),
        extract_deribit_exec_config,
    ) {
        return Err(to_pyruntime_err(format!(
            "Failed to register Deribit exec config extractor: {e}"
        )));
    }

    register_deribit_custom_data();
    let _result = ensure_rust_extractor_registered::<DeribitVolatilityIndex>();
    let _book_summary = ensure_rust_extractor_registered::<DeribitBookSummary>();

    Ok(())
}
