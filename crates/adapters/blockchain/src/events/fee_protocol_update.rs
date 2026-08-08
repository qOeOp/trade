use vibe_core::UnixNanos;
use vibe_model::{
    defi::{PoolIdentifier, SharedChain, SharedDex, data::PoolFeeProtocolUpdate},
    identifiers::InstrumentId,
};

/// Represents a `SetFeeProtocol` event that changes a pool's protocol-fee configuration.
///
/// Only the new per-token values are retained; the previous values carried by the event are not
/// needed to rebuild pool state.
#[derive(Debug, Clone)]
pub struct FeeProtocolUpdateEvent {
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
    /// The new token0 protocol-fee value.
    pub fee_protocol0_new: u32,
    /// The new token1 protocol-fee value.
    pub fee_protocol1_new: u32,
}

impl FeeProtocolUpdateEvent {
    /// Creates a new [`FeeProtocolUpdateEvent`] instance with the specified parameters.
    #[must_use]
    #[expect(clippy::too_many_arguments)]
    pub fn new(
        dex: SharedDex,
        pool_identifier: PoolIdentifier,
        block_number: u64,
        transaction_hash: String,
        transaction_index: u32,
        log_index: u32,
        fee_protocol0_new: u32,
        fee_protocol1_new: u32,
    ) -> Self {
        Self {
            dex,
            pool_identifier,
            block_number,
            transaction_hash,
            transaction_index,
            log_index,
            fee_protocol0_new,
            fee_protocol1_new,
        }
    }

    /// Converts a fee-protocol update event into a `PoolFeeProtocolUpdate`.
    #[must_use]
    pub fn to_pool_fee_protocol_update(
        &self,
        chain: SharedChain,
        instrument_id: InstrumentId,
        timestamp: UnixNanos,
    ) -> PoolFeeProtocolUpdate {
        PoolFeeProtocolUpdate::new(
            chain,
            self.dex.clone(),
            instrument_id,
            self.pool_identifier,
            self.block_number,
            self.transaction_hash.clone(),
            self.transaction_index,
            self.log_index,
            self.fee_protocol0_new,
            self.fee_protocol1_new,
            timestamp, // ts_event
            timestamp, // ts_init (same block timestamp)
        )
    }
}
