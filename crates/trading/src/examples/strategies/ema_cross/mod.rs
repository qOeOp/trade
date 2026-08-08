//! Dual-EMA crossover strategy.
//!
//! Subscribes to quotes for a single instrument, maintains fast and slow
//! exponential moving averages, and submits market orders when the fast
//! EMA crosses above (buy) or below (sell) the slow EMA.

pub mod config;
pub mod strategy;

#[cfg(test)]
mod tests;

pub use config::EmaCrossConfig;
pub use strategy::EmaCross;
