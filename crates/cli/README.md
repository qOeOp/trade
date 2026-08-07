# vibe-cli

Command-line interface and tools for [VibeTrader](https://github.com/qOeOp/trade).

The `vibe-cli` crate provides a command-line interface for managing and
operating VibeTrader installations. It includes tools for database management,
system configuration, and operational utilities:

- Database initialization and management commands.
- PostgreSQL schema setup and maintenance.
- Configuration validation and setup utilities.
- System administration and operational tools.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation,
depending on the intended use case:

- `defi`: Enables blockchain/DeFi commands including block sync, DEX pool sync, and pool analysis.
