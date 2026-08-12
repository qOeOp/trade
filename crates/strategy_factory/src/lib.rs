//! Minimal Strategy Factory product boundary.
//!
//! This crate deliberately stops before economic execution. It owns the frozen
//! intent, deterministic artifact, restricted Wasm boundary, and source-data
//! projection. Mature trading-engine owners remain unchanged.

pub mod artifact;
pub mod data;
pub mod decision;
pub mod intent;
pub mod pilot;
pub mod runtime;

pub use pilot::{
    NEXT_OPEN_NOT_ADMITTED_CODE, PilotNotAdmitted, PreparedPilot, prepare_frozen_pilot,
    run_frozen_pilot,
};
