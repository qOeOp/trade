# vibe-deribit

[VibeTrader](https://github.com/qOeOp/trade) adapter for the [Deribit](https://www.deribit.com/) derivatives exchange.

The `vibe-deribit` crate provides client bindings (HTTP & WebSocket), data
models and helper utilities that wrap the official **Deribit API v2**.

Deribit uses JSON-RPC 2.0 over both HTTP and WebSocket transports (not REST).
WebSocket is preferred for subscriptions and real-time data.

The official Deribit API reference can be found at <https://docs.deribit.com/v2/>.

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
