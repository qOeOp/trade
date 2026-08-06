# vibe-sandbox


[VibeTrader](https://github.com/qOeOp/trade) sandbox execution adapter for paper trading.

The `vibe-sandbox` crate provides a simulated execution client that uses the
`OrderMatchingEngine` to simulate order execution against live market data. This enables
paper trading and strategy testing in real-time without actual order execution on exchanges.

## Features

- Paper trading against live market data from any data source.
- Full order matching simulation using `OrderMatchingEngine`.
- Support for all order types (market, limit, stop, etc.).
- Configurable fill models and fee models.
- Account balance and position tracking.
- Support for both cash and margin account types.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `python`: Enables Python bindings from [PyO3](https://pyo3.rs).
- `extension-module`: Builds as a Python extension module.

[High-precision mode](https://github.com/qOeOp/trade/blob/main/docs/getting_started/installation.md#precision-mode) (128-bit value types) is enabled by default.
