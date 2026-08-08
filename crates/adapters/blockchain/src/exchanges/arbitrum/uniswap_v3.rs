use std::sync::LazyLock;

use vibe_model::defi::{
    chain::chains,
    dex::{AmmType, Dex, DexType},
};

use crate::exchanges::{extended::DexExtended, parsing::uniswap_v3};

/// Uniswap V3 DEX on Arbitrum.
pub static UNISWAP_V3: LazyLock<DexExtended> = LazyLock::new(|| {
    let mut dex = Dex::new(
        chains::ARBITRUM.clone(),
        DexType::UniswapV3,
        "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        165,
        AmmType::CLAMM,
        "PoolCreated(address,address,uint24,int24,address)",
        "Swap(address,address,int256,int256,uint160,uint128,int24)",
        "Mint(address,address,int24,int24,uint128,uint256,uint256)",
        "Burn(address,int24,int24,uint128,uint256,uint256)",
        "Collect(address,address,int24,int24,uint128,uint128)",
    );
    dex.set_initialize_event("Initialize(uint160,int24)");
    dex.set_flash_event("Flash(address,address,uint256,uint256,uint256,uint256)");
    dex.set_fee_protocol_update_event("SetFeeProtocol(uint8,uint8,uint8,uint8)");
    dex.set_fee_protocol_collect_event("CollectProtocol(address,address,uint128,uint128)");
    let mut dex_extended = DexExtended::new(dex);

    // HyperSync parsers
    dex_extended.set_pool_created_event_hypersync_parsing(
        uniswap_v3::pool_created::parse_pool_created_event_hypersync,
    );
    dex_extended.set_initialize_event_hypersync_parsing(
        uniswap_v3::initialize::parse_initialize_event_hypersync,
    );
    dex_extended.set_swap_event_hypersync_parsing(uniswap_v3::swap::parse_swap_event_hypersync);
    dex_extended.set_mint_event_hypersync_parsing(uniswap_v3::mint::parse_mint_event_hypersync);
    dex_extended.set_burn_event_hypersync_parsing(uniswap_v3::burn::parse_burn_event_hypersync);
    dex_extended
        .set_collect_event_hypersync_parsing(uniswap_v3::collect::parse_collect_event_hypersync);
    dex_extended.set_flash_event_hypersync_parsing(uniswap_v3::flash::parse_flash_event_hypersync);
    dex_extended.set_fee_protocol_update_event_hypersync_parsing(
        uniswap_v3::fee_protocol_update::parse_fee_protocol_update_event_hypersync,
    );
    dex_extended.set_fee_protocol_collect_event_hypersync_parsing(
        uniswap_v3::fee_protocol_collect::parse_fee_protocol_collect_event_hypersync,
    );

    // RPC parsers
    dex_extended
        .set_pool_created_event_rpc_parsing(uniswap_v3::pool_created::parse_pool_created_event_rpc);
    dex_extended
        .set_initialize_event_rpc_parsing(uniswap_v3::initialize::parse_initialize_event_rpc);
    dex_extended.set_swap_event_rpc_parsing(uniswap_v3::swap::parse_swap_event_rpc);
    dex_extended.set_mint_event_rpc_parsing(uniswap_v3::mint::parse_mint_event_rpc);
    dex_extended.set_burn_event_rpc_parsing(uniswap_v3::burn::parse_burn_event_rpc);
    dex_extended.set_collect_event_rpc_parsing(uniswap_v3::collect::parse_collect_event_rpc);
    dex_extended.set_flash_event_rpc_parsing(uniswap_v3::flash::parse_flash_event_rpc);
    dex_extended.set_fee_protocol_update_event_rpc_parsing(
        uniswap_v3::fee_protocol_update::parse_fee_protocol_update_event_rpc,
    );
    dex_extended.set_fee_protocol_collect_event_rpc_parsing(
        uniswap_v3::fee_protocol_collect::parse_fee_protocol_collect_event_rpc,
    );

    dex_extended
});
