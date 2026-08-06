//! Risk engine for [VibeTrader](https://github.com/qOeOp/trade).
//!
//! The `vibe-risk` crate provides risk management capabilities including pre-trade
//! order validation, position sizing calculations, and trading controls. This system ensures
//! trading operations remain within defined risk parameters and regulatory constraints:
//!
//! - **Risk engine**: Central risk management orchestration with configurable trading states.
//! - **Order validation**: Pre-trade checks for price, quantity, notional limits, and market conditions.
//! - **Position sizing**: Fixed-risk position sizing calculations with commission and exchange rate support.
//! - **Trading controls**: Rate limiting, balance validation, and exposure management.
//! - **Account protection**: Multi-currency balance checks and margin requirement validation.
//!
//! # VibeTrader
//!
//! [VibeTrader](https://github.com/qOeOp/trade) is a Rust-native engine for multi-asset,
//! multi-venue trading systems.
//!
//! The system spans research, deterministic simulation, and live execution within a single
//! event-driven architecture, providing research-to-live semantic parity.
//!
//! # Feature Flags
//!
//! This crate provides feature flags to control source code inclusion during compilation,
//! depending on the intended use case, i.e. whether to provide Python bindings
//! for the `vibe_trader` Python package,
//! or as part of a Rust only build.
//!
//! - `python`: Enables Python bindings from [PyO3](https://pyo3.rs).
//! - `extension-module`: Builds the crate as a Python extension module.

#![warn(rustc::all)]
#![warn(clippy::pedantic)]
#![deny(unsafe_code)]
#![deny(unsafe_op_in_unsafe_fn)]
#![deny(nonstandard_style)]
#![deny(missing_debug_implementations)]
#![deny(clippy::missing_errors_doc)]
#![deny(clippy::missing_panics_doc)]
#![deny(rustdoc::broken_intra_doc_links)]

pub mod engine;
pub mod sizing;

#[cfg(feature = "python")]
pub mod python;

// Re-exports
pub use engine::RiskEngine;
