//! Polymarket-specific custom data types.
//!
//! These types carry Polymarket RTDS domain data through the Vibe data engine as
//! [`CustomData`](vibe_model::data::CustomData).

use vibe_core::UnixNanos;
use vibe_model::types::Price;
use vibe_persistence_macros::custom_data;

/// Polymarket RTDS crypto price sample from the `crypto_prices` topic.
///
/// The adapter normalizes both live `update` frames and `subscribe` backfill
/// snapshots into this per-tick custom data type.
#[custom_data(pyo3, no_arrow, stub_module = "vibe_trader.adapters.polymarket")]
pub struct PolymarketRtdsCryptoPrice {
    /// Lowercase venue symbol, e.g. `btcusdt`.
    pub symbol: String,
    /// Current spot price.
    #[custom_data_field(serde)]
    pub value: Price,
    /// Price measurement timestamp in Unix milliseconds.
    pub price_timestamp_ms: u64,
    /// RTDS envelope timestamp in Unix milliseconds.
    pub message_timestamp_ms: u64,
    /// UNIX timestamp (nanoseconds) when the price event occurred.
    pub ts_event: UnixNanos,
    /// UNIX timestamp (nanoseconds) when the instance was initialized.
    pub ts_init: UnixNanos,
}

/// Polymarket RTDS equity price sample from the `equity_prices` topic.
///
/// The adapter normalizes both live `update` frames and `subscribe` backfill
/// snapshots into this per-tick custom data type.
#[custom_data(pyo3, no_arrow, stub_module = "vibe_trader.adapters.polymarket")]
pub struct PolymarketRtdsEquityPrice {
    /// Lowercase venue symbol, e.g. `aapl`, `eurusd`, or `xauusd`.
    pub symbol: String,
    /// Spot price rounded to the venue's float payload precision.
    #[custom_data_field(serde)]
    pub value: Price,
    /// Full-precision spot price when supplied, otherwise the venue's `value`.
    #[custom_data_field(serde)]
    pub full_accuracy_value: Price,
    /// Price measurement timestamp in Unix milliseconds.
    pub price_timestamp_ms: u64,
    /// RTDS envelope timestamp in Unix milliseconds.
    pub message_timestamp_ms: u64,
    /// System receipt timestamp in Unix milliseconds when present.
    #[custom_data_field(serde)]
    pub received_at_ms: Option<u64>,
    /// `true` when the venue is carrying forward the last known value.
    pub is_carried_forward: bool,
    /// UNIX timestamp (nanoseconds) when the price event occurred.
    pub ts_event: UnixNanos,
    /// UNIX timestamp (nanoseconds) when the instance was initialized.
    pub ts_init: UnixNanos,
}

/// Registers Polymarket custom data types.
///
/// Safe to call multiple times (idempotent via internal `Once` guards).
pub fn register_polymarket_custom_data() {
    let _ = vibe_model::data::ensure_custom_data_json_registered::<PolymarketRtdsCryptoPrice>();
    let _ = vibe_model::data::ensure_custom_data_json_registered::<PolymarketRtdsEquityPrice>();
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::register_polymarket_custom_data;

    #[rstest]
    fn test_register_polymarket_custom_data_is_idempotent() {
        register_polymarket_custom_data();
        register_polymarket_custom_data();
    }
}
