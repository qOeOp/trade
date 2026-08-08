use std::{collections::HashMap, sync::LazyLock};

use vibe_model::defi::DexType;

use crate::exchanges::extended::DexExtended;

mod pancakeswap_v3;
mod uniswap_v3;

pub use pancakeswap_v3::PANCAKESWAP_V3;
pub use uniswap_v3::UNISWAP_V3;

pub static BSC_DEX_EXTENDED_MAP: LazyLock<HashMap<DexType, &'static DexExtended>> =
    LazyLock::new(|| {
        let mut map = HashMap::new();
        map.insert(PANCAKESWAP_V3.dex.name, &*PANCAKESWAP_V3);
        map.insert(UNISWAP_V3.dex.name, &*UNISWAP_V3);
        map
    });
