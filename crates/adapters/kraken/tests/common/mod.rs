//! Shared helpers for the Kraken dispatch integration tests.
//!
//! Rust compiles each file in `tests/` as a standalone binary, so files placed
//! here under `tests/common/` are only pulled in via `mod common;` from the
//! per-product dispatch test files.

#![allow(dead_code)]

use std::sync::Arc;

use rust_decimal::Decimal;
use vibe_common::messages::ExecutionEvent;
use vibe_core::{AtomicMap, time::get_atomic_clock_realtime};
use vibe_kraken::websocket::dispatch::OrderIdentity;
use vibe_live::ExecutionEventEmitter;
use vibe_model::{
    enums::{AccountType, OrderSide, OrderType},
    identifiers::{AccountId, ClientOrderId, InstrumentId, StrategyId, TraderId},
    types::Quantity,
};

pub(crate) fn test_emitter() -> (
    ExecutionEventEmitter,
    tokio::sync::mpsc::UnboundedReceiver<ExecutionEvent>,
) {
    let clock = get_atomic_clock_realtime();
    let mut emitter = ExecutionEventEmitter::new(
        clock,
        TraderId::from("TESTER-001"),
        AccountId::from("KRAKEN-001"),
        AccountType::Margin,
        None,
    );
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    emitter.set_sender(tx);
    (emitter, rx)
}

pub(crate) fn drain_events(
    rx: &mut tokio::sync::mpsc::UnboundedReceiver<ExecutionEvent>,
) -> Vec<ExecutionEvent> {
    let mut events = Vec::new();
    while let Ok(e) = rx.try_recv() {
        events.push(e);
    }
    events
}

pub(crate) fn account_id() -> AccountId {
    AccountId::from("KRAKEN-001")
}

pub(crate) fn make_identity(
    instrument_id: &str,
    side: OrderSide,
    order_type: OrderType,
) -> OrderIdentity {
    OrderIdentity {
        strategy_id: StrategyId::from("EXEC_TESTER-001"),
        instrument_id: InstrumentId::from(instrument_id),
        order_side: side,
        order_type,
        quantity: Quantity::from("0.0001"),
    }
}

pub(crate) fn empty_string_map() -> Arc<AtomicMap<String, ClientOrderId>> {
    Arc::new(AtomicMap::new())
}

pub(crate) fn empty_instrument_id_map() -> Arc<AtomicMap<String, InstrumentId>> {
    Arc::new(AtomicMap::new())
}

pub(crate) fn empty_quantity_map() -> Arc<AtomicMap<String, Quantity>> {
    Arc::new(AtomicMap::new())
}

pub(crate) fn empty_decimal_map() -> Arc<AtomicMap<String, Decimal>> {
    Arc::new(AtomicMap::new())
}
