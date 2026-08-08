//! Order emulation components for simulating order execution behavior.

use vibe_common::messages::execution::TradingCommand;
use vibe_model::events::OrderEventAny;

pub mod adapter;
pub mod config;
pub mod emulator;
pub mod handlers;

/// A message deferred while the emulator was already handling another call,
/// drained once the active call completes (msgbus dispatches synchronously,
/// so events the emulator publishes during handling would otherwise be dropped
/// or panic on the reentrant borrow).
#[derive(Debug)]
pub(crate) enum PendingMessage {
    Command(Box<TradingCommand>),
    Event(Box<OrderEventAny>),
}
