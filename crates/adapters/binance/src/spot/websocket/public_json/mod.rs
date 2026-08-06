//! Binance Spot public JSON WebSocket market-data streams.

pub mod client;
pub mod handler;
pub mod messages;
pub mod parse;

pub use client::BinanceSpotPublicJsonWebSocketClient;
