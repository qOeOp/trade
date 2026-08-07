# vibe-databento

[VibeTrader](https://github.com/qOeOp/trade) adapter for [Databento](https://databento.com).

The `vibe-databento` crate provides a complete integration with the Databento API for
accessing institutional-grade market data feeds across multiple venues and asset classes.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `live` (default): Enables live data functionality including the `data`, `factories`, and `live` modules.
- `python`: Enables Python bindings from [PyO3](https://pyo3.rs).
- `extension-module`: Builds as a Python extension module.
- `high-precision`: Enables [high-precision mode](https://github.com/qOeOp/trade/blob/main/docs/getting_started/installation.md#precision-mode) to use 128-bit value types.
