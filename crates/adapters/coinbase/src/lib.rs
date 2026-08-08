//! [VibeTrader](https://github.com/qOeOp/trade) adapter for
//! [Coinbase Advanced Trade](https://docs.cdp.coinbase.com/coinbase-app/docs/advanced-trade-apis).
//!
//! The `vibe-coinbase` crate provides integration with the Coinbase Advanced Trade API for
//! trading spot, futures, and perpetuals on the Coinbase exchange.
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
//! - `extension-module`: Builds as a Python extension module.
//!
//! [High-precision mode](https://github.com/qOeOp/trade/blob/main/docs/getting_started/installation.md#precision-mode) (128-bit value types) is enabled by default.

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
pub mod provider;
pub mod websocket;

#[cfg(feature = "python")]
pub mod python;

pub use crate::{
    config::{CoinbaseDataClientConfig, CoinbaseExecClientConfig},
    data::CoinbaseDataClient,
    execution::CoinbaseExecutionClient,
    factories::{CoinbaseDataClientFactory, CoinbaseExecutionClientFactory},
    http::client::{CoinbaseHttpClient, CoinbaseRawHttpClient},
    provider::CoinbaseInstrumentProvider,
};
