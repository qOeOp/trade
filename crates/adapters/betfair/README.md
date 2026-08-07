# vibe-betfair

[VibeTrader](https://github.com/qOeOp/trade) adapter for the [Betfair](https://www.betfair.com/) betting exchange.

The `vibe-betfair` crate provides data and execution clients, streaming
and REST API models, and full VibeTrader integration for the
[Betfair](https://www.betfair.com/) betting exchange.

The official API reference can be found at <https://docs.developer.betfair.com/>.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `high-precision`: Enables [128-bit value types](https://github.com/qOeOp/trade/blob/main/docs/getting_started/installation.md#precision-mode) from `vibe-model`.
