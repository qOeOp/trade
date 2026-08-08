# vibe-okx

[VibeTrader](https://github.com/qOeOp/trade) adapter for the [OKX](https://www.okx.com/) cryptocurrency exchange.

The `vibe-okx` crate provides client bindings (HTTP & WebSocket), data
models and helper utilities that wrap the official **OKX v5 API**.

The official OKX API reference can be found at <https://www.okx.com/docs-v5/en/>.

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
