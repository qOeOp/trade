//! Grid market making strategy with inventory-based skewing.
//!
//! Subscribes to quotes for a single instrument and maintains a symmetric grid
//! of limit orders around the mid-price. Orders are only replaced when the
//! mid-price moves beyond a configurable threshold, allowing resting orders to
//! persist across ticks. The grid is shifted by a skew proportional to the
//! current net position to discourage inventory buildup (Avellaneda-Stoikov
//! inspired).
//!
//! Max-position enforcement uses worst-case same-side exposure: `net_position`
//! drives the skew offset, while `worst_long`/`worst_short` include both open
//! positions and all pending buy/sell orders to account for async cancel latency.

pub mod config;
pub mod strategy;

#[cfg(test)]
mod tests;

pub use config::GridMarketMakerConfig;
pub use strategy::GridMarketMaker;
