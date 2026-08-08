//! Error types for the Derive WebSocket client.

use serde_json::Value;
use thiserror::Error;

use crate::signing::auth::AuthError;

/// Result alias for WebSocket operations.
pub type Result<T> = std::result::Result<T, DeriveWsError>;

/// Errors raised by the Derive WebSocket client.
#[derive(Debug, Error)]
pub enum DeriveWsError {
    /// Transport-level failure (handshake, send, broken pipe).
    #[error("transport error: {0}")]
    Transport(String),

    /// JSON (de)serialization failed for an outbound or inbound frame.
    #[error("serde error: {0}")]
    Serde(#[from] serde_json::Error),

    /// JSON-RPC error envelope returned by the venue.
    #[error("JSON-RPC error {code}: {message}")]
    JsonRpc {
        /// Venue-defined error code.
        code: i64,
        /// Human-readable error message.
        message: String,
        /// Optional structured diagnostic payload.
        data: Option<Value>,
    },

    /// Awaited request response was not delivered (handler dropped the sender).
    #[error("request `{method}` cancelled before response was received")]
    RequestCancelled {
        /// Method that was awaiting a response.
        method: String,
    },

    /// No response arrived within the configured request timeout. The request
    /// was sent, so the outcome of a state-changing write is unknown.
    #[error("request `{method}` timed out before response was received")]
    Timeout {
        /// Method that was awaiting a response.
        method: String,
    },

    /// Auth header construction failed (e.g. clock skew, signer error).
    #[error("auth error: {0}")]
    Auth(#[from] AuthError),

    /// The WebSocket session did not authenticate before a request could proceed.
    #[error("authentication failed for `{operation}`: {reason}")]
    Authentication {
        /// Operation attempting or awaiting authentication.
        operation: String,
        /// Authentication failure detail.
        reason: String,
    },

    /// One or more channels were rejected in a subscribe result.
    #[error("subscription failed: {details}")]
    Subscription {
        /// Per-channel failure detail returned by the venue.
        details: String,
    },

    /// Private operation invoked without credentials configured on the client.
    #[error("missing credentials for `{operation}`")]
    MissingCredentials {
        /// Operation that requires authentication.
        operation: String,
    },

    /// Client used before `connect()` completed.
    #[error("WebSocket client is not connected")]
    NotConnected,
}

impl DeriveWsError {
    /// Constructs a [`DeriveWsError::Transport`] error.
    #[must_use]
    pub fn transport(msg: impl Into<String>) -> Self {
        Self::Transport(msg.into())
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use serde_json::json;

    use super::*;

    #[rstest]
    fn test_transport_constructor_carries_message() {
        let err = DeriveWsError::transport("broken pipe");
        assert!(err.to_string().contains("broken pipe"));
    }

    #[rstest]
    fn test_jsonrpc_error_renders_code_and_message() {
        let err = DeriveWsError::JsonRpc {
            code: -32601,
            message: "Method not found".to_string(),
            data: Some(json!({"method": "public/foo"})),
        };
        let rendered = err.to_string();
        assert!(rendered.contains("-32601"));
        assert!(rendered.contains("Method not found"));
    }

    #[rstest]
    fn test_missing_credentials_names_operation() {
        let err = DeriveWsError::MissingCredentials {
            operation: "public/login".to_string(),
        };
        assert!(err.to_string().contains("public/login"));
    }

    #[rstest]
    fn test_authentication_error_names_operation_and_reason() {
        let err = DeriveWsError::Authentication {
            operation: "private/order".to_string(),
            reason: "session recovery failed".to_string(),
        };

        assert!(err.to_string().contains("private/order"));
        assert!(err.to_string().contains("session recovery failed"));
    }
}
