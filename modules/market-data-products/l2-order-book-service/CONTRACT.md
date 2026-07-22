# L2 Order Book Service Contract

Production candidate owner for one public Binance USD-M L2 stream.

## Owns

- Long-running public WebSocket lifecycle and REST snapshot bridge.
- Per-epoch sequence validation, bounded ingest queue, current order book, and freshness state.
- Raw TL2S segments plus create-new epoch manifest proposals.
- Loopback / private-network gRPC reads for current book, bounded watermarks, and health.
- TypeScript/Bun process control for release build, detached launch, bounded restart backoff, exact-PID stop, runtime state, and create-new terminal receipt.
- Periodic invocation of the `market-data-store` owner reconcile surface; the service supervisor observes admission health but never implements admission rules or writes owner SQLite directly.
- Filesystem available-space soft/hard watermarks. Soft pressure degrades readiness; hard pressure prevents startup or drains the child and terminates failed before more raw backlog is accepted.
- Periodic child RSS/CPU sampling with current/max values in runtime state; observability failure degrades control readiness without inventing a healthy sample.

## Boundaries

- Requires explicit `--yes-public-network`; never reads API keys or calls private/write endpoints.
- Agent, LLM, MCP, Kafka, Replay, RD, strategy, and live execution are not runtime dependencies.
- Does not write `market_data_store`; manifests are proposals for later owner admission.
- Supervisor state stays under `tmp/l2-order-book-service`; durable raw output defaults to `data/l2`. Agent/LLM/MCP lifecycle is never the daemon parent contract.
- Kafka-compatible publication is disabled until its adoption gate and first independent consumer exist.
- `l2-recorder-bakeoff` remains the parity oracle and is not imported by this module.

## Failure semantics

- Snapshot bridge miss, live `pu` gap, parse failure, queue overflow, capacity breach, and raw write failure end the current epoch explicitly.
- A new connection always creates a new epoch and snapshot; old book state never crosses epochs.
- The read port reports non-live / stale state as unavailable and never presents the last value as fresh.
- Slow watch clients consume only the latest bounded watermark and cannot backpressure ingestion.
- A service-process crash is restarted with bounded exponential delay; startup salvages any valid orphan partial prefix and always creates a new snapshot/epoch. A finite requested duration or verified operator stop is a successful terminal state, not a crash.
- Disk status unavailable is fail-closed. Retention never means deleting un-compacted or referenced raw evidence; admission assigns `raw_hot/non-deletable` until a separate compactor/GC contract exists.

## Commands

- `cargo run --bin l2-order-book-service -- --yes-public-network --symbol BTCUSDT --duration-seconds 60`
- `cargo run --bin l2-order-book-query -- --action health --symbol BTCUSDT`
- `cargo run --bin l2-order-book-query -- --action book --symbol BTCUSDT --depth 20`
- `bun src/scripts/launch.ts --symbol BTCUSDT --output-base data/l2 --market-data-db data/market_data.db`
- `bun src/scripts/status.ts --receipt tmp/l2-order-book-service/runtime/<launch>/launch-receipt.json`
- `bun src/scripts/stop.ts --receipt tmp/l2-order-book-service/runtime/<launch>/launch-receipt.json`
- `bun run check`
- `cargo fmt --all -- --check`
- `cargo check`
- `cargo clippy --all-targets -- -D warnings`
- `cargo test`
