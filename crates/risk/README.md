# vibe-risk


Risk engine for [VibeTrader](https://github.com/qOeOp/trade).

The `vibe-risk` crate provides risk management capabilities including pre-trade
order validation, position sizing calculations, and trading controls. This system ensures
trading operations remain within defined risk parameters and regulatory constraints:

- **Risk engine**: Central risk management orchestration with configurable trading states.
- **Order validation**: Pre-trade checks for price, quantity, notional limits, and market conditions.
- **Position sizing**: Fixed-risk position sizing calculations with commission and exchange rate support.
- **Trading controls**: Rate limiting, balance validation, and exposure management.
- **Account protection**: Multi-currency balance checks and margin requirement validation.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native engine for multi-asset,
multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `python`: Enables Python bindings from [PyO3](https://pyo3.rs).
- `extension-module`: Builds as a Python extension module.
