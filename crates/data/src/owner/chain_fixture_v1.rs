//! The instrument the ordered Owner chain's fixtures commit and read back.
//!
//! This is a fixture of the chain, not a product choice: nothing here says which instrument the
//! product studies. It is venue-qualified because the native replay path parses an instrument as
//! `SYMBOL.VENUE` (`InstrumentId`, which splits on the last `.`), so a bare symbol never reaches
//! it. Every chain entry that writes or compares this instrument names this constant instead of
//! repeating the text, because entries share Owner custody through one database: a request written
//! by one entry under one spelling is a conflicting request when a later entry rewrites it under
//! another.

/// The chain fixtures' instrument, not a product choice.
pub const CHAIN_FIXTURE_INSTRUMENT_V1: &str = "AAPL.XNAS";

/// The correlation the chain's market base submits its initial PIT request under.
///
/// The base's PIT request cannot be rebuilt from constants: its Instrument Master digest, its
/// universe selection and its clock evidence come from the store it runs in. Its correlation and its
/// requester are constants, so an entry that binds a Design to the base's corpus finds the base's
/// snapshot as the one initial snapshot whose request carries both. The base commits its snapshot
/// directly rather than through the initial-intake submission, so nothing keys the snapshot by its
/// correlation; the lookup refuses by name when more than one initial snapshot carries both.
pub const CHAIN_MARKET_BASE_PIT_CORRELATION_V1: [u8; 32] = [174; 32];

/// The Research request the chain's market base requests its PIT snapshot for; its requester is
/// the one R&D writes for that request.
pub const CHAIN_MARKET_BASE_RESEARCH_REQUEST_V1: [u8; 32] = [190; 32];
