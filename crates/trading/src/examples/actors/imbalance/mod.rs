//! Order book imbalance actor.
//!
//! Subscribes to order book deltas for a set of instruments and tracks the
//! cumulative bid/ask quoted volume. For each batch of deltas, sums the
//! resting size at each updated price level per side and computes:
//!
//! `imbalance = (bid_volume - ask_volume) / (bid_volume + ask_volume)`
//!
//! The result ranges from -1.0 (all volume on the ask side) to +1.0 (all
//! volume on the bid side). This measures which side of the book receives
//! more quoted volume across updates, not the incremental change in volume.
//! In a betting exchange context, bids correspond to "back" orders and asks
//! to "lay" orders.

pub mod actor;
pub mod config;

#[cfg(test)]
mod tests;

pub use actor::{BookImbalanceActor, ImbalanceState};
pub use config::BookImbalanceActorConfig;
