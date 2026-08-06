//! Kraken Spot WebSocket v2 API client implementation.
//!
//! Provides real-time market data streams including:
//! - Ticker (quotes)
//! - Trades
//! - Order book (L2 and L3)
//! - OHLC bars

pub mod client;
pub mod enums;
pub mod handler;
pub mod level_3;
pub mod messages;
pub mod parse;

pub(crate) mod level_2;
