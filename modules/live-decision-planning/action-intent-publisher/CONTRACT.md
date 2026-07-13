# decision.action-intent-publisher

## Responsibility

Publish trade-plan, watchlist, or no-action decisions as `action-intent-ref` payloads for execution-control consumers.

## Inputs

- Intent ref, kind, status, source refs, and content hash.
- Optional symbol, side, expiry, and no-action reason.

## Outputs

- `trade.protocol.action-intent-ref.v1`

## Boundaries

- Does not execute trades.
- Does not call exchange or event-store tools.
- Does not approve risk overrides.
- Does not write `trade.db`.
