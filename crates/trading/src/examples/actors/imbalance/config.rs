//! Configuration for the book imbalance actor.

use vibe_model::identifiers::{ActorId, InstrumentId};

/// Configuration for the order book imbalance actor.
#[derive(Debug, Clone, bon::Builder)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(module = "vibe_trader.trading", from_py_object)
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass(module = "vibe_trader.trading")
)]
pub struct BookImbalanceActorConfig {
    /// Instruments to subscribe to.
    pub instrument_ids: Vec<InstrumentId>,
    /// How often (in update count) to log a progress line. Set to 0 to disable.
    #[builder(default = 100)]
    pub log_interval: u64,
    /// Actor identifier. Defaults to `BOOK_IMBALANCE-001`.
    pub actor_id: Option<ActorId>,
}
