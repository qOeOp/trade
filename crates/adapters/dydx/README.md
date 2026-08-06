# vibe-dydx


[VibeTrader](https://github.com/qOeOp/trade) adapter for the [dYdX v4](https://dydx.exchange/) decentralized exchange.

The `vibe-dydx` crate provides client bindings (HTTP, WebSocket & gRPC), data models
and helper utilities that wrap the official **dYdX v4 API**.

dYdX v4 is built as a standalone Cosmos SDK appchain using CometBFT consensus. The order book
and matching engine run on-chain as part of the validator process. Orders are submitted as
Cosmos transactions via gRPC and settled each block. An Indexer service exposes REST and
WebSocket APIs for market data and account state.

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
