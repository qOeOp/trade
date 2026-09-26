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
