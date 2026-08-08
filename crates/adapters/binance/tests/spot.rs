//! Integration tests for Binance Spot adapter.

#[path = "spot/data_client.rs"]
mod data_client;
#[path = "spot/exec_client.rs"]
mod exec_client;
#[path = "spot/http.rs"]
mod http;
#[path = "spot/websocket_streams.rs"]
mod websocket_streams;
#[path = "spot/websocket_trading.rs"]
mod websocket_trading;
