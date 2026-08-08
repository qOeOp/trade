//! Example trading strategies for backtesting and demonstration.

pub mod composite_market_maker;
pub mod delta_neutral_vol;
pub mod ema_cross;
pub mod grid_mm;
pub mod hurst_vpin_directional;

pub use composite_market_maker::{CompositeMarketMaker, CompositeMarketMakerConfig};
pub use delta_neutral_vol::{DeltaNeutralVol, DeltaNeutralVolConfig};
pub use ema_cross::{EmaCross, EmaCrossConfig};
pub use grid_mm::{GridMarketMaker, GridMarketMakerConfig};
pub use hurst_vpin_directional::{HurstVpinDirectional, HurstVpinDirectionalConfig};
