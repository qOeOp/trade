//! Factory functions for creating Lighter clients and components.

use std::{any::Any, cell::RefCell, rc::Rc};

use vibe_common::{
    cache::CacheView,
    clients::{DataClient, ExecutionClient},
    clock::Clock,
    factories::{ClientConfig, DataClientFactory, ExecutionClientFactory},
};
use vibe_live::ExecutionClientCore;
use vibe_model::{
    enums::{AccountType, OmsType},
    identifiers::ClientId,
};

use crate::{
    common::consts::{LIGHTER, LIGHTER_VENUE},
    config::{LighterDataClientConfig, LighterExecClientConfig},
    data::LighterDataClient,
    execution::LighterExecutionClient,
};

impl ClientConfig for LighterDataClientConfig {
    fn as_any(&self) -> &dyn Any {
        self
    }
}

impl ClientConfig for LighterExecClientConfig {
    fn as_any(&self) -> &dyn Any {
        self
    }
}

/// Factory for creating Lighter data clients.
#[derive(Debug, Clone, Default)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(module = "vibe_trader.adapters.lighter", from_py_object,)
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass(module = "vibe_trader.adapters.lighter")
)]
pub struct LighterDataClientFactory;

impl LighterDataClientFactory {
    /// Creates a new [`LighterDataClientFactory`] instance.
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

impl DataClientFactory for LighterDataClientFactory {
    fn create(
        &self,
        name: &str,
        config: &dyn ClientConfig,
        _cache: CacheView,
        _clock: Rc<RefCell<dyn Clock>>,
    ) -> anyhow::Result<Box<dyn DataClient>> {
        let lighter_config = config
            .as_any()
            .downcast_ref::<LighterDataClientConfig>()
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "Invalid config type for LighterDataClientFactory. Expected LighterDataClientConfig, was {config:?}",
                )
            })?
            .clone();

        let client_id = ClientId::from(name);
        let client = LighterDataClient::new(client_id, lighter_config)?;
        Ok(Box::new(client))
    }

    fn name(&self) -> &'static str {
        LIGHTER
    }

    fn config_type(&self) -> &'static str {
        "LighterDataClientConfig"
    }
}

/// Factory for creating Lighter execution clients.
#[derive(Debug, Clone, Default)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(module = "vibe_trader.adapters.lighter", from_py_object,)
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass(module = "vibe_trader.adapters.lighter")
)]
pub struct LighterExecutionClientFactory;

impl LighterExecutionClientFactory {
    /// Creates a new [`LighterExecutionClientFactory`] instance.
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

impl ExecutionClientFactory for LighterExecutionClientFactory {
    fn create(
        &self,
        name: &str,
        config: &dyn ClientConfig,
        cache: CacheView,
    ) -> anyhow::Result<Box<dyn ExecutionClient>> {
        let lighter_config = config
            .as_any()
            .downcast_ref::<LighterExecClientConfig>()
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "Invalid config type for LighterExecutionClientFactory. Expected LighterExecClientConfig, was {config:?}",
                )
            })?
            .clone();

        // Lighter is a perpetual futures DEX with margin accounts and one
        // position per market on the L2.
        let core = ExecutionClientCore::new(
            lighter_config.trader_id,
            ClientId::from(name),
            *LIGHTER_VENUE,
            OmsType::Netting,
            lighter_config.account_id,
            AccountType::Margin,
            None,
            cache,
        );

        let client = LighterExecutionClient::new(core, lighter_config)?;
        Ok(Box::new(client))
    }

    fn name(&self) -> &'static str {
        LIGHTER
    }

    fn config_type(&self) -> &'static str {
        "LighterExecClientConfig"
    }
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, rc::Rc};

    use rstest::rstest;
    use vibe_common::{
        cache::Cache,
        clock::TestClock,
        factories::{ClientConfig, DataClientFactory, ExecutionClientFactory},
    };
    use vibe_model::identifiers::{AccountId, TraderId};

    use super::*;

    fn exec_config() -> LighterExecClientConfig {
        LighterExecClientConfig::builder()
            .trader_id(TraderId::from("TRADER-001"))
            .account_id(AccountId::from("LIGHTER-001"))
            .build()
    }

    #[rstest]
    fn test_lighter_data_client_factory_creation() {
        let factory = LighterDataClientFactory::new();
        assert_eq!(factory.name(), LIGHTER);
        assert_eq!(factory.config_type(), "LighterDataClientConfig");
    }

    #[rstest]
    fn test_lighter_execution_client_factory_creation() {
        let factory = LighterExecutionClientFactory::new();
        assert_eq!(factory.name(), LIGHTER);
        assert_eq!(factory.config_type(), "LighterExecClientConfig");
    }

    #[rstest]
    fn test_lighter_exec_client_config_implements_client_config() {
        let config = exec_config();
        let boxed_config: Box<dyn ClientConfig> = Box::new(config);
        let downcasted = boxed_config
            .as_any()
            .downcast_ref::<LighterExecClientConfig>();

        assert!(downcasted.is_some());
    }

    #[rstest]
    fn test_lighter_execution_client_factory_rejects_wrong_config_type() {
        let factory = LighterExecutionClientFactory::new();
        let wrong_config = LighterDataClientConfig::default();

        let cache = Rc::new(RefCell::new(Cache::default()));

        let result = factory.create("LIGHTER-TEST", &wrong_config, cache.into());
        assert!(result.is_err());
        assert!(
            result
                .err()
                .unwrap()
                .to_string()
                .contains("Invalid config type")
        );
    }

    #[rstest]
    fn test_lighter_execution_client_factory_constructs_without_credentials() {
        let factory = LighterExecutionClientFactory::new();
        let config = exec_config();
        let cache = Rc::new(RefCell::new(Cache::default()));

        let client = factory
            .create("LIGHTER-TEST", &config, cache.into())
            .expect("expected client to construct without credentials");

        assert!(!client.is_connected());
    }

    #[rstest]
    fn test_lighter_data_client_factory_rejects_wrong_config_type() {
        let factory = LighterDataClientFactory::new();
        let wrong_config = exec_config();
        let cache = Rc::new(RefCell::new(Cache::default()));
        let clock = Rc::new(RefCell::new(TestClock::new()));

        let result = factory.create("LIGHTER-TEST", &wrong_config, cache.into(), clock);
        assert!(result.is_err());
        assert!(
            result
                .err()
                .unwrap()
                .to_string()
                .contains("Invalid config type")
        );
    }
}
