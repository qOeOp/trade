//! [VibeTrader](https://github.com/qOeOp/trade) adapter for the
//! [Binance](https://www.binance.com/) cryptocurrency exchange.
//!
//! The `vibe-binance` crate provides client bindings (HTTP & WebSocket), data
//! models, and helper utilities that wrap the official **Binance API**. Live data and
//! execution clients are available for:
//!
//! - Spot markets, including Binance US (api.binance.com)
//! - USD-M Futures (fapi.binance.com)
//! - COIN-M Futures (dapi.binance.com)
//!
//! The crate also includes shared enums, endpoint constants, URL routing, and
//! credential plumbing for adjacent Binance surfaces such as Margin and European Options.
//! Those surfaces do not have live data or execution clients in this crate.
//!
//! The official Binance API reference can be found at <https://binance-docs.github.io/apidocs/>.
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
//! depending on the intended use case (Rust-only builds vs. Python bindings through PyO3).
//!
//! - `python`: Enables Python bindings via [PyO3](https://pyo3.rs).
//! - `extension-module`: Builds as a Python extension module (used together with `python`).
//!
//! [High-precision mode](https://github.com/qOeOp/trade/blob/main/docs/getting_started/installation.md#precision-mode) (128-bit value types) is enabled by default.
//!
//! # Documentation
//!
//! See the crate modules and integration guide for API details.

#![warn(rustc::all)]
#![deny(unsafe_code)]
#![deny(nonstandard_style)]
#![deny(missing_debug_implementations)]
#![deny(clippy::missing_errors_doc)]
#![deny(clippy::missing_panics_doc)]
#![deny(rustdoc::broken_intra_doc_links)]

pub mod arrow;
pub mod common;
pub mod config;
pub mod data_types;
pub mod factories;
pub mod futures;
pub mod spot;

#[cfg(feature = "python")]
pub mod python;
