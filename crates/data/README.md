# vibe-data

Data engine and market data processing for [VibeTrader](https://github.com/qOeOp/trade).

The `vibe-data` crate provides a framework for handling market data ingestion,
processing, and aggregation within the VibeTrader ecosystem. This includes real-time
data streaming, historical data management, and various aggregation methodologies:

- High-performance data engine for orchestrating data operations.
- Data client infrastructure for connecting to market data providers.
- Bar aggregation machinery supporting tick, volume, value, and time-based aggregation.
- Order book management and delta processing capabilities.
- Subscription management and data request handling.
- Configurable data routing and processing pipelines.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `streaming`: Enables `persistence` dependency for catalog-based data streaming.
- `high-precision`: Enables [high-precision mode](https://github.com/qOeOp/trade/blob/main/docs/getting_started/installation.md#precision-mode) to use 128-bit value types.
- `defi`: Enables DeFi (Decentralized Finance) support.
