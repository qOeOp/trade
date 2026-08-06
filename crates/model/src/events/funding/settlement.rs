use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use vibe_core::{UUID4, UnixNanos};

use crate::{
    identifiers::{AccountId, InstrumentId, TraderId},
    types::{Currency, Price},
};

/// Represents a funding settlement for a perpetual swap instrument.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub struct FundingSettlement {
    /// The trader ID associated with the event.
    pub trader_id: TraderId,
    /// The instrument ID for the settlement.
    pub instrument_id: InstrumentId,
    /// The account ID receiving the settlement.
    pub account_id: AccountId,
    /// The funding rate applied for the settlement.
    pub rate: Decimal,
    /// The mark or settlement price used to value open positions.
    pub settlement_price: Price,
    /// The currency for resulting funding payments.
    pub currency: Currency,
    /// The unique identifier for the event.
    pub event_id: UUID4,
    /// UNIX timestamp (nanoseconds) when the event occurred.
    pub ts_event: UnixNanos,
    /// UNIX timestamp (nanoseconds) when the event was initialized.
    pub ts_init: UnixNanos,
}

impl FundingSettlement {
    /// Creates a new [`FundingSettlement`] instance.
    #[must_use]
    #[expect(clippy::too_many_arguments)]
    pub const fn new(
        trader_id: TraderId,
        instrument_id: InstrumentId,
        account_id: AccountId,
        rate: Decimal,
        settlement_price: Price,
        currency: Currency,
        event_id: UUID4,
        ts_event: UnixNanos,
        ts_init: UnixNanos,
    ) -> Self {
        Self {
            trader_id,
            instrument_id,
            account_id,
            rate,
            settlement_price,
            currency,
            event_id,
            ts_event,
            ts_init,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use rstest::rstest;
    use rust_decimal::Decimal;
    use vibe_core::{UUID4, UnixNanos};

    use super::*;
    use crate::{
        identifiers::{AccountId, InstrumentId, TraderId},
        types::{Currency, Price},
    };

    fn create_test_settlement() -> FundingSettlement {
        FundingSettlement::new(
            TraderId::from("TRADER-001"),
            InstrumentId::from("BTCUSDT-PERP.BINANCE"),
            AccountId::from("BINANCE-001"),
            Decimal::from_str("0.0001").unwrap(),
            Price::from("65000.00"),
            Currency::USDT(),
            UUID4::default(),
            UnixNanos::from(1_000_000_000),
            UnixNanos::from(2_000_000_000),
        )
    }

    #[rstest]
    fn test_funding_settlement_serialization() {
        let original = create_test_settlement();

        let json = serde_json::to_string(&original).unwrap();
        let deserialized: FundingSettlement = serde_json::from_str(&json).unwrap();

        assert_eq!(original, deserialized);
    }
}
