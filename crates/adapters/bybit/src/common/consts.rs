//! Core constants shared across the Bybit adapter components.

use std::sync::LazyLock;

use ustr::Ustr;
use vibe_model::identifiers::{ClientId, Venue};

/// Venue identifier string.
pub const BYBIT: &str = "BYBIT";

/// Static venue instance.
pub static BYBIT_VENUE: LazyLock<Venue> = LazyLock::new(|| Venue::new(Ustr::from(BYBIT)));

/// Static client ID instance.
pub static BYBIT_CLIENT_ID: LazyLock<ClientId> = LazyLock::new(|| ClientId::new(Ustr::from(BYBIT)));

pub const BYBIT_PONG: &str = "pong";

pub const BYBIT_BASE_COIN: &str = "baseCoin";
pub const BYBIT_QUOTE_COIN: &str = "quoteCoin";

/// See <https://www.bybit.com/en/broker> for further details.
pub const BYBIT_VIBE_BROKER_ID: &str = "Qy000878";

pub const BYBIT_HTTP_URL: &str = "https://api.bybit.com";
pub const BYBIT_HTTP_TESTNET_URL: &str = "https://api-testnet.bybit.com";

pub const BYBIT_WS_PUBLIC_URL: &str = "wss://stream.bybit.com/v5/public/linear";
pub const BYBIT_WS_PRIVATE_URL: &str = "wss://stream.bybit.com/v5/private";

pub const BYBIT_WS_TESTNET_PUBLIC_URL: &str = "wss://stream-testnet.bybit.com/v5/public/linear";
pub const BYBIT_WS_TESTNET_PRIVATE_URL: &str = "wss://stream-testnet.bybit.com/v5/private";

pub const BYBIT_WS_TOPIC_DELIMITER: char = '.';

pub const BYBIT_DEFAULT_ORDERBOOK_DEPTH: u32 = 50;
