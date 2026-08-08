//! Trading domain model for [VibeTrader](https://github.com/qOeOp/trade).
//!
//! The `vibe-model` crate provides a type-safe domain model that forms the backbone of the
//! framework and can serve as the foundation for building algorithmic trading systems.
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
//! - `ffi`: Enables the C foreign function interface (FFI) from [cbindgen](https://github.com/mozilla/cbindgen).
//! - `python`: Enables Python bindings from [PyO3](https://pyo3.rs).
//! - `arrow`: Enables Apache Arrow schema and `RecordBatch` registries for custom data.
//! - `python-arrow`: Enables Python bindings together with `PyArrow` `RecordBatch` bridging.
//! - `stubs`: Enables type stubs for use in testing scenarios.
//! - `high-precision`: Enables [high-precision mode](https://github.com/qOeOp/trade/blob/main/docs/getting_started/installation.md#precision-mode) to use 128-bit value types.
//! - `defi`: Enables the DeFi (Decentralized Finance) domain model.
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
#![cfg_attr(test, allow(clippy::large_stack_arrays))]
#![allow(
    clippy::inline_always,
    reason = "hot-path functions use #[inline(always)] intentionally for constant-folding"
)]
#![allow(
    clippy::manual_let_else,
    reason = "match can be clearer than let-else for some patterns"
)]
#![allow(
    clippy::redundant_closure_for_method_calls,
    reason = "causes clippy ICE on Rust 1.94; matches the workaround in workspace Cargo.toml"
)]
#![allow(
    clippy::float_cmp,
    reason = "numeric domain crate: float equality comparisons are pervasive and intentional"
)]
#![allow(
    clippy::unsafe_derive_deserialize,
    reason = "serde derives on types with unsafe methods for FFI are intentional"
)]
#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss,
    reason = "numeric domain crate: casts are fundamental to fixed-point arithmetic and type conversions"
)]
#![allow(
    clippy::trivially_copy_pass_by_ref,
    reason = "changing pass-by-ref to pass-by-value would break FFI and Python binding signatures"
)]
#![allow(
    clippy::similar_names,
    reason = "domain terminology creates naturally similar names (bid/ask, base/quote)"
)]
#![allow(
    clippy::too_many_lines,
    reason = "trading domain functions with match arms over many variants are complex by nature"
)]
#![allow(
    clippy::match_same_arms,
    reason = "identical match arms are sometimes intentional for documentation and readability"
)]
#![allow(
    clippy::unused_self,
    reason = "PyO3 methods require &self for Python binding even when Rust impl does not use it"
)]
#![allow(
    clippy::many_single_char_names,
    reason = "math formulas (Black-Scholes, Greeks) use standard single-character variable names"
)]
#![allow(
    clippy::large_types_passed_by_value,
    reason = "PyO3 methods require owned values extracted from Python objects"
)]

pub mod accounts;
pub mod currencies;
pub mod data;
pub mod enums;
pub mod events;
pub mod identifiers;
pub mod instruments;
pub mod macros;
pub mod orderbook;
pub mod orders;
pub mod position;
pub mod reports;
pub mod types;
pub mod venues;

pub(crate) mod expressions;

#[cfg(feature = "ffi")]
pub mod ffi;

#[cfg(feature = "python")]
pub mod python;

#[cfg(any(test, feature = "stubs"))]
pub mod stubs;

#[cfg(feature = "defi")]
pub mod defi;
