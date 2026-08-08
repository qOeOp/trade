//! Python bindings for latency model types.

use pyo3::prelude::*;
use vibe_core::UnixNanos;

use crate::models::latency::StaticLatencyModel;

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl StaticLatencyModel {
    /// Static latency model with fixed latency values.
    ///
    /// Models the latency for different order operations including base network latency
    /// and specific operation latencies for insert, update, and delete operations.
    ///
    /// The base latency is automatically added to each operation latency, matching
    /// Python's behavior. For example, if `base_latency_nanos = 100ms` and
    /// `insert_latency_nanos = 200ms`, the effective insert latency will be 300ms.
    #[new]
    #[pyo3(signature = (
        base_latency_nanos = 0,
        insert_latency_nanos = 0,
        update_latency_nanos = 0,
        cancel_latency_nanos = 0,
    ))]
    fn py_new(
        base_latency_nanos: u64,
        insert_latency_nanos: u64,
        update_latency_nanos: u64,
        cancel_latency_nanos: u64,
    ) -> Self {
        Self::new(
            UnixNanos::from(base_latency_nanos),
            UnixNanos::from(insert_latency_nanos),
            UnixNanos::from(update_latency_nanos),
            UnixNanos::from(cancel_latency_nanos),
        )
    }

    fn __repr__(&self) -> String {
        format!("{self:?}")
    }
}
