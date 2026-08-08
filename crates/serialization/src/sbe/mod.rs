//! Generic SBE (Simple Binary Encoding) codec utilities.
//!
//! This module provides:
//! - [`SbeCursor`]: Zero-copy byte cursor with typed little-endian readers.
//! - [`SbeWriter`]: Pre-sized byte writer with typed little-endian writers.
//! - [`SbeEncodeError`] and [`SbeDecodeError`]: Common SBE codec errors.
//! - [`market`]: Hand-written Vibe market-data SBE codecs.
//! - [`GroupSizeEncoding`] and [`GroupSize16Encoding`]: Group header decoders.
//! - [`decode_var_string8`]: varString8 decoder helper.

pub mod cursor;
pub mod error;
pub mod market;
pub mod primitives;
pub mod writer;

pub use cursor::SbeCursor;
pub use error::{MAX_GROUP_SIZE, SbeDecodeError, SbeEncodeError};
pub use market::{DataAny, FromSbe, FromSbeReuse, ToSbe};
pub use primitives::{GroupSize16Encoding, GroupSizeEncoding, decode_var_string8};
pub use writer::SbeWriter;
