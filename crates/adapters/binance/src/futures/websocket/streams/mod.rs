//! Binance Futures WebSocket market data and user data streams.
//!
//! Handles both public market data and private user data (execution events)
//! via a single JSON WebSocket connection.

pub mod client;
pub mod error;
pub mod handler;
pub mod messages;
pub mod parse_data;
pub mod parse_exec;

pub(crate) mod dispatch;
pub(crate) mod recovery;

pub use client::BinanceFuturesWebSocketClient;
