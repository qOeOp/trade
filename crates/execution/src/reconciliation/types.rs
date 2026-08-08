//! Shared reconciliation value types.

use indexmap::IndexMap;
use rust_decimal::Decimal;
use vibe_model::{
    enums::{OrderSide, PositionSideSpecified},
    identifiers::VenueOrderId,
    reports::{FillReport, OrderStatusReport},
};

/// Immutable snapshot of fill data for position simulation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct FillSnapshot {
    /// The venue order ID.
    pub venue_order_id: VenueOrderId,
    /// The order side (BUY or SELL).
    pub side: OrderSide,
    /// The fill quantity.
    pub qty: Decimal,
    /// The fill price.
    pub px: Decimal,
    /// The event timestamp (nanoseconds).
    pub ts_event: u64,
}

/// Represents a position snapshot from the venue.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct VenuePositionSnapshot {
    /// The position side (Long, Short, or Flat).
    pub side: PositionSideSpecified,
    /// The position quantity (always positive, even for Short).
    pub qty: Decimal,
    /// The average entry price (can be zero for Flat positions).
    pub avg_px: Decimal,
}

/// Result of the fill adjustment process.
#[derive(Debug, Clone, PartialEq)]
pub(super) enum FillAdjustmentResult {
    /// No adjustment needed - return fills unchanged.
    NoAdjustment,
    /// Add synthetic opening fill to oldest lifecycle.
    AddSyntheticOpening {
        /// The synthetic fill to add at the beginning.
        synthetic_fill: FillSnapshot,
        /// All existing fills to keep.
        existing_fills: Vec<FillSnapshot>,
    },
    /// Replace entire current lifecycle with single synthetic fill.
    ReplaceCurrentLifecycle {
        /// The single synthetic fill representing the entire position.
        synthetic_fill: FillSnapshot,
        /// The first venue order ID to use.
        first_venue_order_id: VenueOrderId,
    },
    /// Filter fills to current lifecycle only (after last zero-crossing).
    FilterToCurrentLifecycle {
        /// Timestamp of the last zero-crossing.
        last_zero_crossing_ts: u64,
        /// Fills from current lifecycle.
        current_lifecycle_fills: Vec<FillSnapshot>,
    },
}

impl FillSnapshot {
    /// Create a new fill snapshot.
    #[must_use]
    pub(super) fn new(
        venue_order_id: VenueOrderId,
        side: OrderSide,
        qty: Decimal,
        px: Decimal,
        ts_event: u64,
    ) -> Self {
        Self {
            venue_order_id,
            side,
            qty,
            px,
            ts_event,
        }
    }

    /// Return signed direction multiplier: +1 for BUY, -1 for SELL.
    #[must_use]
    pub(super) fn direction(&self) -> i8 {
        match self.side {
            OrderSide::Buy => 1,
            OrderSide::Sell => -1,
            _ => 0,
        }
    }
}

/// Result of processing fill reports for reconciliation.
#[derive(Debug, Clone)]
pub struct ReconciliationResult {
    /// Order status reports keyed by venue order ID.
    pub orders: IndexMap<VenueOrderId, OrderStatusReport>,
    /// Fill reports keyed by venue order ID.
    pub fills: IndexMap<VenueOrderId, Vec<FillReport>>,
}
