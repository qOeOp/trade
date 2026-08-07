# vibe-execution

Order execution engine for [VibeTrader](https://github.com/qOeOp/trade).

The `vibe-execution` crate provides an order execution system that handles the complete
order lifecycle from submission to fill processing. This includes sophisticated order matching,
execution venue integration, and advanced order type emulation:

- **Execution engine**: Central orchestration of order routing and position management.
- **Order matching engine**: High-fidelity market simulation for backtesting and paper trading.
- **Order emulator**: Advanced order types not natively supported by venues (trailing stops, contingent orders).
- **Execution clients**: Abstract interfaces for connecting to trading venues and brokers.
- **Order manager**: Local order lifecycle management and state tracking.
- **Matching core**: Low-level order book and price-time priority matching algorithms.
- **Fee and fill models**: Configurable execution cost simulation and realistic fill behavior.

The crate supports both live trading environments (with real execution clients) and simulated
environments (with matching engines), making it suitable for production trading, strategy
development, and backtesting.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `python`: Enables Python bindings from [PyO3](https://pyo3.rs).
