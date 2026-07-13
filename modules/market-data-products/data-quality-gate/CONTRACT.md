# Market Data Quality Gate Contract

Owns freshness, hash, and ref checks for market data manifests before downstream domains consume them.

## Responsibilities

- Validate `trade.protocol.market-data-manifest.v1` shells.
- Check symbol scope, time window, content hash, and freshness TTL.
- Return a stable gate result for control tower and market-data owner jobs.

## Boundaries

- Does not fetch market data.
- Does not write market stores, artifacts, `trade.db`, or exchange state.
- Does not decide trades, strategies, or execution readiness.

## Owner tool surface

- `--json <market-data-manifest>`
