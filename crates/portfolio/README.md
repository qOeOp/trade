# vibe-portfolio

Portfolio management and risk analysis for [VibeTrader](https://github.com/qOeOp/trade).

The `vibe-portfolio` crate provides portfolio management capabilities including
real-time position tracking, performance calculations, and risk management. This includes
sophisticated portfolio analytics and multi-currency support:

- **Portfolio tracking**: Real-time portfolio state management with position and balance monitoring.
- **Account management**: Support for cash and margin accounts across multiple venues.
- **Performance calculations**: Real-time unrealized PnL, realized PnL, and mark-to-market valuations.
- **Risk management**: Initial margin calculations, maintenance margin tracking, and exposure monitoring.
- **Multi-currency support**: Currency conversion and cross-currency risk exposure analysis.
- **Configuration options**: Flexible settings for price types, currency conversion, and portfolio behavior.

The crate handles complex portfolio scenarios including multi-venue trading, currency conversions,
and sophisticated margin calculations for both live trading and backtesting environments.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `python`: Enables Python bindings from [PyO3](https://pyo3.rs).
