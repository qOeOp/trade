# Vibe Trader roadmap

The current roadmap keeps the repository focused on a reliable single-node trading engine and
its Python control surface.

## Priorities

1. Stabilize the Rust-native kernel, domain model, and PyO3 boundary.
2. Close backtest, sandbox, and live semantic gaps without creating parallel authorities.
3. Improve adapter correctness, recovery behavior, and venue test coverage.
4. Strengthen deterministic test fixtures, benchmarks, and operational diagnostics.
5. Keep concepts, integration guides, tutorials, and generated API surfaces aligned with code.

## In scope

- Single-node research, backtesting, sandbox execution, and live trading.
- Market data, order, account, portfolio, execution, and risk domain behavior.
- Rust and Python strategy/runtime integration.
- In-tree venue and data-provider adapters.
- Local persistence, message-bus, observability, and recovery support.

## Out of scope

- A second trading or state authority beside the existing engine owners.
- Built-in distributed backtest orchestration.
- Product UI or hosted service layers.

See [`MIGRATION_V2.md`](MIGRATION_V2.md) for the current Rust/PyO3 migration surface.
