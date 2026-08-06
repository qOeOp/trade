# vibe-derive


[VibeTrader](https://github.com/qOeOp/trade) adapter for the
[Derive](https://www.derive.xyz) decentralized derivatives exchange.

The `vibe-derive` crate implements the Derive adapter for VibeTrader, including typed HTTP
and WebSocket clients, REST and stream models, venue parsing, data and execution client wiring, and
EIP-712 signing for the official **Derive API**.

Derive offers European-style options, perpetual swaps, and spot markets on the Derive Chain, an
optimistic rollup that settles to Ethereum. Orders match off-chain and settle on-chain while users
retain custody through per-user smart-contract wallets.

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

## Fuzzing

Coverage-guided fuzz targets for Derive wire models, parsers, signing payloads, and nonce sequencing
live in [`fuzz/`](fuzz/README.md). They require the workspace-pinned `cargo-fuzz` binary and a Rust
nightly toolchain.
