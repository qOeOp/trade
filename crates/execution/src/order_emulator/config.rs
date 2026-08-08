use serde::{Deserialize, Serialize};

/// Configuration for `OrderEmulator` instances.
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(module = "vibe_trader.execution", from_py_object)
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass(module = "vibe_trader.execution")
)]
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, bon::Builder)]
#[serde(deny_unknown_fields)]
pub struct OrderEmulatorConfig {
    /// If debug mode is active (will provide extra debug logging).
    #[builder(default)]
    pub debug: bool,
}
