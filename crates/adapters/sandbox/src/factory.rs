//! Factory for creating sandbox execution clients.

use std::{any::Any, cell::RefCell, rc::Rc};

use vibe_common::{
    cache::Cache,
    clients::ExecutionClient,
    clock::Clock,
    factories::{ClientConfig, SimulatedExecutionClientFactory},
    live::clock::LiveClock,
};
use vibe_execution::client::core::ExecutionClientCore;
use vibe_model::identifiers::ClientId;

use crate::{config::SandboxExecutionClientConfig, execution::SandboxExecutionClient};

impl ClientConfig for SandboxExecutionClientConfig {
    fn as_any(&self) -> &dyn Any {
        self
    }
}

/// Factory for creating sandbox execution clients.
#[derive(Debug, Default, Clone)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(module = "vibe_trader.adapters.sandbox", unsendable, from_py_object)
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass(module = "vibe_trader.adapters.sandbox")
)]
pub struct SandboxExecutionClientFactory;

impl SandboxExecutionClientFactory {
    /// Creates a new [`SandboxExecutionClientFactory`] instance.
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

impl SimulatedExecutionClientFactory for SandboxExecutionClientFactory {
    fn create(
        &self,
        name: &str,
        config: &dyn ClientConfig,
        cache: Rc<RefCell<Cache>>,
    ) -> anyhow::Result<Box<dyn ExecutionClient>> {
        let sandbox_config = config
            .as_any()
            .downcast_ref::<SandboxExecutionClientConfig>()
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "Invalid config type for SandboxExecutionClientFactory. Expected SandboxExecutionClientConfig, was {config:?}",
                )
            })?
            .clone();

        let client_id = ClientId::from(name);
        let clock: Rc<RefCell<dyn Clock>> = Rc::new(RefCell::new(LiveClock::default()));

        let core = ExecutionClientCore::new(
            sandbox_config.trader_id,
            client_id,
            sandbox_config.venue,
            sandbox_config.oms_type,
            sandbox_config.account_id,
            sandbox_config.account_type,
            sandbox_config.base_currency,
            cache.clone(),
        );

        let client = SandboxExecutionClient::new(core, sandbox_config, clock, cache);
        Ok(Box::new(client))
    }

    fn name(&self) -> &'static str {
        "SANDBOX"
    }

    fn config_type(&self) -> &'static str {
        "SandboxExecutionClientConfig"
    }
}
