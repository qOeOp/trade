use std::sync::LazyLock;

use vibe_model::defi::{
    chain::chains,
    dex::{AmmType, Dex, DexType},
};

use crate::exchanges::{extended::DexExtended, parsing::uniswap_v3};

/// Aerodrome Slipstream DEX on Base.
///
/// Slipstream is a Uniswap V3 fork; pool events reuse the V3 parsers. The factory
/// PoolCreated layout differs (tickSpacing in place of fee) and is left empty until
/// a Slipstream parser is written, since advertising a topic without a parser would
/// abort pool discovery.
pub static AERODROME_SLIPSTREAM: LazyLock<DexExtended> = LazyLock::new(|| {
    let mut dex = Dex::new(
        chains::BASE.clone(),
        DexType::AerodromeSlipstream,
        "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
        3200559,
        AmmType::CLAMM,
        "",
        "Swap(address,address,int256,int256,uint160,uint128,int24)",
        "Mint(address,address,int24,int24,uint128,uint256,uint256)",
        "Burn(address,int24,int24,uint128,uint256,uint256)",
        "Collect(address,address,int24,int24,uint128,uint128)",
    );
    dex.set_initialize_event("Initialize(uint160,int24)");
    dex.set_flash_event("Flash(address,address,uint256,uint256,uint256,uint256)");

    let mut dex_extended = DexExtended::new(dex);

    dex_extended.set_initialize_event_hypersync_parsing(
        uniswap_v3::initialize::parse_initialize_event_hypersync,
    );
    dex_extended.set_swap_event_hypersync_parsing(uniswap_v3::swap::parse_swap_event_hypersync);
    dex_extended.set_mint_event_hypersync_parsing(uniswap_v3::mint::parse_mint_event_hypersync);
    dex_extended.set_burn_event_hypersync_parsing(uniswap_v3::burn::parse_burn_event_hypersync);
    dex_extended
        .set_collect_event_hypersync_parsing(uniswap_v3::collect::parse_collect_event_hypersync);
    dex_extended.set_flash_event_hypersync_parsing(uniswap_v3::flash::parse_flash_event_hypersync);

    dex_extended
        .set_initialize_event_rpc_parsing(uniswap_v3::initialize::parse_initialize_event_rpc);
    dex_extended.set_swap_event_rpc_parsing(uniswap_v3::swap::parse_swap_event_rpc);
    dex_extended.set_mint_event_rpc_parsing(uniswap_v3::mint::parse_mint_event_rpc);
    dex_extended.set_burn_event_rpc_parsing(uniswap_v3::burn::parse_burn_event_rpc);
    dex_extended.set_collect_event_rpc_parsing(uniswap_v3::collect::parse_collect_event_rpc);
    dex_extended.set_flash_event_rpc_parsing(uniswap_v3::flash::parse_flash_event_rpc);

    dex_extended
});
