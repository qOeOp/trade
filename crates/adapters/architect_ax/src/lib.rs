//! [VibeTrader](https://github.com/qOeOp/trade) adapter for Ax's [AX Exchange](https://architect.exchange).
//!
//! [AX Exchange](https://architect.exchange) is the world's first centralized and regulated
//! exchange for perpetual futures on traditional underlying asset classes (FX, rates, metals,
//! energy, stock indexes). Designed for institutional and professional traders, it combines
//! innovations from digital asset perpetual exchanges with the safety and risk management of
//! traditional futures exchanges. Licensed under the [Bermuda Monetary Authority (BMA)](https://www.bma.bm/).
//!
//! The `vibe-architect-ax` crate provides client bindings (HTTP & WebSocket), data models, and
//! helper utilities that wrap the official AX Exchange API.
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
//! This crate provides feature flags to control source code inclusion during compilation:
//!
//! - `python`: Enables Python bindings via [PyO3](https://pyo3.rs).
//! - `extension-module`: Builds as a Python extension module (used together with `python`).
//!
//! # Documentation
//!
//! - API reference: <https://docs.architect.exchange/api-reference/>
//! - Integration guide: <https://github.com/qOeOp/trade/blob/main/docs/integrations/architect_ax.md>

#![warn(rustc::all)]
#![deny(unsafe_code)]
#![deny(nonstandard_style)]
#![deny(missing_debug_implementations)]
#![deny(clippy::missing_errors_doc)]
#![deny(clippy::missing_panics_doc)]
#![deny(rustdoc::broken_intra_doc_links)]

pub mod common;
pub mod config;
pub mod data;
pub mod execution;
pub mod factories;
pub mod http;
pub mod websocket;

#[cfg(feature = "python")]
pub mod python;
