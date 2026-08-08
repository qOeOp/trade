//! [VibeTrader](https://github.com/qOeOp/trade) adapter for
//! [Interactive Brokers](https://www.interactivebrokers.com).
//!
//! The `vibe-interactive-brokers` crate wraps the [`ibapi`](https://crates.io/crates/ibapi)
//! client and connects it to VibeTrader's live data, execution, historical data, and
//! instrument loading infrastructure.
//!
//! # VibeTrader
//!
//! [VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
//! engine for multi-asset, multi-venue trading systems.
//!
//! The system spans research, deterministic simulation, and live execution within a single
//! event-driven architecture, providing research-to-live semantic parity.
//!
//! # Feature flags
//!
//! This crate provides feature flags to control source code inclusion during compilation,
//! depending on the intended use case (Rust-only builds vs. Python bindings through PyO3).
//!
//! - `python`: Enables PyO3 bindings for configs, enums, the historical client, the instrument
//!   provider.
//! - `gateway`: Enables the Dockerized IB Gateway helper via
//!   [`bollard`](https://crates.io/crates/bollard), including its PyO3 bindings when combined with
//!   `python`.
//! - `extension-module`: Builds as a Python extension module (used together with `python` and `gateway`).
//!
//! # Documentation
//!
//! See the crate modules and integration guide for API details.

#![warn(rustc::all)]
#![deny(unsafe_code)]
// Clippy: allow style lints that would require large refactors across the adapter
#![allow(
    clippy::collapsible_if,
    clippy::if_not_else,
    clippy::uninlined_format_args,
    clippy::map_unwrap_or,
    clippy::redundant_clone,
    clippy::ignored_unit_patterns,
    clippy::items_after_statements,
    clippy::bool_to_int_with_if,
    clippy::cloned_instead_of_copied,
    clippy::option_if_let_else,
    clippy::type_complexity,
    clippy::await_holding_lock,
    clippy::module_inception,
    clippy::result_large_err,
    clippy::implicit_clone,
    clippy::single_char_pattern,
    clippy::bind_instead_of_map,
    clippy::explicit_iter_loop,
    clippy::too_many_arguments,
    clippy::missing_errors_doc,
    clippy::doc_overindented_list_items,
    clippy::needless_borrows_for_generic_args
)]
#![deny(nonstandard_style)]
#![deny(missing_debug_implementations)]
#![deny(clippy::missing_panics_doc)]
#![deny(rustdoc::broken_intra_doc_links)]

pub mod common;
pub mod config;
pub mod data;
pub mod error;
pub mod execution;
pub mod factories;
pub mod gateway;
pub mod historical;
pub mod providers;

#[cfg(feature = "python")]
pub mod python;
