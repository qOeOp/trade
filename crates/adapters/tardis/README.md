# vibe-tardis


[VibeTrader](https://github.com/qOeOp/trade) adapter for [Tardis](https://tardis.dev).

The `vibe-tardis` crate provides integration with the Tardis API for accessing
normalized historical and real-time market data across multiple exchanges.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation,
depending on the intended use case:

- `replay` (default): Enables market data replay functionality.
- `python`: Enables Python bindings from [PyO3](https://pyo3.rs).
- `extension-module`: Builds as a Python extension module.

[High-precision mode](https://github.com/qOeOp/trade/blob/main/docs/getting_started/installation.md#precision-mode) (128-bit value types) is enabled by default.
