//! Factory for creating blockchain data clients.

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
    config::{BlockchainDataClientConfig, BlockchainExecutionClientConfig},
    constants::{BLOCKCHAIN, BLOCKCHAIN_VENUE},
    data::client::BlockchainDataClient,
    execution::client::BlockchainExecutionClient,
};

impl ClientConfig for BlockchainDataClientConfig {
    fn as_any(&self) -> &dyn Any {
        self
    }
}

/// Factory for creating blockchain data clients.
///
/// This factory creates `BlockchainDataClient` instances configured for different blockchain networks
/// (Ethereum, Arbitrum, Base, Polygon) with appropriate RPC and HyperSync configurations.
#[derive(Debug, Clone)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(module = "vibe_trader.adapters.blockchain", from_py_object)
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass(module = "vibe_trader.adapters.blockchain")
)]
pub struct BlockchainDataClientFactory;

impl BlockchainDataClientFactory {
    /// Creates a new [`BlockchainDataClientFactory`] instance.
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

impl Default for BlockchainDataClientFactory {
    fn default() -> Self {
        Self::new()
    }
}

impl DataClientFactory for BlockchainDataClientFactory {
    fn create(
        &self,
        name: &str,
        config: &dyn ClientConfig,
        _cache: CacheView,
        _clock: Rc<RefCell<dyn Clock>>,
    ) -> anyhow::Result<Box<dyn DataClient>> {
        let blockchain_config = config
            .as_any()
            .downcast_ref::<BlockchainDataClientConfig>()
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "Invalid config type for BlockchainDataClientFactory. Expected `BlockchainDataClientConfig`, was {config:?}"
                )
            })?;

        let client = BlockchainDataClient::new(ClientId::from(name), blockchain_config.clone());

        Ok(Box::new(client))
    }

    fn name(&self) -> &'static str {
        BLOCKCHAIN
    }

    fn config_type(&self) -> &'static str {
        "BlockchainDataClientConfig"
    }
}

/// Factory for creating blockchain execution clients.
#[derive(Debug, Clone)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(module = "vibe_trader.adapters.blockchain", from_py_object)
)]
pub struct BlockchainExecutionClientFactory;

impl BlockchainExecutionClientFactory {
    /// Creates a new [`BlockchainExecutionClientFactory`] instance.
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

impl Default for BlockchainExecutionClientFactory {
    fn default() -> Self {
        Self::new()
    }
}

impl ExecutionClientFactory for BlockchainExecutionClientFactory {
    fn create(
        &self,
        name: &str,
        config: &dyn ClientConfig,
        cache: CacheView,
    ) -> anyhow::Result<Box<dyn ExecutionClient>> {
        let blockchain_execution_config = config
            .as_any()
            .downcast_ref::<BlockchainExecutionClientConfig>()
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "Invalid config type for BlockchainExecutionClientFactory. Expected `BlockchainExecutionClientConfig`, was {config:?}"
                )
            })?;

        let core_execution_client = ExecutionClientCore::new(
            blockchain_execution_config.trader_id,
            ClientId::from(name),
            *BLOCKCHAIN_VENUE,
            OmsType::Netting,
            blockchain_execution_config.client_id,
            AccountType::Wallet,
            None,
            cache,
        );

        let client = BlockchainExecutionClient::new(
            core_execution_client,
            blockchain_execution_config.clone(),
        )?;

        Ok(Box::new(client))
    }

    fn name(&self) -> &'static str {
        BLOCKCHAIN
    }

    fn config_type(&self) -> &'static str {
        "BlockchainExecutionClientConfig"
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use rstest::rstest;
    use vibe_common::factories::DataClientFactory;
    use vibe_model::defi::chain::{Blockchain, chains};

    use crate::{
        config::BlockchainDataClientConfig, constants::BLOCKCHAIN,
        factories::BlockchainDataClientFactory,
    };

    #[rstest]
    fn test_blockchain_data_client_config_creation() {
        let chain = Arc::new(chains::ETHEREUM.clone());
        let config = BlockchainDataClientConfig::builder()
            .chain(chain)
            .http_rpc_url("https://eth-mainnet.example.com".to_string())
            .build();

        assert_eq!(config.chain.name, Blockchain::Ethereum);
        assert_eq!(config.http_rpc_url, "https://eth-mainnet.example.com");
    }

    #[rstest]
    fn test_factory_creation() {
        let factory = BlockchainDataClientFactory::new();
        assert_eq!(factory.name(), BLOCKCHAIN);
        assert_eq!(factory.config_type(), "BlockchainDataClientConfig");
    }
}
