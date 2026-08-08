//! Data persistence and storage management for [VibeTrader](https://github.com/qOeOp/trade).
//!
//! The `vibe-persistence` crate provides data persistence capabilities for storing and retrieving
//! trading data, state, and configuration.
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
//! - `cloud`: Enables cloud storage backends (S3, Azure, GCP, HTTP) via `object_store`.
//! - `python`: Enables Python bindings from [PyO3](https://pyo3.rs) (auto-enables `cloud`).
//! - `high-precision`: Enables [high-precision mode](https://github.com/qOeOp/trade/blob/main/docs/getting_started/installation.md#precision-mode) to use 128-bit value types.
//! - `extension-module`: Builds the crate as a Python extension module.

#![warn(rustc::all)]
#![warn(clippy::pedantic)]
#![deny(nonstandard_style)]
#![deny(unsafe_op_in_unsafe_fn)]
#![deny(rustdoc::broken_intra_doc_links)]
// #![deny(clippy::missing_errors_doc)]

pub mod backend;
#[cfg(feature = "python")]
pub mod config;
pub mod parquet;
pub mod test_data;

#[cfg(feature = "python")]
pub mod python;
