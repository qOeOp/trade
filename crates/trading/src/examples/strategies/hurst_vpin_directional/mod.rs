//! Hurst/VPIN directional strategy.
//!
//! Subscribes to dollar bars, trades, and quotes for a single instrument.
//! Estimates the Hurst exponent by rescaled range over dollar-bar log returns,
//! computes VPIN from trade aggressor flow per completed bar, and opens a
//! position on the next quote tick when both signals align. Exits on regime
//! decay or holding-time cap.

pub mod config;
pub mod strategy;

#[cfg(test)]
mod tests;

pub use config::HurstVpinDirectionalConfig;
pub use strategy::HurstVpinDirectional;
