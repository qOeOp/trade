//! Test utilities and data management for [VibeTrader](https://github.com/qOeOp/trade).
//!
//! The `vibe-testkit` crate provides testing utilities including test data management,
//! file handling, and common testing patterns. This crate supports robust testing workflows
//! across the entire VibeTrader ecosystem with automated data downloads and validation:
//!
//! - **Test data management**: Automated downloading and caching of test datasets.
//! - **File utilities**: File integrity verification with SHA-256 checksums.
//! - **Path resolution**: Platform-agnostic test data path management.
//! - **Precision handling**: Support for both 64-bit and 128-bit precision test data.
//! - **Event collection**: Draining and correlating the data events a client emits.
//! - **Common patterns**: Reusable test utilities and helper functions.
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
//! This crate provides feature flags to control source code inclusion during compilation.
//!
//! - `datasets` (enabled by default): Enables test dataset discovery, download, validation, parsing,
//!   and loading.
//! - `testers` (enabled by default): Enables test actors, strategies, and in-memory cache backing.
//! - `python`: Enables Python bindings from [PyO3](https://pyo3.rs).
//! - `high-precision`: Enables [high-precision mode](https://github.com/qOeOp/trade/blob/main/docs/getting_started/installation.md#precision-mode) to use 128-bit value types.
//! - `extension-module`: Builds the crate as a Python extension module.
//!
//! Event collection utilities remain available without enabling a feature.

#![warn(rustc::all)]
#![warn(clippy::pedantic)]
#![deny(unsafe_code)]
#![deny(unsafe_op_in_unsafe_fn)]
#![deny(nonstandard_style)]
#![deny(missing_debug_implementations)]
#![deny(clippy::missing_errors_doc)]
#![deny(clippy::missing_panics_doc)]
#![deny(rustdoc::broken_intra_doc_links)]
#![cfg_attr(
    test,
    allow(
        clippy::cast_possible_truncation,
        clippy::cast_precision_loss,
        clippy::float_cmp,
        clippy::trivially_copy_pass_by_ref,
        reason = "test fixtures assert exact values and construct binary protocol bytes"
    )
)]

#[cfg(feature = "testers")]
pub mod cache;
#[cfg(feature = "datasets")]
pub mod common;
#[cfg(feature = "testers")]
pub mod components;
pub mod events;

#[cfg(feature = "postgres")]
pub mod postgres;

#[cfg(feature = "datasets")]
pub mod files;
#[cfg(feature = "datasets")]
pub mod itch;

#[cfg(feature = "testers")]
pub mod testers;

// Re-export for convenience
#[cfg(feature = "testers")]
pub use testers::{DataTester, DataTesterConfig, ExecTester, ExecTesterConfig};

#[cfg(feature = "python")]
pub mod python;
