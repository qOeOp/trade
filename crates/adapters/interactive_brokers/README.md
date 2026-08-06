# vibe-interactive-brokers


[VibeTrader](https://github.com/qOeOp/trade) adapter for
[Interactive Brokers](https://www.interactivebrokers.com).

The `vibe-interactive-brokers` crate wraps the [`ibapi`](https://crates.io/crates/ibapi)
client and connects it to VibeTrader's live data, execution, historical data, and instrument
loading infrastructure. Optional PyO3 bindings expose the same implementation through
`vibe_trader`.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is an open‑source, production‑grade, Rust‑native
engine for multi‑asset, multi‑venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event‑driven architecture, providing research‑to‑live semantic parity.

## What this crate provides

- `data`: `InteractiveBrokersDataClient` for market data subscriptions and live streaming.
- `execution`: `InteractiveBrokersExecutionClient` for order submission, account synchronization,
  and execution updates.
- `historical`: `HistoricalInteractiveBrokersClient` for historical data requests.
- `providers`: `InteractiveBrokersInstrumentProvider` for contract lookup, instrument normalization,
  and symbology conversion.
- `gateway`: `DockerizedIBGateway` for managing a Dockerized IB Gateway when the `gateway` feature
  is enabled.
- `python`: PyO3 bindings exposed through `vibe_trader.adapters.interactive_brokers` when the
  `python` feature is enabled.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `python`: Enables PyO3 bindings for configs, enums, the historical client,
  and the instrument provider.
- `gateway`: Enables Dockerized IB Gateway support via `bollard`, including PyO3 bindings when
  combined with `python`.
- `extension-module`: Builds the crate as a Python extension module. This is
  the feature used by the `vibe_trader` package and includes `python` and
  `gateway`.

## Default ports

Use `127.0.0.1` unless you are connecting to a remote host.

| Endpoint              | Trading mode | Default port |
| --------------------- | ------------ | -----------: |
| IB Gateway            | Paper        |       `4002` |
| IB Gateway            | Live         |       `4001` |
| TWS                   | Paper        |       `7497` |
| TWS                   | Live         |       `7496` |
| Dockerized IB Gateway | Paper        |       `4002` |
| Dockerized IB Gateway | Live         |       `4001` |

This crate defaults to `4002`, which matches paper‑trading IB Gateway and the
default Dockerized IB Gateway paper setup. If you are connecting to TWS or to a
live Gateway session, set the port explicitly in your config.

## Market data timestamps

Configure TWS or IB Gateway to return market data timestamps in UTC before connecting
VibeTrader. The adapter does not convert these timestamps automatically at runtime.
