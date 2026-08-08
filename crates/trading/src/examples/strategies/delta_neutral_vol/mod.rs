//! Delta-neutral short volatility hedger.
//!
//! Tracks a short OTM call and put (strangle) on a configurable option
//! family and delta-hedges the net Greek exposure with the underlying
//! perpetual swap. Rehedges when portfolio delta exceeds a configurable
//! threshold or on a periodic timer.
//!
//! This strategy subscribes to venue-provided Greeks via
//! `subscribe_option_greeks` and uses them to track portfolio delta.
//! Strike selection uses a simple strike-percentile heuristic at startup.

pub mod config;
pub mod strategy;

#[cfg(test)]
mod tests;

pub use config::DeltaNeutralVolConfig;
pub use strategy::DeltaNeutralVol;
