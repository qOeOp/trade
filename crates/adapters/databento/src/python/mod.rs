//! Python bindings from [PyO3](https://pyo3.rs).

#![expect(
    clippy::missing_errors_doc,
    reason = "errors documented on underlying Rust methods"
)]

pub mod arrow;
pub mod enums;
pub mod historical;
pub mod loader;
pub mod types;

#[cfg(feature = "live")]
pub mod data;
#[cfg(feature = "live")]
pub mod factories;
#[cfg(feature = "live")]
pub mod live;

use pyo3::prelude::*;
#[cfg(feature = "live")]
use vibe_common::factories::{ClientConfig, DataClientFactory};
use vibe_core::python::{to_pyruntime_err, to_pyvalue_err};
use vibe_system::get_global_pyo3_registry;

#[cfg(feature = "live")]
use crate::{
    common::DATABENTO,
    factories::{DatabentoDataClientFactory, DatabentoLiveClientConfig},
};

#[cfg(feature = "live")]
#[expect(clippy::needless_pass_by_value)]
fn extract_databento_data_factory(
    py: Python<'_>,
    factory: Py<PyAny>,
) -> PyResult<Box<dyn DataClientFactory>> {
    match factory.extract::<DatabentoDataClientFactory>(py) {
        Ok(f) => Ok(Box::new(f)),
        Err(e) => Err(to_pyvalue_err(format!(
            "Failed to extract DatabentoDataClientFactory: {e}"
        ))),
    }
}

#[cfg(feature = "live")]
#[expect(clippy::needless_pass_by_value)]
fn extract_databento_data_config(
    py: Python<'_>,
    config: Py<PyAny>,
) -> PyResult<Box<dyn ClientConfig>> {
    match config.extract::<DatabentoLiveClientConfig>(py) {
        Ok(c) => Ok(Box::new(c)),
        Err(e) => Err(to_pyvalue_err(format!(
            "Failed to extract DatabentoLiveClientConfig: {e}"
        ))),
    }
}

/// Databento Python module.
///
/// The module is exposed as `vibe_trader._libvibe.databento`.
///
/// # Errors
///
/// Returns a `PyErr` if registering any module components fails.
#[pymodule]
pub fn databento(_: Python<'_>, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<super::enums::DatabentoStatisticType>()?;
    m.add_class::<super::enums::DatabentoStatisticUpdateAction>()?;
    m.add_class::<super::types::DatabentoPublisher>()?;
    m.add_class::<super::types::DatabentoStatistics>()?;
    m.add_class::<super::types::DatabentoImbalance>()?;
    m.add_class::<super::loader::DatabentoDataLoader>()?;
    m.add_class::<historical::DatabentoHistoricalClient>()?;
    m.add_function(wrap_pyfunction!(arrow::get_databento_arrow_schema_map, m)?)?;
    m.add_function(wrap_pyfunction!(
        arrow::py_databento_imbalance_to_arrow_record_batch_bytes,
        m
    )?)?;
    m.add_function(wrap_pyfunction!(
        arrow::py_databento_imbalance_from_arrow_record_batch_bytes,
        m
    )?)?;
    m.add_function(wrap_pyfunction!(
        arrow::py_databento_statistics_to_arrow_record_batch_bytes,
        m
    )?)?;
    m.add_function(wrap_pyfunction!(
        arrow::py_databento_statistics_from_arrow_record_batch_bytes,
        m
    )?)?;

    #[cfg(feature = "live")]
    m.add_class::<crate::data::DatabentoDataClient>()?;
    #[cfg(feature = "live")]
    m.add_class::<live::DatabentoLiveClient>()?;
    #[cfg(feature = "live")]
    m.add_class::<types::DatabentoSubscriptionAck>()?;
    #[cfg(feature = "live")]
    m.add_class::<DatabentoLiveClientConfig>()?;
    #[cfg(feature = "live")]
    m.add_class::<DatabentoDataClientFactory>()?;

    #[cfg(feature = "live")]
    {
        let registry = get_global_pyo3_registry();

        if let Err(e) = registry
            .register_factory_extractor(DATABENTO.to_string(), extract_databento_data_factory)
        {
            return Err(to_pyruntime_err(format!(
                "Failed to register Databento data factory extractor: {e}"
            )));
        }

        if let Err(e) = registry.register_config_extractor(
            "DatabentoLiveClientConfig".to_string(),
            extract_databento_data_config,
        ) {
            return Err(to_pyruntime_err(format!(
                "Failed to register Databento data config extractor: {e}"
            )));
        }

        // Register alias so callers using the generic name also resolve
        if let Err(e) = registry.register_config_extractor(
            "DatabentoDataClientConfig".to_string(),
            extract_databento_data_config,
        ) {
            return Err(to_pyruntime_err(format!(
                "Failed to register Databento data config alias extractor: {e}"
            )));
        }
    }

    Ok(())
}
