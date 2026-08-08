//! Live execution client implementations for the Kraken adapter.
//!
//! This module provides separate execution clients for Kraken Spot and Futures markets:
//!
//! - [`KrakenSpotExecutionClient`] - For Spot markets using WebSocket v2
//! - [`KrakenFuturesExecutionClient`] - For Futures markets
//!
//! # Supported Operations
//!
//! ## Common
//! - Order submission (market, limit, stop)
//! - Order modification
//! - Order cancellation (single, batch, cancel-all)
//! - Account state and balance queries
//!
//! ## Futures Only
//! - Position management

mod futures;
mod spot;

pub use futures::KrakenFuturesExecutionClient;
pub use spot::KrakenSpotExecutionClient;

use crate::http::error::KrakenHttpError;

#[derive(Debug)]
enum CancelCommandFailure {
    LocalValidation(String),
    Ambiguous(String),
    VenueReject(String),
}

impl CancelCommandFailure {
    fn local(message: impl Into<String>) -> Self {
        Self::LocalValidation(message.into())
    }

    fn ambiguous(message: impl Into<String>) -> Self {
        Self::Ambiguous(message.into())
    }

    fn venue_reject(message: impl Into<String>) -> Self {
        Self::VenueReject(message.into())
    }
}

fn classify_cancel_http_failure(error: KrakenHttpError) -> CancelCommandFailure {
    match error {
        KrakenHttpError::AuthenticationError(message) => CancelCommandFailure::local(message),
        KrakenHttpError::MissingCredentials => CancelCommandFailure::local("Missing credentials"),
        KrakenHttpError::NetworkError(message) | KrakenHttpError::ParseError(message) => {
            CancelCommandFailure::ambiguous(message)
        }
        KrakenHttpError::ApiError(message) => {
            CancelCommandFailure::ambiguous(format_cancel_api_errors(&message))
        }
    }
}

fn classify_spot_single_cancel_http_failure(error: KrakenHttpError) -> CancelCommandFailure {
    match error {
        KrakenHttpError::ApiError(message) if contains_spot_cancel_rejection(&message) => {
            CancelCommandFailure::venue_reject(format_cancel_api_errors(&message))
        }
        KrakenHttpError::ApiError(message) => {
            CancelCommandFailure::ambiguous(format_cancel_api_errors(&message))
        }
        other => classify_cancel_http_failure(other),
    }
}

fn contains_spot_cancel_rejection(errors: &[String]) -> bool {
    errors.iter().any(|e| e.trim_start().starts_with("EOrder:"))
}

fn format_cancel_api_errors(errors: &[String]) -> String {
    if errors.is_empty() {
        "unknown error (empty error list)".to_string()
    } else {
        errors.join(", ")
    }
}
