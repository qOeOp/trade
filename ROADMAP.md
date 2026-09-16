# Vibe Trader roadmap

The repository carries two layers. The engine layer is a reliable single-node trading engine and
its Python control surface. The product layer is the Owner architecture defined in
[`docs/guide/index.md`](docs/guide/index.md) and [`docs/owners/`](docs/owners/index.md), which turns
falsifiable market ideas into governed automated trading. Engine capability only becomes product
capability after it is placed behind an Owner contract; the crates are replaceable implementation
units, not authorities.

## Priorities

1. Stabilize the Rust-native kernel, domain model, and PyO3 boundary.
2. Close backtest, sandbox, and live semantic gaps without creating parallel authorities.
3. Improve adapter correctness, recovery behavior, and venue test coverage.
4. Strengthen deterministic test fixtures, benchmarks, and operational diagnostics.
5. Keep concepts, integration guides, tutorials, and generated API surfaces aligned with code.
6. Advance the documented Owner contracts, starting with the Market Data facts that R&D, Backtest, and
   Qualification depend on, and keep each Owner document's implementation status honest.

## In scope

- Single-node research, backtesting, sandbox execution, and live trading.
- Market data, order, account, portfolio, execution, and risk domain behavior.
- Rust and Python strategy/runtime integration.
- In-tree venue and data-provider adapters.
- Local persistence, message-bus, observability, and recovery support.
- The documented Owner contracts and their custody stores.
- Bounded, local-first product surfaces: the Windmill Product Edge under `product/rd-workbench/` and
  the first-party Dashboard under `product/dashboard/`, each admitted only per documented slice.

## Out of scope

- A second trading or state authority beside the existing engine owners.
- Built-in distributed backtest orchestration.
- Hosted, multi-tenant, or publicly served deployments of any product surface.
- Product surface work beyond what the governing document admits, and any product surface acting as a
  business authority rather than projecting Owner facts.

See [`MIGRATION_V2.md`](MIGRATION_V2.md) for the current Rust/PyO3 migration surface.
