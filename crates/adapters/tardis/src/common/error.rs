//! Adapter-level error types aggregating HTTP and Machine Server errors.

/// Adapter-level error aggregating HTTP and WebSocket errors.
#[derive(Debug, thiserror::Error)]
pub enum TardisError {
    /// An HTTP API error.
    #[error("HTTP error: {0}")]
    Http(#[from] crate::http::error::Error),

    /// A Machine Server WebSocket error.
    #[error("Machine error: {0}")]
    Machine(#[from] crate::machine::Error),
}

impl TardisError {
    /// Returns `true` if the error is likely transient and the operation can be
    /// retried.
    #[must_use]
    pub fn is_retryable(&self) -> bool {
        match self {
            Self::Http(crate::http::error::Error::ApiError { status, .. }) => {
                *status == 429 || *status >= 500
            }
            Self::Http(crate::http::error::Error::Request(_)) => true,
            Self::Machine(crate::machine::Error::ConnectFailed(_)) => true,
            Self::Machine(crate::machine::Error::ConnectionClosed { .. }) => true,
            _ => false,
        }
    }
}
