# vibe-trader


Container crate for [VibeTrader](https://github.com/qOeOp/trade).

This crate re-exports the core, model, and common component crates as a small
stable entry point. Use the individual `vibe-*` crates for adapter,
backtest, live, and other crate-specific APIs.

The first re-exported modules are:

- `common`: Common machinery from `vibe-common`.
- `core`: Core primitives, identifiers, time, and precision support from `vibe-core`.
- `model`: Trading domain model and data types from `vibe-model`.

Use the other component crates that match your use case:

- `vibe-data`: Data engine and market data processing.
- `vibe-backtest`: Backtesting machinery.
- `vibe-live`: Live trading machinery.
- `vibe-trading`: Strategy and actor APIs.
- `vibe-execution`: Execution engine and order management.
- `vibe-portfolio`: Portfolio accounting.
- `vibe-risk`: Risk engine.

Venue adapters publish as separate crates.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
Rust-native engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a
single event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate has no feature flags.
