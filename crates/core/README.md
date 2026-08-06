# vibe-core


Core foundational types and utilities for [VibeTrader](https://github.com/qOeOp/trade).

The `vibe-core` crate is designed to be lightweight, efficient, and to provide zero-cost abstractions
wherever possible. It supplies the essential building blocks used across the VibeTrader
ecosystem, including:

- Time handling and atomic clock functionality.
- UUID generation and management.
- Mathematical functions and interpolation utilities.
- Correctness validation functions.
- Serialization traits and helpers.
- Cross-platform environment utilities.
- Abstractions over common collections.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `ffi`: Enables the C foreign function interface (FFI) from [cbindgen](https://github.com/mozilla/cbindgen).
- `python`: Enables Python bindings from [PyO3](https://pyo3.rs).
- `extension-module`: Builds as a Python extension module.
