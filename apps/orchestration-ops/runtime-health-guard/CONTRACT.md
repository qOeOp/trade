# Runtime Health Guard Contract

Owns control tower `pre_cycle / pre_job` runtime readiness checks.

`runtime_health_guard` is a lifecycle processor, not a domain job ticket.

## Responsibilities

- Check required environment variables.
- Check required local paths.
- Check that configured SQLite stores can open and have expected tables.
- When `require_l2_ready=true`, call the registered `market-data.l2-service-health` owner read and require its exact `overall_ready` result.
- When `require_l2_watch_consumer_ready=true`, call the registered `ops.l2-book-watch-consumer` owner read and require its exact healthy baseline/readiness result.
- Respect explicit safe mode.
- Persist the health observation and bounded, path/PID-free L2 owner projections through `ops-runtime-store`; the resident-consumer projection is limited to readiness, control counters, epoch/hash/timestamps, and aggregate reliability counters.

## Boundaries

- Does not call exchange or market data APIs.
- Does not inspect L2 or resident-consumer process IDs, runtime files, SQLite state, or gRPC directly; all semantics remain with registered owner tools.
- Does not start, stop, restart, signal, or otherwise acquire lifecycle authority over L2.
- Both L2 readiness checks are independently opt-in and fail-closed; cycles that do not explicitly require them retain their existing checks.
- Does not mutate trading state.
- Does not decide whether a strategy or trade is valid.
- Emits only health status, check details, and an ops store reference.
