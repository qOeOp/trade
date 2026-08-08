//! Binance Futures WebSocket clients.
//!
//! This module provides WebSocket clients for Binance Futures:
//!
//! ## Market Data and User Data Streams (`streams`)
//!
//! Pub/sub pattern for real-time market data and user data via JSON WebSocket:
//! - Trade streams, order book updates, mark price, klines
//! - User data stream (order updates, account updates) via listenKey
//!
//! ## Trading API (`trading`)
//!
//! Request/response pattern for order management via `ws-fapi.binance.com`:
//! - Order placement, cancellation, and modification
//! - USD-M only (COIN-M does not support WebSocket Trading API)

pub mod streams;
pub mod trading;

pub use streams::BinanceFuturesWebSocketClient;
pub use trading::BinanceFuturesWsTradingClient;
