# vibe-backtest


Backtest engine for [VibeTrader](https://github.com/qOeOp/trade).

The `vibe-backtest` crate provides an event-driven backtesting framework that allows
quantitative traders to test and validate trading strategies on historical data with high
fidelity market simulation. The system replicates real market conditions including:

- Event-driven backtesting engine with simulated exchanges.
- Market data replay with configurable latency and fill models.
- Order matching engines with realistic execution simulation.
- Multi-venue and multi-asset backtesting capabilities.
- Configuration and state management.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `examples`: Enables example strategies and the EMA crossover backtest example.
- `streaming`: Enables `persistence` dependency for streaming configuration.
- `python`: Enables Python bindings from [PyO3](https://pyo3.rs).
- `extension-module`: Builds as a Python extension module.
