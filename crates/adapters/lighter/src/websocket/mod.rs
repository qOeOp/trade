//! WebSocket client surface for Lighter streaming endpoints.

pub mod client;
pub mod error;
pub mod handler;
pub mod messages;
pub mod parse;

pub(crate) mod account_state;
pub(crate) mod dispatch;

pub use client::LighterWebSocketClient;
pub use error::LighterWsError;
pub use messages::{
    LighterMarketSelection, LighterWsChannel, LighterWsChannelKind, LighterWsRequest,
    SendTxRejectionSource, VibeWsMessage,
};
