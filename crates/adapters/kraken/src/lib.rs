//! Kraken exchange adapter for VibeTrader.
//!
//! This adapter provides integration with the Kraken cryptocurrency exchange,
//! supporting both Spot and Futures markets.
//!
//! # Features
//!
//! - REST API v2 client for market data and account operations.
//! - WebSocket v2 client for real-time data feeds.
//! - Support for Spot and Futures markets.
//! - Instrument, ticker, trade, orderbook, and OHLC data.
//! - Prepared for execution support (orders, positions, balances).
//!
//! # API Documentation
//!
//! - [Kraken REST API](https://docs.kraken.com/api/)
//! - [Kraken WebSocket v2](https://docs.kraken.com/websockets-v2/)
//!
//! # Feature Flags
//!
//! This crate provides feature flags to control source code inclusion during compilation,
//! depending on the intended use case, i.e. whether to provide Python bindings
//! for the `vibe_trader` Python package,
//! or as part of a Rust only build.
//!
//! - `python`: Enables Python bindings from [PyO3](https://pyo3.rs).
//! - `extension-module`: Builds as a Python extension module.
//!
//! [High-precision mode](https://github.com/qOeOp/trade/blob/main/docs/getting_started/installation.md#precision-mode) (128-bit value types) is enabled by default.

pub mod common;
pub mod config;
pub mod data;
pub mod execution;
pub mod factories;
pub mod http;
pub mod websocket;

#[cfg(feature = "python")]
pub mod python;

pub use config::{KrakenDataClientConfig, KrakenExecClientConfig};
pub use data::{KrakenFuturesDataClient, KrakenSpotDataClient};
pub use execution::{KrakenFuturesExecutionClient, KrakenSpotExecutionClient};
pub use http::{
    KrakenFuturesHttpClient, KrakenFuturesRawHttpClient, KrakenHttpError, KrakenSpotHttpClient,
    KrakenSpotRawHttpClient,
};
pub use websocket::{
    futures::client::KrakenFuturesWebSocketClient, spot_v2::client::KrakenSpotWebSocketClient,
};
