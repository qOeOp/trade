//! Shared primitives and utilities for the Kraken adapter.

use ahash::AHashMap;
use vibe_model::{
    identifiers::{InstrumentId, Symbol},
    instruments::InstrumentAny,
};

pub mod consts;
pub mod credential;
pub mod enums;
pub mod models;
pub mod order_params;
pub mod parse;
pub mod urls;

pub(crate) mod serialization;

/// Looks up a Kraken instrument from a preloaded map snapshot by raw exchange symbol.
pub(crate) fn lookup_instrument_in_snapshot<'a>(
    instruments: &'a AHashMap<InstrumentId, InstrumentAny>,
    raw_symbol: &str,
) -> Option<&'a InstrumentAny> {
    let instrument_id = InstrumentId::new(Symbol::new(raw_symbol), *consts::KRAKEN_VENUE);
    instruments.get(&instrument_id)
}
