use alloy::primitives::Address;
use vibe_core::UnixNanos;
use vibe_model::{
    defi::{PoolIdentifier, SharedChain, SharedDex, data::PoolFeeProtocolCollect},
    identifiers::InstrumentId,
};

/// Represents a `CollectProtocol` event that withdraws accrued protocol fees from a pool.
///
/// This is the owner-only protocol-fee withdrawal, distinct from the regular `Collect` event that
/// withdraws an LP position's fees. The withdrawn amounts decrement the pool's protocol-fee balances.
#[derive(Debug, Clone)]
pub struct FeeProtocolCollectEvent {
    /// The decentralized exchange where the event happened.
    pub dex: SharedDex,
    /// The unique identifier for the pool.
    pub pool_identifier: PoolIdentifier,
    /// The block number in which this event was included.
    pub block_number: u64,
    /// The unique hash identifier of the transaction containing this event.
    pub transaction_hash: String,
    /// The position of this transaction within the block.
    pub transaction_index: u32,
    /// The position of this event log within the transaction.
    pub log_index: u32,
    /// The address that initiated the withdrawal (the factory owner).
    pub sender: Address,
    /// The address that received the withdrawn protocol fees.
    pub recipient: Address,
    /// The amount of token0 protocol fees withdrawn.
    pub amount0: u128,
    /// The amount of token1 protocol fees withdrawn.
    pub amount1: u128,
}

impl FeeProtocolCollectEvent {
    /// Creates a new [`FeeProtocolCollectEvent`] instance with the specified parameters.
    #[must_use]
    #[expect(clippy::too_many_arguments)]
    pub fn new(
        dex: SharedDex,
        pool_identifier: PoolIdentifier,
        block_number: u64,
        transaction_hash: String,
        transaction_index: u32,
        log_index: u32,
        sender: Address,
        recipient: Address,
        amount0: u128,
        amount1: u128,
    ) -> Self {
        Self {
            dex,
            pool_identifier,
            block_number,
            transaction_hash,
            transaction_index,
            log_index,
            sender,
            recipient,
            amount0,
            amount1,
        }
    }

    /// Converts a collect-protocol event into a `PoolFeeProtocolCollect`.
    #[must_use]
    pub fn to_pool_fee_protocol_collect(
        &self,
        chain: SharedChain,
        instrument_id: InstrumentId,
        timestamp: UnixNanos,
    ) -> PoolFeeProtocolCollect {
        PoolFeeProtocolCollect::new(
            chain,
            self.dex.clone(),
            instrument_id,
            self.pool_identifier,
            self.block_number,
            self.transaction_hash.clone(),
            self.transaction_index,
            self.log_index,
            self.sender,
            self.recipient,
            self.amount0,
            self.amount1,
            timestamp, // ts_event
            timestamp, // ts_init (same block timestamp)
        )
    }
}
