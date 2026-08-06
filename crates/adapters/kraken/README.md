# vibe-kraken


[VibeTrader](https://github.com/qOeOp/trade) adapter for the [Kraken](https://www.kraken.com/) exchange.

The `vibe-kraken` crate provides client bindings (HTTP & WebSocket), data models,
and helper utilities that wrap the official **Kraken API v2**.

The official Kraken API reference can be found at <https://docs.kraken.com/api/>.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Features

- HTTP REST API clients for market data (Spot v2, Futures v3).
- WebSocket clients for real-time data feeds (Spot v2, Futures).
- Support for both Spot and Futures markets.
- Instrument, ticker, trade, orderbook, and OHLC data.
- Prepared for execution support (orders, positions, balances) - WIP.

## Architecture

This crate provides **separate HTTP and WebSocket clients for Spot and Futures markets**.
This design reflects fundamental differences between the two APIs:

| Aspect         | Spot                  | Futures                      |
| -------------- | --------------------- | ---------------------------- |
| API Version    | REST API v2           | Derivatives API v3           |
| Base URL       | `api.kraken.com`      | `futures.kraken.com`         |
| Auth Headers   | `API-Key`, `API-Sign` | `APIKey`, `Authent`, `Nonce` |
| Request Format | URL-encoded form      | JSON body                    |
| WebSocket      | v2 protocol           | Futures-specific protocol    |

Kraken Futures was originally a separate platform (Crypto Facilities) acquired by Kraken,
which explains why the APIs remain distinct rather than unified.

### Client Types

- **`KrakenSpotHttpClient`** / **`KrakenSpotWebSocketClient`**: For spot trading pairs (e.g., `BTC/USD`, `ETH/EUR`).
- **`KrakenFuturesHttpClient`** / **`KrakenFuturesWebSocketClient`**: For perpetual and fixed-maturity futures (e.g., `PF_XBTUSD`, `PI_ETHUSD`).

### Bitcoin symbol format

| Market  | Format | Example     | Notes                                           |
| ------- | ------ | ----------- | ----------------------------------------------- |
| Spot    | `BTC`  | `BTC/USD`   | XBT normalized to BTC (base or quote position). |
| Futures | `XBT`  | `PI_XBTUSD` | Uses Kraken's native XBT format.                |

## Examples

See the `bin/` directory for example usage:

```bash
cargo run --bin kraken-http-spot-raw
cargo run --bin kraken-http-spot-public
cargo run --bin kraken-ws-spot-data
```

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `python`: Enables Python bindings from [PyO3](https://pyo3.rs).
- `extension-module`: Builds as a Python extension module.

[High-precision mode](https://github.com/qOeOp/trade/blob/main/docs/getting_started/installation.md#precision-mode) (128-bit value types) is enabled by default.
