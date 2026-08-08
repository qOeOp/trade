//! Blockchain data adapter for [VibeTrader](https://github.com/qOeOp/trade).
//!
//! The `vibe-blockchain` crate provides a high-performance, universal, extensible adapter for ingesting
//! DeFi data from decentralized exchanges (DEXs), liquidity pools, and on-chain events.
//! It enables you to power analytics pipelines and trading strategies with real-time and historical
//! on-chain data.
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
//! - `hypersync`: Enables the [HyperSync](https://envio.dev/#hypersync) client integration.
//! - `python`: Enables Python bindings from [PyO3](https://pyo3.rs).
//! - `extension-module`: Builds as a Python extension module.
//! - `turmoil`: Enables deterministic network simulation testing with [turmoil](https://github.com/tokio-rs/turmoil).

#![warn(rustc::all)]
#![allow(
    clippy::pedantic,
    reason = "shield the CLI --all-features pedantic gate until the blockchain slice migrates"
)]
#![deny(unsafe_code)]
#![deny(nonstandard_style)]
#![deny(missing_debug_implementations)]
#![deny(clippy::missing_errors_doc)]
#![deny(clippy::missing_panics_doc)]
#![deny(rustdoc::broken_intra_doc_links)]

pub mod config;
pub mod constants;
pub mod contracts;
pub mod decode;
pub mod events;
pub mod math;
pub mod reporting;
pub mod rpc;

#[cfg(feature = "hypersync")]
pub mod cache;

#[cfg(feature = "hypersync")]
pub mod execution;

#[cfg(feature = "hypersync")]
pub mod data;

#[cfg(feature = "hypersync")]
pub mod exchanges;

#[cfg(feature = "hypersync")]
pub mod factories;

#[cfg(feature = "hypersync")]
pub mod hypersync;

#[cfg(feature = "hypersync")]
pub mod services;

#[cfg(feature = "python")]
pub mod python;
