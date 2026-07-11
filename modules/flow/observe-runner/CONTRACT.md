# flow/observe-runner

## Type

atomic module

## Owns

- Calling read-only exchange projection tools required to build a trade observe candidate.
- Normalizing account and market tool responses into observe projections.
- Reporting deterministic read-tool refs for downstream audit trails.

## Inputs

- Repository root.
- Symbol.
- Optional command timeout.
- Optional injected command runner for tests or agent-managed execution.

## Outputs

- Account snapshot projection.
- Market snapshot projection.
- Market refs naming the read tools and symbol.

## Boundaries

- Does not build `plan_event`, execution contracts, action intents, or reviews.
- Does not read or write `trade.db`, catalogs, research ledgers, strategy files, or runtime memory.
- Does not place, cancel, adjust, or protect orders.
- Only calls read-only account and symbol snapshot tools.
