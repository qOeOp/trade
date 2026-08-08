use serde::Deserialize;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Deserialize)]
pub(crate) struct TardisErrorResponse {
    pub code: u64,
    pub message: String,
}

/// HTTP errors for the Tardis HTTP client.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// An HTTP request failed at the transport level.
    #[error("HTTP request failed: {0}")]
    Request(String),

    /// The Tardis API returned an error response.
    #[error("Tardis API error [{code}]: {message}")]
    ApiError {
        /// HTTP status code.
        status: u16,
        /// Tardis error code.
        code: u64,
        /// Tardis error message.
        message: String,
    },

    /// Failed to deserialize the JSON response body.
    #[error("Failed to parse response body as JSON: {0}")]
    JsonParse(#[from] serde_json::Error),

    /// Failed to parse the response into a Tardis domain type.
    #[error("Failed to parse response as Tardis type: {0}")]
    ResponseParse(String),
}
