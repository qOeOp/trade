//! A user signal type.

use std::{any::Any, sync::Arc};

use serde::{Deserialize, Serialize};
use ustr::Ustr;
use vibe_core::UnixNanos;
use vibe_model::data::{HasTsInit, custom::CustomDataTrait};

/// Represents a generic signal.
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
pub struct Signal {
    pub name: Ustr,
    pub value: String,
    pub ts_event: UnixNanos,
    pub ts_init: UnixNanos,
}

impl Signal {
    /// Creates a new [`Signal`] instance.
    #[must_use]
    pub const fn new(name: Ustr, value: String, ts_event: UnixNanos, ts_init: UnixNanos) -> Self {
        Self {
            name,
            value,
            ts_event,
            ts_init,
        }
    }
}

impl HasTsInit for Signal {
    fn ts_init(&self) -> UnixNanos {
        self.ts_init
    }
}

impl CustomDataTrait for Signal {
    fn type_name(&self) -> &'static str {
        "Signal"
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn ts_event(&self) -> UnixNanos {
        self.ts_event
    }

    fn to_json(&self) -> anyhow::Result<String> {
        Ok(serde_json::to_string(self)?)
    }

    fn clone_arc(&self) -> Arc<dyn CustomDataTrait> {
        Arc::new(self.clone())
    }

    fn eq_arc(&self, other: &dyn CustomDataTrait) -> bool {
        other
            .as_any()
            .downcast_ref::<Self>()
            .is_some_and(|o| self == o)
    }

    #[cfg(feature = "python")]
    fn to_pyobject(&self, py: pyo3::Python<'_>) -> pyo3::PyResult<pyo3::Py<pyo3::PyAny>> {
        use pyo3::IntoPyObjectExt;
        self.clone().into_py_any(py)
    }
}
