//! Configuration for execution algorithms.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use vibe_core::serialization::default_true;
use vibe_model::identifiers::ExecAlgorithmId;

/// Configuration for an execution algorithm.
#[cfg_attr(
    feature = "python",
    expect(
        clippy::unsafe_derive_deserialize,
        reason = "config deserializes plain fields; unsafe methods come from generated PyO3 integration"
    )
)]
#[derive(Clone, Debug, Deserialize, Serialize, bon::Builder)]
#[serde(deny_unknown_fields)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(module = "vibe_trader.trading", subclass, from_py_object)
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass(module = "vibe_trader.trading")
)]
pub struct ExecutionAlgorithmConfig {
    /// The unique ID for the execution algorithm.
    pub exec_algorithm_id: Option<ExecAlgorithmId>,
    /// If events should be logged by the algorithm.
    #[serde(default = "default_true")]
    #[builder(default = true)]
    pub log_events: bool,
    /// If commands should be logged by the algorithm.
    #[serde(default = "default_true")]
    #[builder(default = true)]
    pub log_commands: bool,
}

impl Default for ExecutionAlgorithmConfig {
    fn default() -> Self {
        Self::builder().build()
    }
}

/// Configuration for creating execution algorithms from importable paths.
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
pub struct ImportableExecAlgorithmConfig {
    /// The fully qualified name of the execution algorithm class.
    pub exec_algorithm_path: String,
    /// The fully qualified name of the execution algorithm config class.
    pub config_path: String,
    /// The execution algorithm configuration as a dictionary.
    pub config: HashMap<String, serde_json::Value>,
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn test_config_default() {
        let config = ExecutionAlgorithmConfig::default();

        assert!(config.exec_algorithm_id.is_none());
        assert!(config.log_events);
        assert!(config.log_commands);
    }

    #[rstest]
    fn test_config_with_id() {
        let exec_algorithm_id = ExecAlgorithmId::new("TWAP");
        let config = ExecutionAlgorithmConfig {
            exec_algorithm_id: Some(exec_algorithm_id),
            ..Default::default()
        };

        assert_eq!(config.exec_algorithm_id, Some(exec_algorithm_id));
    }

    #[rstest]
    fn test_config_serialization() {
        let config = ExecutionAlgorithmConfig {
            exec_algorithm_id: Some(ExecAlgorithmId::new("TWAP")),
            log_events: false,
            log_commands: true,
        };

        let json = serde_json::to_string(&config).unwrap();
        let deserialized: ExecutionAlgorithmConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(config.exec_algorithm_id, deserialized.exec_algorithm_id);
        assert_eq!(config.log_events, deserialized.log_events);
        assert_eq!(config.log_commands, deserialized.log_commands);
    }
}
