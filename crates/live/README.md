# vibe-live


Live system node for [VibeTrader](https://github.com/qOeOp/trade).

The `vibe-live` crate provides high-level abstractions and infrastructure for running live trading
systems, including data streaming, execution management, and system lifecycle handling.
It builds on top of the system kernel to provide simplified interfaces for live deployment:

- `LiveNode` High-level abstraction for live system nodes.
- `LiveNodeConfig` Configuration for live node deployment.
- `AsyncRunner` for managing system real-time data flow.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `streaming`: Enables `persistence` dependency for streaming configuration.
- `python`: Enables Python bindings from [PyO3](https://pyo3.rs) (auto-enables `streaming`).
- `defi`: Enables DeFi (Decentralized Finance) support.
- `extension-module`: Builds as a Python extension module.
