# L2 Order Book Service Contract

Production candidate owner for one public Binance USD-M L2 stream.

## Owns

- Long-running public WebSocket lifecycle and REST snapshot bridge.
- Per-epoch sequence validation, bounded ingest queue, current order book, and freshness state.
- Raw TL2S segments plus create-new epoch manifest proposals.
- Loopback / private-network gRPC reads for current book, bounded watermarks, and health.
- TypeScript/Bun process control for release build, detached launch, bounded restart backoff, command-identity-verified stop/status, runtime state, and create-new terminal receipt. A live reused PID is never accepted as this service、supervisor or consumer.
- Periodic invocation of the `market-data-store` owner reconcile surface; the service supervisor observes admission health but never implements admission rules or writes owner SQLite directly.
- Filesystem available-space soft/hard watermarks. Soft pressure keeps existing non-economic reads operational while degrading owner health; hard/unknown pressure prevents or drains the Rust child, then keeps the foreground supervisor alive in bounded in-process recheck instead of creating an external-manager restart storm.
- Periodic child RSS/CPU sampling with current/max values in runtime state; observability failure degrades control readiness without inventing a healthy sample.
- A typed active-owner health read that selects exactly one live supervisor, combines its control state with the fixed loopback Rust health binary, requires control-state freshness derived from configured sampling intervals, and removes process IDs and repository paths from the response.
- A typed active-owner current-book read that fixes the loopback endpoint, symbol, release query binary, and 1,500ms deadline; caller input is limited to bounded depth and freshness.
- A bounded active-owner watermark watch with caller limits `1..100` events / `100..5000ms`, owner-fixed deadline overhead, latest-only coalescing semantics, and typed epoch/resync transitions.
- Dry-run-by-default runtime GC that rechecks exact supervisor command identity and atomically moves old inactive receipt directories out of the active scan root; it does not delete durable market evidence.

## Boundaries

- Requires explicit `--yes-public-network`; never reads API keys or calls private/write endpoints.
- Agent, LLM, MCP, Kafka, Replay, RD, strategy, and live execution are not runtime dependencies.
- Does not write `market_data_store`; manifests are proposals for later owner admission.
- Supervisor state stays under `tmp/l2-order-book-service`; durable raw output defaults to `data/l2`. Agent/LLM/MCP lifecycle is never the daemon parent contract.
- Kafka-compatible publication is disabled until its adoption gate and first independent consumer exist.
- `l2-recorder-bakeoff` remains the parity oracle and is not imported by this module.
- Owner health is read-only and grants no start、stop、restart、signal、trading、Replay or economic authority. Zero active supervisors returns typed `unavailable`; multiple active supervisors fail closed for operator resolution.
- Owner current-book output is a hash-verified bounded-depth snapshot with source/receive/publish timestamps and `execution_compatible=false`; it does not assert fills, queue position, slippage, latency, strategy intent, or execution authority.
- Owner watch is not a depth-delta stream. A slow consumer receives the latest watermark without backpressuring ingestion; any epoch change or `resync_required` requires a new current-book snapshot.
- Consumer reconnect/backoff and mandatory resnapshot remain outside this owner; the owner exposes bounded health, snapshot, and watch facts without owning downstream session lifecycle.

## Failure semantics

- Snapshot bridge miss, live `pu` gap, parse failure, queue overflow, capacity breach, and raw write failure end the current epoch explicitly.
- A new connection always creates a new epoch and snapshot; old book state never crosses epochs.
- The read port reports non-live / stale state as unavailable and never presents the last value as fresh.
- Slow watch clients consume only the latest bounded watermark and cannot backpressure ingestion.
- A service-process crash is restarted with bounded exponential delay; startup salvages any valid orphan partial prefix and always creates a new snapshot/epoch. A finite requested duration or verified operator stop is a successful terminal state, not a crash.
- Disk hard/unknown status is fail-closed for new raw ingestion but not represented by repeated process exits. Retention never means deleting un-compacted or referenced raw evidence; admission assigns `raw_hot/non-deletable` until a separate compactor/GC contract exists.

## Commands

- `cargo run --bin l2-order-book-service -- --yes-public-network --symbol BTCUSDT --duration-seconds 60`
- `cargo run --bin l2-order-book-query -- --action health --symbol BTCUSDT`
- `cargo run --bin l2-order-book-query -- --action book --symbol BTCUSDT --depth 20`
- `bun src/scripts/launch.ts --symbol BTCUSDT --output-base data/l2 --market-data-db data/market_data.db`
- `bun src/scripts/foreground.ts --symbol BTCUSDT --output-base data/l2 --market-data-db data/market_data.db --restart-limit 8` (production process-manager entry; release bins must already exist)
- `bun src/scripts/status.ts --receipt tmp/l2-order-book-service/runtime/<launch>/launch-receipt.json`
- `bun src/scripts/owner-health.ts`
- `bun src/scripts/owner-current-book.ts --depth 20 --max-freshness-ms 1000`
- `bun src/scripts/owner-book-watch.ts --max-events 20 --watch-ms 1000`
- `bun src/scripts/runtime-gc.ts` (plan only)
- `bun src/scripts/runtime-gc.ts --apply` (archive old inactive runtime receipts)
- `bun src/scripts/stop.ts --receipt tmp/l2-order-book-service/runtime/<launch>/launch-receipt.json`
- `bun run check`
- `cargo fmt --all -- --check`
- `cargo check`
- `cargo clippy --all-targets -- -D warnings`
- `cargo test`
