//! [VibeTrader](https://github.com/qOeOp/trade) adapter for the
//! [Bybit](https://www.bybit.com/) cryptocurrency exchange.
//!
//! The `vibe-bybit` crate provides client bindings (HTTP & WebSocket), data
//! models, and helper utilities that wrap the official **Bybit v5 API**.
//!
//! The official Bybit API reference can be found at <https://bybit-exchange.github.io/docs/v5/intro>.
//! All public links inside this crate reference the English version of the documentation.
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
// #![deny(clippy::missing_errors_doc)]
#![deny(clippy::missing_panics_doc)]
#![deny(rustdoc::broken_intra_doc_links)]

pub mod common;
pub mod config;
pub mod data;
pub mod execution;
pub mod factories;
pub mod http;
pub(crate) mod repay;
pub mod websocket;

#[cfg(feature = "python")]
pub mod python;
