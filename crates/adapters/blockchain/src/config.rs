use std::any::Any;

use serde::{Deserialize, Serialize};
use vibe_common::factories::ClientConfig;
use vibe_infrastructure::sql::pg::PostgresConnectOptions;
use vibe_model::{
    defi::{Chain, DexType, SharedChain},
    identifiers::{AccountId, TraderId},
};
use vibe_network::websocket::TransportBackend;

/// Defines filtering criteria for the DEX pool universe that the data client will operate on.
#[derive(Debug, Clone, Serialize, Deserialize, bon::Builder)]
#[serde(default, deny_unknown_fields)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(module = "vibe_trader.adapters.blockchain", from_py_object)
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass(module = "vibe_trader.adapters.blockchain")
)]
pub struct DexPoolFilters {
    /// Whether to exclude pools containing tokens with empty name or symbol fields.
    #[builder(default = true)]
    pub remove_pools_with_empty_erc20fields: bool,
}

impl Default for DexPoolFilters {
    fn default() -> Self {
        Self::builder().build()
    }
}

/// Configuration for blockchain data clients.
#[derive(Debug, Clone, Serialize, Deserialize, bon::Builder)]
#[serde(deny_unknown_fields)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(module = "vibe_trader.adapters.blockchain", from_py_object)
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass(module = "vibe_trader.adapters.blockchain")
)]
pub struct BlockchainDataClientConfig {
    /// The blockchain chain configuration.
    pub chain: SharedChain,
    /// List of decentralized exchange IDs to register and sync during connection.
    #[builder(default)]
    #[serde(default)]
    pub dex_ids: Vec<DexType>,
    /// Determines if the client should use Hypersync for live data streaming.
    #[builder(default)]
    #[serde(default)]
    pub use_hypersync_for_live_data: bool,
    /// The HTTP URL for the blockchain RPC endpoint.
    pub http_rpc_url: String,
    /// The maximum number of RPC requests allowed per second.
    pub rpc_requests_per_second: Option<u32>,
    /// The maximum number of Multicall calls per one RPC request.
    #[builder(default = 200)]
    #[serde(default = "default_multicall_calls_per_rpc_request")]
    pub multicall_calls_per_rpc_request: u32,
    /// The WebSocket secure URL for the blockchain RPC endpoint.
    pub wss_rpc_url: Option<String>,
    /// Optional proxy URL for HTTP and WebSocket transports.
    pub proxy_url: Option<String>,
    /// The block from which to sync historical data.
    pub from_block: Option<u64>,
    /// Filtering criteria that define which DEX pools to include in the data universe.
    #[builder(default)]
    #[serde(default)]
    pub pool_filters: DexPoolFilters,
    /// Optional configuration for data client's Postgres cache database
    pub postgres_cache_database_config: Option<PostgresConnectOptions>,
    /// WebSocket transport backend (defaults to `Tungstenite`).
    #[builder(default)]
    #[serde(default)]
    pub transport_backend: TransportBackend,
}

#[cfg(feature = "python")]
vibe_core::impl_pyo3_config_getters!(BlockchainDataClientConfig {
    dex_ids: Vec<DexType>,
    multicall_calls_per_rpc_request: u32,
    pool_filters: DexPoolFilters,
    transport_backend: TransportBackend,
});

const fn default_multicall_calls_per_rpc_request() -> u32 {
    200
}

#[derive(Debug, Clone, Serialize, Deserialize, bon::Builder)]
#[serde(deny_unknown_fields)]
pub struct BlockchainExecutionClientConfig {
    /// The trader ID for the client.
    pub trader_id: TraderId,
    /// The account ID for the client.
    pub client_id: AccountId,
    /// The blockchain chain configuration.
    pub chain: Chain,
    /// The wallet address of the execution client.
    pub wallet_address: String,
    /// Token universe: set of ERC-20 token addresses to monitor for balance tracking.
    pub tokens: Option<Vec<String>>,
    /// The HTTP URL for the blockchain RPC endpoint.
    pub http_rpc_url: String,
    /// The maximum number of RPC requests allowed per second.
    pub rpc_requests_per_second: Option<u32>,
    /// WebSocket transport backend (defaults to `Tungstenite`).
    #[builder(default)]
    #[serde(default)]
    pub transport_backend: TransportBackend,
}

impl ClientConfig for BlockchainExecutionClientConfig {
    fn as_any(&self) -> &dyn Any {
        self
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn test_data_config_toml_minimal() {
        let config: BlockchainDataClientConfig = toml::from_str(
            r#"
http_rpc_url = "https://eth-mainnet.example.com"

[chain]
name = "Ethereum"
chain_id = 1
hypersync_url = "https://1.hypersync.xyz"
native_currency_decimals = 18
"#,
        )
        .unwrap();

        assert_eq!(config.http_rpc_url, "https://eth-mainnet.example.com");
        assert_eq!(config.chain.chain_id, 1);
        assert!(config.dex_ids.is_empty());
        assert!(!config.use_hypersync_for_live_data);
        assert_eq!(config.multicall_calls_per_rpc_request, 200);
        assert!(config.pool_filters.remove_pools_with_empty_erc20fields);
        assert_eq!(config.transport_backend, TransportBackend::default());
    }

    #[rstest]
    fn test_execution_config_toml_minimal() {
        let config: BlockchainExecutionClientConfig = toml::from_str(
            r#"
trader_id = "TRADER-001"
client_id = "BLOCKCHAIN-001"
wallet_address = "0x0000000000000000000000000000000000000000"
http_rpc_url = "https://eth-mainnet.example.com"

[chain]
name = "Ethereum"
chain_id = 1
hypersync_url = "https://1.hypersync.xyz"
native_currency_decimals = 18
"#,
        )
        .unwrap();

        assert_eq!(config.http_rpc_url, "https://eth-mainnet.example.com");
        assert_eq!(config.chain.chain_id, 1);
        assert_eq!(
            config.wallet_address,
            "0x0000000000000000000000000000000000000000",
        );
        assert!(config.tokens.is_none());
        assert!(config.rpc_requests_per_second.is_none());
        assert_eq!(config.transport_backend, TransportBackend::default());
    }
}
