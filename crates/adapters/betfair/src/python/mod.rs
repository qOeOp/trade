//! Python bindings for the Betfair adapter.

pub mod config;
pub mod factories;

use pyo3::prelude::*;
use vibe_common::factories::{ClientConfig, DataClientFactory, ExecutionClientFactory};
use vibe_core::python::{to_pyruntime_err, to_pyvalue_err};
use vibe_system::get_global_pyo3_registry;

use crate::{
    common::consts::{BETFAIR, BETFAIR_CLIENT_ID, BETFAIR_VENUE},
    config::{BetfairDataConfig, BetfairExecConfig},
    factories::{BetfairDataClientFactory, BetfairExecutionClientFactory},
};

#[expect(clippy::needless_pass_by_value)]
fn extract_betfair_data_factory(
    py: Python<'_>,
    factory: Py<PyAny>,
) -> PyResult<Box<dyn DataClientFactory>> {
    match factory.extract::<BetfairDataClientFactory>(py) {
        Ok(factory) => Ok(Box::new(factory)),
        Err(e) => Err(to_pyvalue_err(format!(
            "Failed to extract BetfairDataClientFactory: {e}"
        ))),
    }
}

#[expect(clippy::needless_pass_by_value)]
fn extract_betfair_exec_factory(
    py: Python<'_>,
    factory: Py<PyAny>,
) -> PyResult<Box<dyn ExecutionClientFactory>> {
    match factory.extract::<BetfairExecutionClientFactory>(py) {
        Ok(factory) => Ok(Box::new(factory)),
        Err(e) => Err(to_pyvalue_err(format!(
            "Failed to extract BetfairExecutionClientFactory: {e}"
        ))),
    }
}

#[expect(clippy::needless_pass_by_value)]
fn extract_betfair_data_config(
    py: Python<'_>,
    config: Py<PyAny>,
) -> PyResult<Box<dyn ClientConfig>> {
    match config.extract::<BetfairDataConfig>(py) {
        Ok(config) => Ok(Box::new(config)),
        Err(e) => Err(to_pyvalue_err(format!(
            "Failed to extract BetfairDataConfig: {e}"
        ))),
    }
}

#[expect(clippy::needless_pass_by_value)]
fn extract_betfair_exec_config(
    py: Python<'_>,
    config: Py<PyAny>,
) -> PyResult<Box<dyn ClientConfig>> {
    match config.extract::<BetfairExecConfig>(py) {
        Ok(config) => Ok(Box::new(config)),
        Err(e) => Err(to_pyvalue_err(format!(
            "Failed to extract BetfairExecConfig: {e}"
        ))),
    }
}

/// Betfair adapter Python module.
///
/// Exposed through `vibe_trader.adapters.betfair`.
///
/// # Errors
///
/// Returns an error if module initialization fails.
#[pymodule]
pub fn betfair(_py: Python<'_>, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add(stringify!(BETFAIR), BETFAIR)?;
    m.add(stringify!(BETFAIR_CLIENT_ID), *BETFAIR_CLIENT_ID)?;
    m.add(stringify!(BETFAIR_VENUE), *BETFAIR_VENUE)?;
    m.add_class::<BetfairDataConfig>()?;
    m.add_class::<BetfairExecConfig>()?;
    m.add_class::<BetfairDataClientFactory>()?;
    m.add_class::<BetfairExecutionClientFactory>()?;

    let registry = get_global_pyo3_registry();

    if let Err(e) =
        registry.register_factory_extractor(BETFAIR.to_string(), extract_betfair_data_factory)
    {
        return Err(to_pyruntime_err(format!(
            "Failed to register Betfair data factory extractor: {e}"
        )));
    }

    if let Err(e) =
        registry.register_exec_factory_extractor(BETFAIR.to_string(), extract_betfair_exec_factory)
    {
        return Err(to_pyruntime_err(format!(
            "Failed to register Betfair exec factory extractor: {e}"
        )));
    }

    if let Err(e) = registry
        .register_config_extractor("BetfairDataConfig".to_string(), extract_betfair_data_config)
    {
        return Err(to_pyruntime_err(format!(
            "Failed to register Betfair data config extractor: {e}"
        )));
    }

    if let Err(e) = registry
        .register_config_extractor("BetfairExecConfig".to_string(), extract_betfair_exec_config)
    {
        return Err(to_pyruntime_err(format!(
            "Failed to register Betfair exec config extractor: {e}"
        )));
    }

    Ok(())
}
