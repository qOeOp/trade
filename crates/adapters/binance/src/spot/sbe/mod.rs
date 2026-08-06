//! Binance SBE (Simple Binary Encoding) codec implementations.
//!
//! This module contains:
//! - `cursor`: Re-export of shared cursor utilities from `vibe_serialization::sbe`.
//! - `error`: Re-export of shared decode error types from `vibe_serialization::sbe`.
//! - `generated`: Generated codecs for the Spot REST/WebSocket API (schema 3:5).
//! - `stream`: Hand-written codecs for market data streams (schema 1:0).
//!
//! The generated codecs come from Binance's official SBE schema using
//! Real Logic's SBE generator. The stream codecs are hand-written for the
//! 4 market data stream message types.

pub mod cursor;
pub mod error;
#[path = "generated/mod.rs"]
pub mod generated;
pub mod stream;

pub use cursor::SbeCursor;
pub use error::{MAX_GROUP_SIZE, SbeDecodeError};
pub use generated as spot;
pub use generated::{
    ReadBuf, SBE_SCHEMA_ID, SBE_SCHEMA_VERSION, SbeErr, SbeResult,
    message_header_codec::MessageHeaderDecoder,
};
