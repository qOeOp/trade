use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// Configuration for creating controllers from importable paths.
#[cfg_attr(
    feature = "python",
    expect(
        clippy::unsafe_derive_deserialize,
        reason = "config deserializes plain fields; unsafe methods come from generated PyO3 integration"
    )
)]
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(module = "vibe_trader.trading", from_py_object)
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass(module = "vibe_trader.trading")
)]
pub struct ImportableControllerConfig {
    /// The fully qualified name of the Controller class.
    pub controller_path: String,
    /// The fully qualified name of the Controller config class.
    pub config_path: String,
    /// The controller configuration as a dictionary.
    pub config: HashMap<String, serde_json::Value>,
}
