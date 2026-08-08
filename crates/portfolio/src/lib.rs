//! Portfolio management and risk analysis for [VibeTrader](https://github.com/qOeOp/trade).
//!
//! The `vibe-portfolio` crate provides portfolio management capabilities including
//! real-time position tracking, performance calculations, and risk management. This includes
//! sophisticated portfolio analytics and multi-currency support:
//!
//! - **Portfolio tracking**: Real-time portfolio state management with position and balance monitoring.
//! - **Account management**: Support for cash and margin accounts across multiple venues.
//! - **Performance calculations**: Real-time unrealized PnL, realized PnL, and mark-to-market valuations.
//! - **Risk management**: Initial margin calculations, maintenance margin tracking, and exposure monitoring.
//! - **Multi-currency support**: Currency conversion and cross-currency risk exposure analysis.
//! - **Configuration options**: Flexible settings for price types, currency conversion, and portfolio behavior.
//!
//! The crate handles complex portfolio scenarios including multi-venue trading, currency conversions,
//! and sophisticated margin calculations for both live trading and backtesting environments.
//!
//! # VibeTrader
//!
//! [VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
//! engine for multi-asset, multi-venue trading systems.
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
#![allow(
    clippy::similar_names,
    reason = "portfolio timing and domain terms such as interval_ms/interval_ns are intentionally parallel"
)]
#![allow(
    clippy::manual_let_else,
    reason = "match and if-let early returns are consistent with surrounding portfolio flow code"
)]
#![allow(
    clippy::single_match_else,
    reason = "match can be clearer than if-let-else for some portfolio state transitions"
)]
#![allow(
    clippy::too_many_lines,
    reason = "portfolio calculation and event update flows exceed the default threshold by design"
)]

pub mod config;
pub mod manager;
pub mod portfolio;

#[cfg(feature = "python")]
pub mod python;

// Re-exports
pub use portfolio::Portfolio;
