use std::sync::LazyLock;

use ustr::Ustr;
use vibe_model::identifiers::{ClientId, Venue};

/// Venue identifier string.
pub const BLOCKCHAIN: &str = "BLOCKCHAIN";

/// Static venue instance.
pub static BLOCKCHAIN_VENUE: LazyLock<Venue> = LazyLock::new(|| Venue::new(Ustr::from(BLOCKCHAIN)));

/// Static client ID instance.
pub static BLOCKCHAIN_CLIENT_ID: LazyLock<ClientId> =
    LazyLock::new(|| ClientId::new(Ustr::from(BLOCKCHAIN)));
