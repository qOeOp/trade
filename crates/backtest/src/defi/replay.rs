//! Replay ordering for DeFi data.

use vibe_model::defi::DefiData;

pub(crate) fn replay_position(data: &DefiData) -> (u64, u32, u32, u8) {
    let (block_number, transaction_index, log_index) = data.block_position();
    (
        block_number,
        transaction_index,
        log_index,
        replay_phase(data),
    )
}

const fn replay_phase(data: &DefiData) -> u8 {
    match data {
        DefiData::Block(_) => 0,
        DefiData::Pool(_) => 1,
        DefiData::PoolSnapshot(_) => 2,
        DefiData::PoolSwap(_)
        | DefiData::PoolLiquidityUpdate(_)
        | DefiData::PoolFeeCollect(_)
        | DefiData::PoolFeeProtocolUpdate(_)
        | DefiData::PoolFeeProtocolCollect(_)
        | DefiData::PoolFlash(_) => 3,
    }
}
