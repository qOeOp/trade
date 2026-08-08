//! Module-level constants for option chain rebalancing behavior.

/// Hysteresis band for ATM rebalancing (0.0..=1.0).
/// Price must cross this fraction of the gap to the next strike before ATM shifts.
/// E.g., 0.6 means price must move 60% past the midpoint between two strikes.
pub const DEFAULT_REBALANCE_HYSTERESIS: f64 = 0.6;

/// Minimum time between rebalances in nanoseconds (5 seconds).
pub const DEFAULT_REBALANCE_COOLDOWN_NS: u64 = 5_000_000_000;
