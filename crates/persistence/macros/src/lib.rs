//! Procedural macros for Vibe. Provides `#[custom_data]` for defining custom data types
//! with generated boilerplate (constructor, `HasTsInit`, `CustomDataTrait`, optional Arrow,
//! derives).

#![warn(clippy::pedantic)]

mod custom;

use proc_macro::TokenStream;

/// Expands a struct into a custom data type with generated impls: `#[derive(Debug, Clone,
/// Serialize, Deserialize, PartialEq)]`, constructor, `HasTsInit`, `CustomDataTrait`,
/// `ArrowSchemaProvider`, `EncodeToRecordBatch`, `DecodeDataFromRecordBatch` unless `no_arrow` is set,
/// `CatalogPathPrefix`, `From`/`TryFrom` for `Data`. Call `vibe_serialization::ensure_custom_data_registered::<T>()`
/// once per Arrow-enabled type, or `vibe_model::data::ensure_custom_data_json_registered::<T>()`
/// for `no_arrow` types. For Python, also call `vibe_model::data::register_rust_extractor::<T>()`
/// once per type.
/// Requires fields to include `ts_event` and `ts_init` (e.g. `vibe_core::UnixNanos`).
/// Supported field types include `InstrumentId`, `AccountId`, `Currency`, `BarType`, `Params`,
/// `UnixNanos`, `f64`, `f32`, `bool`, `String`, `u64`, `i64`, `u32`, `i32`, `Vec<f64>`,
/// and `Vec<u8>`.
/// Use `#[custom_data_field(serde)]` on a field to store any Serde serializable field as a
/// Serde JSON-backed Arrow `Utf8` column. Python access uses typed dict conversion when both
/// `K` and `V` of `HashMap<K, V>` or `IndexMap<K, V>` are in the typed-element whitelist:
/// `InstrumentId`, `AccountId`, `Currency`, `BarType`, `Price`, `Quantity`, `Money`, `String`,
/// `f64`, `f32`, `bool`, `u64`, `i64`, `u32`, `i32` (see `is_typed_json_map_segment` in
/// `custom.rs`). All other Serde-backed fields use the generic JSON bridge and accept/return
/// JSON-compatible Python values.
///
/// Use `#[custom_data(pyo3)]` or `#[custom_data(python)]` to also generate Python bindings:
/// `#[cfg_attr(feature = "python", pyo3::pyclass)]` on the struct and a `#[pymethods]` impl with
/// `#[new]` constructor and `#[getter]` per field. When `pyo3` is set, the Rust constructor is
/// named `new`; Python `__init__` forwards to it.
/// Use `#[custom_data(pyo3, no_display)]` to skip generating `repr()` and `Display` so you can
/// implement them manually.
/// Use `#[custom_data(pyo3, no_arrow)]` for live-only custom data that does not need Arrow or
/// catalog persistence.
/// Use `stub_module = "vibe_trader.<module>"` with `pyo3` to emit pyo3-stub-gen metadata.
#[proc_macro_attribute]
pub fn custom_data(attr: TokenStream, item: TokenStream) -> TokenStream {
    custom::expand_custom_data(attr.into(), item.into()).into()
}
