# vibe-common


Common componentry for [VibeTrader](https://github.com/qOeOp/trade).

The `vibe-common` crate provides shared components and utilities that form the system foundation for
VibeTrader applications. This includes the actor system, message bus, caching layer, and other
essential services.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `python`: Enables Python bindings from [PyO3](https://pyo3.rs).
- `defi`: Enables DeFi (Decentralized Finance) support.
- `indicators`: Includes the `vibe-indicators` crate and indicator utilities.
- `capnp`: Enables [Cap'n Proto](https://capnproto.org/) serialization support.
- `live`: Enables the Tokio async runtime for live trading.
- `tracing-bridge`: Enables the `tracing` subscriber bridge for log integration.
- `extension-module`: Builds as a Python extension module.
