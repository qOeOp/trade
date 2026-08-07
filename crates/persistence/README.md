# vibe-persistence

Data persistence and storage for [VibeTrader](https://github.com/qOeOp/trade).

The `vibe-persistence` crate provides data persistence capabilities including reading and writing
trading data to various storage backends. This includes Apache Parquet file support, streaming data
pipelines, and cloud storage integration for historical data management.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `cloud`: Enables cloud storage backends (S3, Azure, GCP, HTTP) via `object_store`.
- `python`: Enables Python bindings from [PyO3](https://pyo3.rs) (auto-enables `cloud`).
- `high-precision`: Enables [high-precision mode](https://github.com/qOeOp/trade/blob/main/docs/getting_started/installation.md#precision-mode) to use 128-bit value types.
- `extension-module`: Builds as a Python extension module.
