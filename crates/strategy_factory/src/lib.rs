//! Minimal Strategy Factory product boundary.
//!
//! It owns the frozen intent, deterministic artifact, restricted Wasm boundary,
//! and the thin application adapter into existing data and trading-engine owners.

pub mod application;
pub mod artifact;
mod data;
pub mod decision;
pub mod intent;
pub mod pilot;
pub mod receipt;
pub mod runtime;

pub use application::{PilotRun, run_frozen_pilot};
pub use pilot::{PreparedPilot, prepare_frozen_pilot};
pub use receipt::{EconomicDisposition, TrialReceipt};
