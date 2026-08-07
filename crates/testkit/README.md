# vibe-testkit

Test utilities and data management for [VibeTrader](https://github.com/qOeOp/trade).

The `vibe-testkit` crate provides testing utilities including test data management,
file handling, and common testing patterns. This crate supports testing workflows
across the entire VibeTrader ecosystem with automated data downloads and validation:

- **Test data management**: Automated downloading and caching of test datasets.
- **File utilities**: File integrity verification with SHA-256 checksums.
- **Path resolution**: Platform-agnostic test data path management.
- **Precision handling**: Support for both 64-bit and 128-bit precision test data.
- **Event collection**: Draining and correlating the data events a client emits.
- **Common patterns**: Reusable test utilities and helper functions.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `datasets` (enabled by default): Enables test dataset discovery, download, validation, parsing, and loading.
- `testers` (enabled by default): Enables test actors, strategies, and in-memory cache backing.
- `python`: Enables Python bindings from [PyO3](https://pyo3.rs).
- `high-precision`: Enables [high-precision mode](https://github.com/qOeOp/trade/blob/main/docs/getting_started/installation.md#precision-mode) to use 128-bit value types.
- `extension-module`: Builds as a Python extension module.

Event collection utilities remain available without enabling a feature.
