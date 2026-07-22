pub mod order_book;
pub mod segment;

pub use order_book::{
    BookGap, BookSnapshot, DepthUpdate, OrderBook, OrderBookError, ProjectionOutcome,
    SequenceDecision, SequenceTracker, Snapshot, normalize_decimal, project_updates,
};
pub use segment::{
    FinalizedSegment, RecoveredSegment, RotatingSegmentWriter, SegmentDescriptor, SegmentError,
    StreamingSegmentWriter, recover_segment, salvage_segment,
};
