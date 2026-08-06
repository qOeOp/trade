//! Python bindings from [PyO3](https://pyo3.rs).

#![expect(
    clippy::missing_errors_doc,
    reason = "errors documented on underlying Rust methods"
)]

pub mod backend;
pub mod catalog;
pub mod feather;
pub mod wranglers;

use pyo3::prelude::*;
use vibe_model::data::ensure_rust_extractor_registered;
use vibe_serialization::arrow::custom::ensure_custom_data_registered;

/// Exposed through `vibe_trader.persistence`.
///
/// # Errors
///
/// Returns a `PyErr` if registering any module components fails.
#[pymodule]
pub fn persistence(_: Python<'_>, m: &Bound<'_, PyModule>) -> PyResult<()> {
    ensure_custom_data_registered::<crate::test_data::RustTestCustomData>();
    ensure_custom_data_registered::<crate::test_data::MacroYieldCurveData>();
    ensure_custom_data_registered::<crate::test_data::RustTestParamsCustomData>();
    ensure_custom_data_registered::<crate::test_data::RustTestPriceMapCustomData>();
    ensure_custom_data_registered::<crate::test_data::RustTestTypedMapCustomData>();
    let _result = ensure_rust_extractor_registered::<crate::test_data::RustTestCustomData>();
    let _result = ensure_rust_extractor_registered::<crate::test_data::MacroYieldCurveData>();
    let _result = ensure_rust_extractor_registered::<crate::test_data::RustTestParamsCustomData>();
    let _result =
        ensure_rust_extractor_registered::<crate::test_data::RustTestPriceMapCustomData>();
    let _result =
        ensure_rust_extractor_registered::<crate::test_data::RustTestTypedMapCustomData>();

    // Test/example types (RustTestCustomData, MacroYieldCurveData) are exposed so Python tests
    // and examples can use them; they are not gated behind cfg(test) to keep the extension build simple.
    m.add_class::<crate::backend::session::DataBackendSession>()?;
    m.add_class::<crate::backend::session::DataQueryResult>()?;
    m.add_class::<backend::session::VibeDataType>()?;
    m.add_class::<catalog::PyParquetDataCatalog>()?;
    m.add_class::<feather::PyStreamingFeatherWriter>()?;
    m.add_class::<wranglers::bar::BarDataWrangler>()?;
    m.add_class::<wranglers::delta::OrderBookDeltaDataWrangler>()?;
    m.add_class::<wranglers::depth::OrderBookDepth10DataWrangler>()?;
    m.add_class::<wranglers::quote::QuoteTickDataWrangler>()?;
    m.add_class::<wranglers::trade::TradeTickDataWrangler>()?;
    m.add_class::<crate::test_data::RustTestCustomData>()?;
    m.add_class::<crate::test_data::MacroYieldCurveData>()?;
    m.add_class::<crate::test_data::RustTestParamsCustomData>()?;
    m.add_class::<crate::test_data::RustTestPriceMapCustomData>()?;
    m.add_class::<crate::test_data::RustTestTypedMapCustomData>()?;
    Ok(())
}
