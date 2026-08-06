//! BitMEX adapter constants including base URLs and the venue identifier.

use std::sync::LazyLock;

use ustr::Ustr;
use vibe_model::identifiers::{ClientId, Venue};

/// Venue identifier string.
pub const BITMEX: &str = "BITMEX";

/// Static venue instance.
pub static BITMEX_VENUE: LazyLock<Venue> = LazyLock::new(|| Venue::new(Ustr::from(BITMEX)));

/// Static client ID instance.
pub static BITMEX_CLIENT_ID: LazyLock<ClientId> =
    LazyLock::new(|| ClientId::new(Ustr::from(BITMEX)));

pub const BITMEX_WS_URL: &str = "wss://ws.bitmex.com/realtime";
pub const BITMEX_WS_TESTNET_URL: &str = "wss://ws.testnet.bitmex.com/realtime";
pub const BITMEX_HTTP_URL: &str = "https://www.bitmex.com/api/v1";
pub const BITMEX_HTTP_TESTNET_URL: &str = "https://testnet.bitmex.com/api/v1";

pub const BITMEX_WS_TOPIC_DELIMITER: char = ':';
