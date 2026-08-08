//! Configuration for the EMA crossover strategy.

use vibe_model::{
    identifiers::{InstrumentId, StrategyId},
    types::Quantity,
};

use crate::strategy::StrategyConfig;

/// Configuration for the dual-EMA crossover strategy.
#[derive(Debug, Clone, bon::Builder)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(module = "vibe_trader.trading", from_py_object)
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass(module = "vibe_trader.trading")
)]
pub struct EmaCrossConfig {
    /// Base strategy configuration.
    #[builder(default = StrategyConfig {
        strategy_id: Some(StrategyId::from("EMA_CROSS-001")),
        order_id_tag: Some("001".to_string()),
        ..Default::default()
    })]
    pub base: StrategyConfig,
    /// Instrument to subscribe to and trade.
    pub instrument_id: InstrumentId,
    /// Order quantity for each crossover signal.
    pub trade_size: Quantity,
    /// Fast EMA period. Shorter periods react faster.
    #[builder(default = 10)]
    pub fast_period: usize,
    /// Slow EMA period. Longer periods filter noise.
    #[builder(default = 50)]
    pub slow_period: usize,
}
