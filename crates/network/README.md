# vibe-network


Network functionality for [VibeTrader](https://github.com/qOeOp/trade).

The `vibe-network` crate provides networking components including HTTP, WebSocket, and raw TCP socket
clients, rate limiting, backoff strategies, and socket TLS utilities for connecting to
trading venues and data providers.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `python`: Exposes the `TransportBackend` enum through [PyO3](https://pyo3.rs).
- `extension-module`: Builds as a Python extension module.
- `turmoil`: Enables deterministic network simulation testing with [turmoil](https://github.com/tokio-rs/turmoil).
- `transport-sockudo`: Adds the [sockudo-ws](https://crates.io/crates/sockudo-ws) WebSocket backend, selectable via `WebSocketConfig.backend`.

## WebSocket performance

The 512 B text round‑trip benchmark measures 50,000 messages after 1,000 warmup messages. Values
are the median of three `bench-lto` runs on an AMD Ryzen Threadripper 9980X with the CPU governor
set to `performance` and ASLR disabled. Lower latency is better.

| Library                    | p50 (µs) | p95 (µs) | p99 (µs) | p99.9 (µs) |
| -------------------------- | -------: | -------: | -------: | ---------: |
| `tokio-tungstenite 0.30.0` |    2.033 |    2.985 |    3.305 |      6.149 |
| `sockudo-ws 2.0.1`         |    0.601 |    0.631 |    0.651 |      0.721 |

On this workload, `sockudo-ws 2.0.1` has 80% lower p99 latency than
`tokio-tungstenite 0.30.0`. See the [full WebSocket benchmark report](benches/BENCHMARKS.md)
for all payloads, burst latency, throughput, methodology, and limitations.

## Testing

The crate includes both standard integration tests and deterministic network simulation tests using turmoil.

To run standard tests:

```bash
cargo nextest run -p vibe-network
```

To run turmoil network simulation tests:

```bash
cargo nextest run -p vibe-network --features turmoil
```

The turmoil tests simulate various network conditions (reconnections, partitions, etc.) in a deterministic way,
allowing reliable testing of network failure scenarios without flakiness.

Some real localhost socket and WebSocket unit tests are Linux-only for CI stability. On macOS,
use the Turmoil tests and soak for deterministic reconnect/path-search coverage, and rely on a
Linux run for host TCP unit coverage.

To sweep Turmoil reconnect seeds continuously:

```bash
scripts/soak-network-turmoil.sh
```

Set `VIBE_TURMOIL_SOAK_COUNT` for a bounded run. The soak alternates the
Tungstenite and Sockudo WebSocket backends on the same seed when
`transport-sockudo` is enabled.
