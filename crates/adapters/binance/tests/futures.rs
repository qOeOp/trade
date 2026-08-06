//! Integration tests for Binance Futures adapter.

#[path = "futures/data_client.rs"]
mod data_client;
#[path = "futures/exec_client.rs"]
mod exec_client;
#[path = "futures/http.rs"]
mod http;
#[path = "futures/websocket_streams.rs"]
mod websocket_streams;
#[path = "futures/websocket_trading.rs"]
mod websocket_trading;
