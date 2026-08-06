//! Python bindings from `pyo3`.

#![expect(
    clippy::missing_errors_doc,
    reason = "errors documented on underlying Rust methods"
)]

pub mod config;
pub mod enums;
pub mod factories;
pub mod http;
pub mod models;
pub mod urls;
pub mod websocket;

use std::str::FromStr;

use pyo3::{prelude::*, types::PyDict};
use vibe_common::factories::{ClientConfig, DataClientFactory, ExecutionClientFactory};
use vibe_core::python::{to_pyruntime_err, to_pyvalue_err};
use vibe_system::get_global_pyo3_registry;

use crate::{
    common::{
        consts::{OKX, OKX_CLIENT_ID, OKX_VENUE},
        enums::OKXTriggerType,
    },
    config::{OKXDataClientConfig, OKXExecClientConfig},
    factories::{OKXDataClientFactory, OKXExecutionClientFactory},
};

pub(super) fn extract_optional_string(
    dict: &Bound<'_, PyDict>,
    key: &str,
) -> PyResult<Option<String>> {
    dict.get_item(key)?
        .map(|value| value.extract::<String>())
        .transpose()
}

pub(super) fn extract_optional_trigger_type(
    dict: &Bound<'_, PyDict>,
    key: &str,
) -> PyResult<Option<OKXTriggerType>> {
    extract_optional_string(dict, key)?
        .map(|value| {
            OKXTriggerType::from_str(&value).map_err(|e| {
                to_pyvalue_err(format!("Invalid OKX trigger type {value:?} for {key}: {e}"))
            })
        })
        .transpose()
}

#[expect(clippy::needless_pass_by_value)]
fn extract_okx_data_factory(
    py: Python<'_>,
    factory: Py<PyAny>,
) -> PyResult<Box<dyn DataClientFactory>> {
    match factory.extract::<OKXDataClientFactory>(py) {
        Ok(f) => Ok(Box::new(f)),
        Err(e) => Err(to_pyvalue_err(format!(
            "Failed to extract OKXDataClientFactory: {e}"
        ))),
    }
}

#[expect(clippy::needless_pass_by_value)]
fn extract_okx_exec_factory(
    py: Python<'_>,
    factory: Py<PyAny>,
) -> PyResult<Box<dyn ExecutionClientFactory>> {
    match factory.extract::<OKXExecutionClientFactory>(py) {
        Ok(f) => Ok(Box::new(f)),
        Err(e) => Err(to_pyvalue_err(format!(
            "Failed to extract OKXExecutionClientFactory: {e}"
        ))),
    }
}

#[expect(clippy::needless_pass_by_value)]
fn extract_okx_data_config(py: Python<'_>, config: Py<PyAny>) -> PyResult<Box<dyn ClientConfig>> {
    match config.extract::<OKXDataClientConfig>(py) {
        Ok(c) => Ok(Box::new(c)),
        Err(e) => Err(to_pyvalue_err(format!(
            "Failed to extract OKXDataClientConfig: {e}"
        ))),
    }
}

#[expect(clippy::needless_pass_by_value)]
fn extract_okx_exec_config(py: Python<'_>, config: Py<PyAny>) -> PyResult<Box<dyn ClientConfig>> {
    match config.extract::<OKXExecClientConfig>(py) {
        Ok(c) => Ok(Box::new(c)),
        Err(e) => Err(to_pyvalue_err(format!(
            "Failed to extract OKXExecClientConfig: {e}"
        ))),
    }
}

/// Exposed through `vibe_trader.adapters.okx`.
///
/// # Errors
///
/// Returns an error if any bindings fail to register with the Python module.
#[pymodule]
pub fn okx(_: Python<'_>, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add(stringify!(OKX), OKX)?;
    m.add(stringify!(OKX_CLIENT_ID), *OKX_CLIENT_ID)?;
    m.add(stringify!(OKX_VENUE), *OKX_VENUE)?;
    m.add_class::<super::websocket::OKXWebSocketClient>()?;
    m.add_class::<super::websocket::messages::OKXWebSocketError>()?;
    m.add_class::<super::http::OKXHttpClient>()?;
    m.add_class::<crate::http::models::OKXBalanceDetail>()?;
    m.add_class::<crate::common::enums::OKXInstrumentType>()?;
    m.add_class::<crate::common::enums::OKXContractType>()?;
    m.add_class::<crate::common::enums::OKXGreeksType>()?;
    m.add_class::<crate::common::enums::OKXMarginMode>()?;
    m.add_class::<crate::common::enums::OKXTradeMode>()?;
    m.add_class::<crate::common::enums::OKXOrderStatus>()?;
    m.add_class::<crate::common::enums::OKXAlgoOrderStatus>()?;
    m.add_class::<crate::common::enums::OKXPositionMode>()?;
    m.add_class::<crate::common::enums::OKXVipLevel>()?;
    m.add_class::<crate::common::enums::OKXEnvironment>()?;
    m.add_class::<crate::common::enums::OKXRegion>()?;
    m.add_class::<crate::common::urls::OKXEndpointType>()?;
    m.add_class::<OKXDataClientConfig>()?;
    m.add_class::<OKXExecClientConfig>()?;
    m.add_class::<OKXDataClientFactory>()?;
    m.add_class::<OKXExecutionClientFactory>()?;
    m.add_function(wrap_pyfunction!(urls::get_okx_http_base_url, m)?)?;
    m.add_function(wrap_pyfunction!(urls::get_okx_ws_url_public, m)?)?;
    m.add_function(wrap_pyfunction!(urls::get_okx_ws_url_private, m)?)?;
    m.add_function(wrap_pyfunction!(urls::get_okx_ws_url_business, m)?)?;
    m.add_function(wrap_pyfunction!(urls::derive_okx_ws_url, m)?)?;
    m.add_function(wrap_pyfunction!(urls::okx_requires_authentication, m)?)?;

    let registry = get_global_pyo3_registry();

    if let Err(e) = registry.register_factory_extractor(OKX.to_string(), extract_okx_data_factory) {
        return Err(to_pyruntime_err(format!(
            "Failed to register OKX data factory extractor: {e}"
        )));
    }

    if let Err(e) =
        registry.register_exec_factory_extractor(OKX.to_string(), extract_okx_exec_factory)
    {
        return Err(to_pyruntime_err(format!(
            "Failed to register OKX exec factory extractor: {e}"
        )));
    }

    if let Err(e) = registry
        .register_config_extractor("OKXDataClientConfig".to_string(), extract_okx_data_config)
    {
        return Err(to_pyruntime_err(format!(
            "Failed to register OKX data config extractor: {e}"
        )));
    }

    if let Err(e) = registry
        .register_config_extractor("OKXExecClientConfig".to_string(), extract_okx_exec_config)
    {
        return Err(to_pyruntime_err(format!(
            "Failed to register OKX exec config extractor: {e}"
        )));
    }

    Ok(())
}
