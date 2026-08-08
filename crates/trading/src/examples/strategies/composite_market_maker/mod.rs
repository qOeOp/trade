//! Composite market making strategy with book-mid quoting and external-signal skew.
//!
//! Subscribes to quotes for two instruments: a target instrument (the market the
//! strategy quotes on) and a signal instrument (typically a `SyntheticInstrument`
//! published by the data engine, but any instrument with a quote stream works).
//! Quotes a single bid and a single ask around the target's book mid, with two
//! independent skew terms applied on top:
//!
//! - **Inventory skew** discourages position buildup. With `inventory_skew_factor`
//!   positive, both sides shift down by `factor * net_position`: the bid moves
//!   further from the market when long, the ask moves closer.
//! - **Signal skew** lifts both quotes when the signal trades above its baseline.
//!   The residual is `(signal_mid - baseline) / baseline`. With
//!   `signal_skew_factor` positive, both sides shift up by `factor * residual`,
//!   which captures expected drift inferred from the signal.
//!
//! Max-position enforcement uses worst-case same-side exposure: open positions
//! plus all pending buy/sell orders are projected forward so the cap holds even
//! while async cancels are in flight (same pattern as `GridMarketMaker`).

pub mod config;
pub mod strategy;

#[cfg(test)]
mod tests;

pub use config::CompositeMarketMakerConfig;
pub use strategy::CompositeMarketMaker;
