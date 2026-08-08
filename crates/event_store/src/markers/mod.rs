//! Data marker sidecar capture, schema types, canonical content hashes, and writer lane.
//!
//! The sidecar records the observed order of streaming data at the message-bus boundary as
//! compact cursor snapshots, joinable back to catalog rows. No market-data payload is
//! persisted.

#[cfg(feature = "persistence")]
mod join;

mod backend;
mod capture;
mod cursor;
mod extractor;
mod marker;
mod reader;
mod redb;
mod verifier;
mod writer;

#[cfg(test)]
mod test_support;

pub use backend::{MarkerBackend, MarkerManifest, MemoryMarkerBackend, StoredMarkerRecord};
pub use capture::DataMarkerCapture;
pub use cursor::CursorState;
pub use extractor::{DataMarkerExtractor, DataMarkerExtractorRegistry};
#[cfg(feature = "persistence")]
pub use join::{JoinedStream, join_at_entry};
pub use marker::{
    DataClass, DataCursorSnapshot, HiFiMarker, MarkerGap, MarkerGapReason, StreamCursor,
    StreamDictEntry, StreamSlot, compute_dict_hash, compute_gap_hash, compute_hifi_hash,
    compute_marker_hash,
};
pub use reader::MarkerReader;
pub use redb::RedbMarkerBackend;
pub use verifier::{
    MarkerCountKind, MarkerFinding, MarkerRecordKind, MarkerVerifier, MarkerVerifyReport,
};
pub use vibe_system::event_store::DataMarkerConfig;
pub use writer::{
    DEFAULT_MARKER_CHANNEL_CAPACITY, DEFAULT_MARKER_MAX_BATCH, DEFAULT_MARKER_MAX_LATENCY,
    MarkerMsg, MarkerWriter, MarkerWriterConfig,
};
