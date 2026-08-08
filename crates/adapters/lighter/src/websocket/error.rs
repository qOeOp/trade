//! WebSocket error taxonomy.

use thiserror::Error;
use vibe_network::error::SendError;

/// Errors emitted by the Lighter WebSocket client.
#[derive(Debug, Error)]
pub enum LighterWsError {
    /// Underlying transport failure.
    #[error("network error: {0}")]
    Network(String),
    /// Send-side transport failure. Carries the structured [`SendError`]
    /// so retry classifiers can match on the variant rather than the formatted message.
    #[error("transport error: {0}")]
    Transport(#[from] SendError),
    /// Authentication failure.
    #[error("authentication error: {0}")]
    Authentication(String),
    /// Failed to parse a wire frame.
    #[error("parse error: {0}")]
    Parse(String),
    /// Generic client error.
    #[error("client error: {0}")]
    Client(String),
    /// The handler accepted a signed transaction command but disappeared
    /// before reporting whether it queued the frame to the network writer.
    #[error("sendTx outcome unknown: {0}")]
    SendTxOutcomeUnknown(String),
}
