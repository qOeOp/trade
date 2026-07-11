# Runtime Health Guard Contract

Owns J01 `runtime_health_guard` for orchestration runtime readiness checks.

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

