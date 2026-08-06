//! Tardis adapter constants.

use std::{num::NonZeroU32, sync::LazyLock};

use ustr::Ustr;
use vibe_model::identifiers::{ClientId, Venue};
use vibe_network::ratelimiter::quota::Quota;

/// The Tardis adapter identifier string.
pub const TARDIS: &str = "TARDIS";

/// Static venue instance.
pub static TARDIS_VENUE: LazyLock<Venue> = LazyLock::new(|| Venue::new(Ustr::from(TARDIS)));

/// Static client ID instance.
pub static TARDIS_CLIENT_ID: LazyLock<ClientId> =
    LazyLock::new(|| ClientId::new(Ustr::from(TARDIS)));

/// Environment variable name for the Tardis API key.
pub const TARDIS_API_KEY: &str = "TARDIS_API_KEY";

/// Environment variable name for the Tardis Machine WebSocket URL.
pub const TARDIS_MACHINE_WS_URL: &str = "TARDIS_MACHINE_WS_URL";

/// Rate limit key for Tardis REST API requests.
pub const TARDIS_REST_RATE_KEY: &str = "tardis_rest";

/// Default rate limit for Tardis REST API (10 requests per second).
pub static TARDIS_REST_QUOTA: LazyLock<Quota> = LazyLock::new(|| {
    Quota::per_second(NonZeroU32::new(10).expect("non-zero")).expect("valid quota")
});

/// Maximum reconnection delay for the Tardis Machine WebSocket in seconds.
pub const WS_MAX_RECONNECT_DELAY_SECS: u64 = 30;

/// Initial reconnection delay for the Tardis Machine WebSocket in seconds.
pub const WS_INITIAL_RECONNECT_DELAY_SECS: u64 = 1;

/// Heartbeat (ping) interval for the Tardis Machine WebSocket in seconds.
pub const WS_HEARTBEAT_INTERVAL_SECS: u64 = 10;
