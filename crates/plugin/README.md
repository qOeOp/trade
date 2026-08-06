# vibe-plugin


Plug-in artifact identity and boundary primitives for
[VibeTrader](https://github.com/qOeOp/trade).

The `vibe-plugin` crate provides the public contract that lets an independently compiled Rust
cdylib carry a versioned identity. It defines versioned build metadata, allocator-safe boundary
values, opaque boundary tokens, and the `vibe_plugin!` macro for exporting the standard entry
symbol and manifest.

This crate gives plug-in artifacts a consistent identity and a compact contract.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `host`: Optional plug-in manifest compatibility flag.
