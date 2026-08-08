//! Core constants shared across the AX Exchange adapter components.

use std::sync::LazyLock;

use ustr::Ustr;
use vibe_model::identifiers::{ClientId, Venue};

/// Venue identifier string.
pub const AX: &str = "AX";

/// Static venue instance.
pub static AX_VENUE: LazyLock<Venue> = LazyLock::new(|| Venue::new(Ustr::from(AX)));

/// Static client ID instance.
pub static AX_CLIENT_ID: LazyLock<ClientId> = LazyLock::new(|| ClientId::new(Ustr::from(AX)));

/// Order tag identifying orders placed by VibeTrader.
pub const AX_VIBE_TAG: &str = "Vibe";

// HTTP endpoints
pub const AX_HTTP_URL: &str = "https://gateway.architect.exchange/api";
pub const AX_HTTP_SANDBOX_URL: &str = "https://gateway.sandbox.architect.exchange/api";

// HTTP order management endpoints (separate base URL)
pub const AX_ORDERS_URL: &str = "https://gateway.architect.exchange/orders";
pub const AX_ORDERS_SANDBOX_URL: &str = "https://gateway.sandbox.architect.exchange/orders";

// Market data WebSocket endpoints
pub const AX_WS_PUBLIC_URL: &str = "wss://gateway.architect.exchange/md/ws";
pub const AX_WS_SANDBOX_PUBLIC_URL: &str = "wss://gateway.sandbox.architect.exchange/md/ws";

// Orders WebSocket endpoints (requires Bearer token authentication)
pub const AX_WS_PRIVATE_URL: &str = "wss://gateway.architect.exchange/orders/ws";
pub const AX_WS_SANDBOX_PRIVATE_URL: &str = "wss://gateway.sandbox.architect.exchange/orders/ws";

/// Authentication token lifetime requested from AX.
pub const AX_AUTH_TOKEN_TTL_SECS: i32 = 3_600;

/// Delay before refreshing a valid authentication token.
pub const AX_AUTH_TOKEN_REFRESH_INTERVAL: std::time::Duration =
    std::time::Duration::from_secs(30 * 60);

/// Timeout for one authentication-token request.
pub const AX_AUTH_TOKEN_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// Delay before retrying a failed authentication-token refresh.
pub const AX_AUTH_TOKEN_REFRESH_RETRY_DELAY: std::time::Duration =
    std::time::Duration::from_secs(30);

/// Timeout for awaiting account registration during execution client connect.
pub const AX_ACCOUNT_REGISTRATION_TIMEOUT_SECS: f64 = 30.0;

/// Default lookback for funding rate polling (days).
pub const AX_FUNDING_RATE_LOOKBACK_DAYS: i64 = 7;

/// Maximum lookback span (days) accepted by the AX `/fills` endpoint.
pub const AX_FILLS_MAX_LOOKBACK_DAYS: i64 = 7;

// Error message substrings for detecting specific rejection reasons
pub const AX_POST_ONLY_REJECT: &str = "post-only order would cross the book";
