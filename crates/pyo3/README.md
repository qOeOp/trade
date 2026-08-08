# vibe-pyo3

Python bindings for [VibeTrader](https://github.com/qOeOp/trade).

The `vibe-pyo3` crate provides all [PyO3](https://pyo3.rs) Python bindings for the
main `vibe_trader` Python package, built via [maturin](https://github.com/PyO3/maturin).

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `extension-module`: Builds as a Python extension module (automatically enabled by `maturin`).
- `high-precision`: Uses 128-bit value types throughout the workspace.
- `postgres`: Enables PostgreSQL (sqlx) back-ends in dependent crates.
- `redis`: Enables Redis based infrastructure in dependent crates.
- `hypersync`: Enables hypersync support (fast parallel hash maps) where available.
- `tracing-bridge`: Enables the `tracing` subscriber bridge for log integration.
- `defi`: Enables DeFi (Decentralized Finance) support including blockchain adapters.
