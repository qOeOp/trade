//! Binance Futures WebSocket Trading API error types.

use std::fmt::Display;

/// Binance Futures WebSocket Trading API error type.
#[derive(Debug)]
pub enum BinanceFuturesWsApiError {
    /// General client error.
    ClientError(String),
    /// Handler not available (channel closed).
    HandlerUnavailable(String),
    /// Connection error.
    ConnectionError(String),
    /// Request rejected by venue.
    RequestRejected {
        /// Error code from venue.
        code: i32,
        /// Error message from venue.
        msg: String,
    },
    /// JSON parsing or serialization error.
    JsonError(String),
    /// Request ID not found in pending requests.
    UnknownRequestId(String),
}

impl Display for BinanceFuturesWsApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ClientError(msg) => write!(f, "Client error: {msg}"),
            Self::HandlerUnavailable(msg) => write!(f, "Handler unavailable: {msg}"),
            Self::ConnectionError(msg) => write!(f, "Connection error: {msg}"),
            Self::RequestRejected { code, msg } => {
                write!(f, "Request rejected [{code}]: {msg}")
            }
            Self::JsonError(msg) => write!(f, "JSON error: {msg}"),
            Self::UnknownRequestId(id) => write!(f, "Unknown request ID: {id}"),
        }
    }
}

impl std::error::Error for BinanceFuturesWsApiError {}

/// Result type for Binance Futures WebSocket Trading API operations.
pub type BinanceFuturesWsApiResult<T> = Result<T, BinanceFuturesWsApiError>;
