# Market Fact Publisher Contract

Owns the stable market-data manifest envelope emitted by market-data-products onto the market data rail.

## Responsibilities

- Build `trade.protocol.market-data-manifest.v1` envelopes from owner-produced market refs.
- Preserve source refs, symbol scope, time window, content hash, freshness, and feature/dataset metadata.
- Return a stable owner CLI response that can be passed to the domain bus.

## Boundaries

- Does not fetch data, calculate indicators, or write market stores.
- Does not publish directly to `trade.db`, governance, execution, or exchange write tools.
- Does not decide whether a trade, strategy, or execution should run.

## Owner tool surface

- `--json <payload>`
