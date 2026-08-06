//! Shared types for the Polymarket execution module.

use vibe_core::UnixNanos;
use vibe_model::{
    enums::{OrderSide, TimeInForce},
    identifiers::VenueOrderId,
    orders::OrderAny,
    types::{Price, Quantity},
};

use crate::{
    common::{consts::CANCEL_ALREADY_DONE, enums::PolymarketOrderType},
    http::models::PolymarketOrder,
};

/// Classifies cancel rejection reasons to eliminate duplicate if/else blocks.
pub(crate) enum CancelOutcome {
    AlreadyDone,
    Rejected(String),
}

impl CancelOutcome {
    pub(crate) fn classify(reason: &str) -> Self {
        if reason.contains(CANCEL_ALREADY_DONE) {
            Self::AlreadyDone
        } else {
            Self::Rejected(reason.to_string())
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct LimitOrderSubmitRequest {
    pub(crate) token_id: String,
    pub(crate) side: OrderSide,
    pub(crate) price: Price,
    pub(crate) quantity: Quantity,
    pub(crate) time_in_force: TimeInForce,
    pub(crate) post_only: bool,
    pub(crate) neg_risk: bool,
    pub(crate) expire_time: Option<UnixNanos>,
    pub(crate) tick_decimals: u32,
}

#[derive(Clone, Debug)]
pub(crate) struct SignedLimitOrderSubmission {
    pub(crate) order: PolymarketOrder,
    pub(crate) order_type: PolymarketOrderType,
    pub(crate) post_only: bool,
    pub(crate) expected_venue_order_id: VenueOrderId,
}

#[derive(Clone, Debug)]
pub(crate) struct BatchLimitOrderContext {
    pub(crate) order: OrderAny,
    pub(crate) request: LimitOrderSubmitRequest,
    pub(crate) size_precision: u8,
    pub(crate) price_precision: u8,
}
