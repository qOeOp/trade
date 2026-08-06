# vibe-model


Trading domain model for [VibeTrader](https://github.com/qOeOp/trade).

The `vibe-model` crate provides a type-safe domain model that forms the backbone of the framework
and can serve as the foundation for building algorithmic trading systems.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `ffi`: Enables the C foreign function interface (FFI) from [cbindgen](https://github.com/mozilla/cbindgen).
- `python`: Enables Python bindings from [PyO3](https://pyo3.rs).
- `stubs`: Enables type stubs for use in testing scenarios.
- `high-precision`: Enables [high-precision mode](https://github.com/qOeOp/trade/blob/main/docs/getting_started/installation.md#precision-mode) to use 128-bit value types.
- `defi`: Enables the DeFi (Decentralized Finance) domain model.
- `extension-module`: Builds as a Python extension module.
