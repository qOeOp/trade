//! Event-driven option chain aggregation and snapshot publishing.

pub mod aggregator;
pub mod atm_tracker;
pub mod constants;
pub mod handlers;
pub mod manager;

pub use aggregator::{OptionChainAggregator, RebalanceAction};
pub use atm_tracker::AtmTracker;
pub use handlers::{OptionChainGreeksHandler, OptionChainQuoteHandler, OptionChainSlicePublisher};
pub use manager::OptionChainManager;
