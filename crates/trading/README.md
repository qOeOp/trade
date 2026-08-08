# vibe-trading

Trading strategy machinery and orchestration for [VibeTrader](https://github.com/qOeOp/trade).

The `vibe-trading` crate provides core trading capabilities including:

- **Forex sessions**: Market session time calculations and timezone handling.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `examples`: Enables example strategies (e.g. `EmaCross`) for backtesting and demos.
- `defi`: Enables DeFi (Decentralized Finance) support.
- `high-precision`: Enables [high-precision mode](https://github.com/qOeOp/trade/blob/main/docs/getting_started/installation.md#precision-mode) to use 128-bit value types.
- `python`: Enables Python bindings from [PyO3](https://pyo3.rs).
- `extension-module`: Builds as a Python extension module.
