//! System-level components and orchestration for [VibeTrader](https://github.com/qOeOp/trade).
//!
//! The `vibe-system` crate provides the core system architecture for orchestrating trading systems,
//! including the kernel that manages all engines, configuration management,
//! and system-level factories for creating components:
//!
//! - `VibeKernel` - Core system orchestrator managing engines and components.
//! - `VibeKernelConfig` - Configuration for kernel initialization.
//! - System builders and factories for component creation.
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
//! - `streaming`: Enables `persistence` dependency for streaming configuration.
//! - `python`: Enables Python bindings from [PyO3](https://pyo3.rs) (auto-enables `streaming`).
//! - `defi`: Enables DeFi (Decentralized Finance) support.
//! - `live`: Enables live trading mode dependencies.
//! - `tracing-bridge`: Enables the `tracing` subscriber bridge for log integration.
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

pub mod builder;
pub mod clock_factory;
pub mod config;
pub mod controller;
pub mod event_store;
pub mod kernel;
pub mod messages;
pub mod trader;

mod registration;

#[cfg(feature = "python")]
pub mod python;

// Re-exports
pub use builder::VibeKernelBuilder;
pub use clock_factory::ClockFactory;
pub use config::{RotationConfig, StreamingConfig, VibeKernelConfig};
pub use controller::Controller;
pub use event_store::{EventStoreFactory, KernelEventStore, RegisteredComponents};
pub use kernel::VibeKernel;
pub use messages::{
    ControllerCommand, CreateActor, CreateStrategy, RemoveActor, RemoveStrategy, StartActor,
    StartStrategy, StopActor, StopStrategy,
};
#[cfg(feature = "python")]
pub use python::{FactoryRegistry, get_global_pyo3_registry};
