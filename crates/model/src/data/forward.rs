//! Forward price data type for derivatives instruments.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use vibe_core::UnixNanos;

use crate::identifiers::InstrumentId;

/// Represents a forward/underlying price for a derivatives instrument.
///
/// This is a general derivatives concept used for ATM determination in option chains
/// and other forward-price dependent calculations.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(module = "vibe_trader.model", from_py_object)
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass(module = "vibe_trader.model")
)]
pub struct ForwardPrice {
    /// The instrument ID this forward price applies to.
    pub instrument_id: InstrumentId,
    /// The forward/underlying price.
    pub forward_price: Decimal,
    /// The underlying index name (e.g. "SYN.BTC-28MAR25"). Exchange-specific metadata.
    pub underlying_index: Option<String>,
    /// UNIX timestamp (nanoseconds) when the event occurred.
    pub ts_event: UnixNanos,
    /// UNIX timestamp (nanoseconds) when the instance was initialized.
    pub ts_init: UnixNanos,
}

impl ForwardPrice {
    /// Creates a new [`ForwardPrice`] instance.
    #[must_use]
    pub fn new(
        instrument_id: InstrumentId,
        forward_price: Decimal,
        underlying_index: Option<String>,
        ts_event: UnixNanos,
        ts_init: UnixNanos,
    ) -> Self {
        Self {
            instrument_id,
            forward_price,
            underlying_index,
            ts_event,
            ts_init,
        }
    }
}
