# vibe-analysis


Portfolio analysis and performance metrics for [VibeTrader](https://github.com/qOeOp/trade).

The `vibe-analysis` crate provides portfolio analysis tools and performance
statistics for evaluating trading strategies and portfolios. This includes return-based metrics,
PnL-based statistics, and risk measurements commonly used in quantitative finance:

- Portfolio analyzer for tracking account states and positions.
- Extensive collection of performance statistics and risk metrics.
- Flexible statistic calculation framework supporting different data sources.
- Support for multi-currency portfolios and unrealized PnL calculations.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `python`: Enables Python bindings from [PyO3](https://pyo3.rs).
- `extension-module`: Builds as a Python extension module.
