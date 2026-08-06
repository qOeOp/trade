//! A user custom data type.

use bytes::Bytes;
use serde::{Deserialize, Serialize};
use vibe_core::UnixNanos;
use vibe_model::data::DataType;

/// Represents a custom data.
#[repr(C)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(module = "vibe_trader.common", from_py_object)
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass(module = "vibe_trader.common")
)]
pub struct CustomData {
    pub data_type: DataType,
    pub value: Bytes,
    pub ts_event: UnixNanos,
    pub ts_init: UnixNanos,
}

impl CustomData {
    /// Creates a new [`CustomData`] instance.
    pub const fn new(
        data_type: DataType,
        value: Bytes,
        ts_event: UnixNanos,
        ts_init: UnixNanos,
    ) -> Self {
        Self {
            data_type,
            value,
            ts_event,
            ts_init,
        }
    }
}
