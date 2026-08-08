use vibe_model::defi::{Block, DexType};

use crate::events::{
    burn::BurnEvent, collect::CollectEvent, fee_protocol_collect::FeeProtocolCollectEvent,
    fee_protocol_update::FeeProtocolUpdateEvent, flash::FlashEvent, mint::MintEvent,
    swap::SwapEvent,
};

/// Represents normalized blockchain messages.
#[derive(Debug, Clone)]
pub enum BlockchainMessage {
    Block(Block),
    SwapEvent(SwapEvent),
    MintEvent(MintEvent),
    BurnEvent(BurnEvent),
    CollectEvent(CollectEvent),
    FlashEvent(FlashEvent),
    FeeProtocolUpdateEvent(FeeProtocolUpdateEvent),
    FeeProtocolCollectEvent(FeeProtocolCollectEvent),
}

/// Represents the types of events that can be subscribed to via the blockchain RPC interface.
///
/// This enum defines the various event types that the application can subscribe to using
/// the WebSocket-based RPC subscription.
#[derive(Debug, Clone, Copy, Hash, PartialOrd, Ord, PartialEq, Eq)]
pub enum RpcEventType {
    NewBlock,
    PoolSwap(DexType),
    PoolMint(DexType),
    PoolBurn(DexType),
    PoolCollect(DexType),
    PoolFlash(DexType),
    PoolFeeProtocolUpdate(DexType),
    PoolFeeProtocolCollect(DexType),
}
