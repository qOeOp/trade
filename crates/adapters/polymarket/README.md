# vibe-polymarket


[VibeTrader](https://github.com/qOeOp/trade) adapter for the [Polymarket](https://polymarket.com) prediction market.

The `vibe-polymarket` crate provides client implementations (HTTP & WebSocket), data
models and parsing for the **Polymarket CLOB API** for trading binary option contracts.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `python`: Enables Python bindings from [PyO3](https://pyo3.rs).
- `extension-module`: Builds as a Python extension module.

[High-precision mode](https://github.com/qOeOp/trade/blob/main/docs/getting_started/installation.md#precision-mode) (128-bit value types) is enabled by default.

## API endpoints

The adapter communicates with four Polymarket API surfaces:

| API            | Base URL                                        | Auth                   | Purpose                                     |
| -------------- | ----------------------------------------------- | ---------------------- | ------------------------------------------- |
| CLOB REST      | `https://clob.polymarket.com`                   | L2 HMAC                | Orders, trades, balances.                   |
| CLOB WebSocket | `wss://ws-subscriptions-clob.polymarket.com/ws` | L2 HMAC (user channel) | Streaming orderbook, trades, order updates. |
| Gamma          | `https://gamma-api.polymarket.com`              | None                   | Market and event discovery, tags, search.   |
| Data           | `https://data-api.polymarket.com`               | None                   | Trade history and user positions.           |

## Authentication

Polymarket uses two-tier authentication:

- **L1 (EIP-712)**: Wallet-level signing for API credential creation and order signing
  via the CTF Exchange contract. Uses `alloy` signer crates.
- **L2 (HMAC-SHA256)**: API key + secret + passphrase for authenticated REST and
  WebSocket requests. Signatures expire after 30 seconds.
