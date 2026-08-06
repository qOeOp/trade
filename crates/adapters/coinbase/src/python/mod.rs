//! Python bindings from `pyo3`.

pub mod config;
pub mod enums;
pub mod factories;

use pyo3::prelude::*;
use vibe_common::factories::{ClientConfig, DataClientFactory, ExecutionClientFactory};
use vibe_core::python::{to_pyruntime_err, to_pyvalue_err};
use vibe_system::get_global_pyo3_registry;

use crate::{
    common::consts::{COINBASE, COINBASE_CLIENT_ID, COINBASE_VENUE},
    config::{CoinbaseDataClientConfig, CoinbaseExecClientConfig},
    factories::{CoinbaseDataClientFactory, CoinbaseExecutionClientFactory},
};

#[expect(clippy::needless_pass_by_value)]
fn extract_coinbase_data_factory(
    py: Python<'_>,
    factory: Py<PyAny>,
) -> PyResult<Box<dyn DataClientFactory>> {
    match factory.extract::<CoinbaseDataClientFactory>(py) {
        Ok(f) => Ok(Box::new(f)),
        Err(e) => Err(to_pyvalue_err(format!(
            "Failed to extract CoinbaseDataClientFactory: {e}"
        ))),
    }
}

#[expect(clippy::needless_pass_by_value)]
fn extract_coinbase_exec_factory(
    py: Python<'_>,
    factory: Py<PyAny>,
) -> PyResult<Box<dyn ExecutionClientFactory>> {
    match factory.extract::<CoinbaseExecutionClientFactory>(py) {
        Ok(f) => Ok(Box::new(f)),
        Err(e) => Err(to_pyvalue_err(format!(
            "Failed to extract CoinbaseExecutionClientFactory: {e}"
        ))),
    }
}

#[expect(clippy::needless_pass_by_value)]
fn extract_coinbase_data_config(
    py: Python<'_>,
    config: Py<PyAny>,
) -> PyResult<Box<dyn ClientConfig>> {
    match config.extract::<CoinbaseDataClientConfig>(py) {
        Ok(c) => Ok(Box::new(c)),
        Err(e) => Err(to_pyvalue_err(format!(
            "Failed to extract CoinbaseDataClientConfig: {e}"
        ))),
    }
}

#[expect(clippy::needless_pass_by_value)]
fn extract_coinbase_exec_config(
    py: Python<'_>,
    config: Py<PyAny>,
) -> PyResult<Box<dyn ClientConfig>> {
    match config.extract::<CoinbaseExecClientConfig>(py) {
        Ok(c) => Ok(Box::new(c)),
        Err(e) => Err(to_pyvalue_err(format!(
            "Failed to extract CoinbaseExecClientConfig: {e}"
        ))),
    }
}

/// Exposed through `vibe_trader.adapters.coinbase`.
///
/// # Errors
///
/// Returns an error if any bindings fail to register with the Python module.
#[pymodule]
pub fn coinbase(_: Python<'_>, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add(stringify!(COINBASE), COINBASE)?;
    m.add(stringify!(COINBASE_CLIENT_ID), *COINBASE_CLIENT_ID)?;
    m.add(stringify!(COINBASE_VENUE), *COINBASE_VENUE)?;
    m.add_class::<crate::common::enums::CoinbaseEnvironment>()?;
    m.add_class::<crate::common::enums::CoinbaseMarginType>()?;
    m.add_class::<CoinbaseDataClientConfig>()?;
    m.add_class::<CoinbaseExecClientConfig>()?;
    m.add_class::<CoinbaseDataClientFactory>()?;
    m.add_class::<CoinbaseExecutionClientFactory>()?;

    let registry = get_global_pyo3_registry();

    if let Err(e) =
        registry.register_factory_extractor(COINBASE.to_string(), extract_coinbase_data_factory)
    {
        return Err(to_pyruntime_err(format!(
            "Failed to register Coinbase data factory extractor: {e}"
        )));
    }

    if let Err(e) = registry
        .register_exec_factory_extractor(COINBASE.to_string(), extract_coinbase_exec_factory)
    {
        return Err(to_pyruntime_err(format!(
            "Failed to register Coinbase exec factory extractor: {e}"
        )));
    }

    if let Err(e) = registry.register_config_extractor(
        "CoinbaseDataClientConfig".to_string(),
        extract_coinbase_data_config,
    ) {
        return Err(to_pyruntime_err(format!(
            "Failed to register Coinbase data config extractor: {e}"
        )));
    }

    if let Err(e) = registry.register_config_extractor(
        "CoinbaseExecClientConfig".to_string(),
        extract_coinbase_exec_config,
    ) {
        return Err(to_pyruntime_err(format!(
            "Failed to register Coinbase exec config extractor: {e}"
        )));
    }

    Ok(())
}
