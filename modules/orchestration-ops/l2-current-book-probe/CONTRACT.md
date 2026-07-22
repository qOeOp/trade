# L2 Current Book Probe Contract

Programmatic, read-only operations consumer for one active L2 owner observation.

## Owns

- Requiring the registered `market-data.l2-service-health` owner read before any book read.
- Reading the registered `market-data.l2-current-book` owner surface with a bounded depth and freshness limit.
- Verifying that health and book identify the same symbol and stream epoch.
- Returning a bounded full-depth snapshot observation for diagnostics and integration checks.
- Deriving exact-decimal spread and bounded-depth quantity imbalance with BigInt arithmetic and explicit scaled integer units.
- Requiring owner health before a bounded latest-only watermark watch and surfacing snapshot refresh when resync or epoch rollover is observed.
- Running a bounded reconnecting watch session that establishes a current-book baseline, applies owner-fixed exponential retry delays with finite consecutive/session failure budgets, and requires a fresh snapshot after watch failure, resync, or epoch change.
- Hosting an operator-launched resident consumer under a dedicated restart supervisor, atomically projecting its latest baseline and supervisor-lifetime aggregate reliability counters across worker restarts, and exposing them through one fixed no-input owner read.

## Boundaries

- Non-economic observation only; never emits a strategy signal, order intent, fill, slippage estimate, queue position, or execution fact.
- Derived spread and imbalance are diagnostics, not alpha, liquidity, fill-probability, or execution-quality claims.
- Watch watermarks may coalesce and never represent a complete depth-delta or Replay stream.
- The reconnecting session is a bounded diagnostic/consumer state machine, not a permanent process supervisor, event broker, or durable delivery log.
- The resident supervisor owns only its local worker lifecycle; its registered owner read has `lifecycle_authority=none`, exposes no PID/path/control ref, and cannot launch, stop, restart, or signal either the L2 service or consumer.
- Does not start, stop, restart, signal, or otherwise control the L2 service.
- Does not read runtime receipts, PIDs, paths, gRPC endpoints, raw segments, owner SQLite, or Binance directly.
- Does not write databases, artifacts, config, catalog state, or exchange state.
- Agent, LLM, MCP, Kafka, Replay, RD, strategy, and execution are not runtime dependencies.

## Failure semantics

- Health schema, authority, readiness, symbol, or source epoch drift fails before the current-book call.
- Current-book schema, authority, freshness, identity, or top-of-book drift fails closed without returning an observation.
- Owner error details are not copied into the successful result.
- Session retries expose only typed unavailable classes; endpoint, path, PID, subprocess stderr, and owner error details are not retained.
- Retry exhaustion returns typed `unavailable`; a session deadline is a bounded terminal result and never silently extends caller authority.
- Resident worker state is an atomic latest projection, not an append-only audit log, durable queue, delivery acknowledgement, or replacement for raw TL2S.

## Command

- `bun src/scripts/main.ts --json '{"depth":20,"max_freshness_ms":1000}'`
- `bun src/scripts/watch.ts --json '{"max_events":20,"watch_ms":1000}'`
- `bun src/scripts/session.ts --json '{"max_cycles":3,"session_ms":30000,"max_events":20,"watch_ms":1000,"depth":20,"max_freshness_ms":1000}'`
- `bun src/scripts/consumer-launch.ts` (local operator lifecycle; indefinite by default)
- `bun src/scripts/consumer-foreground.ts --restart-limit 8` (production process-manager entry; foreground and signal-draining)
- `bun src/scripts/consumer-read.ts` (registered read-only owner surface)
- `bun src/scripts/consumer-stop.ts --receipt <repo-relative-receipt>` (local operator lifecycle)
- `bun run check`
