//! Bus capture adapter: the seam that converts dispatched bus messages into event store
//! entries.
//!
//! See `README.md` "Capture surface" and "Architecture" for the SPEC contract; the
//! [`BusCaptureAdapter`] implements the dispatch-boundary side of that contract by
//! consulting an [`EncoderRegistry`] allow-list and forwarding encoded entries to the
//! [`crate::EventStoreWriter`].

pub mod adapter;
pub mod builtins;
pub mod encoder;
pub mod registry;

pub use adapter::{BusCaptureAdapter, CaptureError};
pub use builtins::{
    PAYLOAD_TYPE_ACCOUNT_STATE, PAYLOAD_TYPE_FILL_REPORT, PAYLOAD_TYPE_ORDER_FILLED,
    PAYLOAD_TYPE_ORDER_STATUS_REPORT, PAYLOAD_TYPE_POSITION_STATUS_REPORT,
    PAYLOAD_TYPE_SUBMIT_ORDER, default_registry, encode_account_state, encode_fill_report,
    encode_order_filled, encode_order_status_report, encode_position_status_report,
    encode_submit_order, register_default,
};
pub use encoder::{Encode, EncodeError, EncodedPayload, TypedEncoder};
pub use registry::{EncoderRegistry, HeadersExtractor, TypedHeadersExtractor};
