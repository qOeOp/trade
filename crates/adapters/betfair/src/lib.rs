//! [VibeTrader](https://github.com/qOeOp/trade) adapter for the [Betfair](https://www.betfair.com/) betting exchange.
//!
//! The `vibe-betfair` crate provides data and execution clients, streaming
//! and REST API models, and full VibeTrader integration for the Betfair
//! betting exchange.
//!
//! The official API reference can be found at <https://docs.developer.betfair.com/>.
//!
//! # VibeTrader
//!
//! [VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
//! engine for multi-asset, multi-venue trading systems.
//!
//! The system spans research, deterministic simulation, and live execution within a single
//! event-driven architecture, providing research-to-live semantic parity.
//!
//! # Naming conventions
//!
//! Betfair's API uses British English spelling. This crate preserves those
//! spellings in type names, method strings, and fixture files, e.g.
//! `MarketCatalogue` / `listMarketCatalogue`, not "catalog".
//!
//! # Feature flags
//!
//! - `high-precision`: Enables 128-bit value types from `vibe-model`.

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
pub mod data_types;
pub mod execution;
pub mod factories;
pub mod http;
pub mod loader;
pub mod provider;
pub mod stream;

#[cfg(feature = "python")]
pub mod python;
