# Runtime Health Guard Contract

Owns control tower `pre_cycle / pre_job` runtime readiness checks.

`runtime_health_guard` is a lifecycle processor, not a domain job ticket.

## Responsibilities

- Check required environment variables.
- Check required local paths.
- Check that configured SQLite stores can open and have expected tables.
- Respect explicit safe mode.
- Persist the health observation through `ops-runtime-store`.

## Boundaries

- Does not call exchange or market data APIs.
- Does not mutate trading state.
- Does not decide whether a strategy or trade is valid.
- Emits only health status, check details, and an ops store reference.
