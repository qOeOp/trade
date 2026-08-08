//! Python bindings from [PyO3](https://pyo3.rs).

pub mod config;
pub mod node;

use pyo3::prelude::*;
use vibe_portfolio::config::PortfolioConfig;

pyo3_stub_gen::reexport_module_members!(
    "vibe_trader.live",
    "vibe_trader.portfolio",
    "PortfolioConfig"
);

/// Exposed through `vibe_trader.live`.
///
/// # Errors
///
/// Returns a `PyErr` if registering any module components fails.
#[pymodule]
pub fn live(_: Python<'_>, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<crate::node::LiveNode>()?;
    m.add_class::<node::LiveNodeBuilderPy>()?;
    m.add_class::<crate::config::LiveNodeConfig>()?;
    m.add_class::<crate::config::LiveDataEngineConfig>()?;
    m.add_class::<crate::config::LiveRiskEngineConfig>()?;
    m.add_class::<crate::config::LiveExecEngineConfig>()?;
    m.add_class::<crate::config::PluginConfig>()?;
    m.add_class::<crate::config::RoutingConfig>()?;
    m.add_class::<crate::config::InstrumentProviderConfig>()?;
    m.add_class::<crate::config::LiveDataClientConfig>()?;
    m.add_class::<crate::config::LiveExecClientConfig>()?;
    m.add_class::<PortfolioConfig>()?;
    Ok(())
}
