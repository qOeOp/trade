/// Error type for Coinbase WebSocket operations.
#[derive(Debug, Clone, thiserror::Error)]
pub enum CoinbaseWsError {
    /// URL parsing failed.
    #[error("URL parsing failed: {0}")]
    UrlParsing(String),

    /// Message serialization failed.
    #[error("message serialization failed: {0}")]
    MessageSerialization(String),

    /// Message deserialization failed.
    #[error("message deserialization failed: {0}")]
    MessageDeserialization(String),

    /// WebSocket connection failed.
    #[error("WebSocket connection failed: {0}")]
    Connection(String),

    /// Channel send failed.
    #[error("channel send failed: {0}")]
    ChannelSend(String),

    /// Authentication failed.
    #[error("authentication failed: {0}")]
    Auth(String),
}

impl CoinbaseWsError {
    /// Returns true if the error is retryable (connection or channel failures).
    #[must_use]
    pub fn is_retryable(&self) -> bool {
        matches!(self, Self::Connection(_) | Self::ChannelSend(_))
    }
}
