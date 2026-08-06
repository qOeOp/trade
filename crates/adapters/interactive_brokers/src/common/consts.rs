//! Core constants shared across the Interactive Brokers adapter components.

use std::sync::LazyLock;

use ustr::Ustr;
use vibe_model::identifiers::{ClientId, Venue};

/// Long-form venue identifier string.
pub const INTERACTIVE_BROKERS: &str = "INTERACTIVE_BROKERS";

/// Short-form venue identifier string used as the canonical venue and client ID.
pub const IB: &str = "IB";

/// Static venue instance.
pub static IB_VENUE: LazyLock<Venue> = LazyLock::new(|| Venue::new(Ustr::from(IB)));

/// Static client ID instance.
pub static IB_CLIENT_ID: LazyLock<ClientId> = LazyLock::new(|| ClientId::new(Ustr::from(IB)));

/// Default host for IB Gateway/TWS.
pub const DEFAULT_HOST: &str = "127.0.0.1";

/// Default port for IB Gateway.
pub const DEFAULT_PORT: u16 = 4002;

/// Default port for TWS.
pub const DEFAULT_TWS_PORT: u16 = 7497;

/// Default client ID.
pub const DEFAULT_CLIENT_ID: i32 = 1;
