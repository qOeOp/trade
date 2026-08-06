//! Container crate for VibeTrader.
//!
//! This crate re-exports the core, model, and common component crates as a small
//! stable entry point. Use the individual `vibe-*` crates for adapter,
//! backtest, live, and other crate-specific APIs.

#![warn(clippy::pedantic)]

pub use vibe_common as common;
pub use vibe_core as core;
pub use vibe_model as model;
