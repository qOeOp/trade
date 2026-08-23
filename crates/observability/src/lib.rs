//! Read-only, rebuildable observability projections.
//!
//! This crate has no Owner storage, command, retry, or trading dependency.
//! Future adapters may read canonical Owner outboxes through the ports module,
//! while business facts and terminal decisions remain opaque and Owner-controlled.

pub mod envelope;
pub mod ports;
pub mod projection;
