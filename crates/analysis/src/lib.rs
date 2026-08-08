//! Portfolio analysis and performance metrics for [VibeTrader](https://github.com/qOeOp/trade).
//!
//! The `vibe-analysis` crate provides portfolio analysis tools and performance
//! statistics for evaluating trading strategies and portfolios. This includes return-based metrics,
//! PnL-based statistics, and risk measurements commonly used in quantitative finance:
//!
//! - Portfolio analyzer for tracking account states and positions.
//! - Extensive collection of performance statistics and risk metrics.
//! - Flexible statistic calculation framework supporting different data sources.
//! - Support for multi-currency portfolios and unrealized PnL calculations.
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
    reason = "domain terms such as returns/realized and pnl/pnls are intentionally parallel"
)]
#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    reason = "analysis math casts between usize/i32/i64/f64 with values bounded by sample counts"
)]
#![cfg_attr(
    test,
    allow(
        clippy::float_cmp,
        clippy::unreadable_literal,
        reason = "analysis tests assert exact float outputs and reference statistic constants"
    )
)]

pub mod analyzer;
pub mod snapshot;
pub mod statistic;
pub mod statistics;

pub use snapshot::PortfolioStatistics;

#[cfg(feature = "python")]
pub mod python;

use std::collections::BTreeMap;

use vibe_core::UnixNanos;

/// Type alias for time-indexed returns data used in portfolio analysis.
///
/// Maps timestamps to return values for time-series analysis of portfolio performance.
pub type Returns = BTreeMap<UnixNanos, f64>;
