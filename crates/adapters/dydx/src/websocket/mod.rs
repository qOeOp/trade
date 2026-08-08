//! WebSocket client implementation for the dYdX v4 API.
//!
//! This module provides real-time streaming connectivity to dYdX WebSocket endpoints,
//! supporting:
//!
//! - **Market data streaming**: Trades, order books, candles (bars), and market updates (oracle prices).
//! - **Private data streaming**: Subaccount updates, orders, fills, and positions.
//! - **Channel subscription management**: Subscribe and unsubscribe to public and private channels.
//! - **Automatic reconnection**: Reconnection with state restoration and resubscription.
//! - **Message classification**: Deserializes raw WebSocket JSON into venue-specific types.
//!
//! # Architecture
//!
//! The WebSocket client follows a two-layer architecture:
//!
//! - **Outer client** ([`client::DydxWebSocketClient`]): Orchestrates connection lifecycle, manages
//!   subscriptions, and maintains state accessible to Python via `Arc<DashMap>`.
//! - **Inner handler** ([`handler::FeedHandler`]): Runs in a dedicated Tokio task as the I/O boundary,
//!   deserializing raw WebSocket messages into venue-specific types.
//!
//! Communication between layers uses lock-free channels:
//! - Commands flow from client to handler via `mpsc` channel.
//! - Venue-specific messages flow from handler to client via `mpsc` channel.
//!
//! # References
//!
//! - dYdX v4 WebSocket API: <https://docs.dydx.trade/developers/indexer/websockets>

pub mod client;
pub mod dispatch;
pub mod enums;
pub mod error;
pub mod handler;
pub mod messages;
pub mod parse;

pub use client::DydxWebSocketClient;
pub use dispatch::{DydxWsDispatchState, OrderIdentity, fill_report_to_order_filled};
pub use enums::{
    DydxWsChannel, DydxWsMessage, DydxWsMessageType, DydxWsOperation, DydxWsOutputMessage,
};
pub use error::{DydxWebSocketError, DydxWsError, DydxWsResult};
