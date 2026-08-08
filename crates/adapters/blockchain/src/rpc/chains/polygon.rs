use alloy::primitives::Address;
use vibe_model::defi::chain::chains;
use vibe_network::websocket::TransportBackend;

use crate::rpc::{
    BlockchainRpcClient,
    core::CoreBlockchainRpcClient,
    error::BlockchainRpcClientError,
    types::{BlockchainMessage, RpcEventType},
};

#[derive(Debug)]
pub struct PolygonRpcClient {
    base_client: CoreBlockchainRpcClient,
}

impl PolygonRpcClient {
    pub fn new(wss_rpc_url: String, proxy_url: Option<String>) -> Self {
        let base_client =
            CoreBlockchainRpcClient::new(chains::POLYGON.clone(), wss_rpc_url, proxy_url);

        Self { base_client }
    }
}

#[async_trait::async_trait]
impl BlockchainRpcClient for PolygonRpcClient {
    async fn connect(&mut self) -> anyhow::Result<()> {
        self.base_client.connect().await
    }

    async fn subscribe_blocks(&mut self) -> Result<(), BlockchainRpcClientError> {
        self.base_client.subscribe_blocks().await
    }

    async fn subscribe_pool_events(
        &mut self,
        event_type: RpcEventType,
        addresses: &[Address],
        event_signature: String,
    ) -> Result<(), BlockchainRpcClientError> {
        self.base_client
            .subscribe_pool_events(event_type, addresses, event_signature)
            .await
    }

    async fn unsubscribe_blocks(&mut self) -> Result<(), BlockchainRpcClientError> {
        self.base_client.unsubscribe_blocks().await
    }

    async fn next_rpc_message(&mut self) -> Result<BlockchainMessage, BlockchainRpcClientError> {
        self.base_client.next_rpc_message().await
    }

    fn set_transport_backend(&mut self, backend: TransportBackend) {
        self.base_client.set_transport_backend(backend);
    }
}
