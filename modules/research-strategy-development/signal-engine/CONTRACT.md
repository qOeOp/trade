# research/signal-engine

## Type

internal engine

## Owns

- Latest closed-candle signal input normalization.
- Candidate family configuration for signal-only evaluation.
- Stable signal hash/data hash assembly.

## Inputs

- OHLCV manifest path.
- Optional indicator report path.
- Entry reference price.
- Candidate JSON using canonical snake_case fields.

## Outputs

- In-memory `strategy-signal-result` shaped object.

## Boundaries

- No CLI, package, catalog write, artifact write, `trade.db` write, or exchange access.
- Does not run replay batches, R&D search, panel evaluation, review, or promotion.
- Uses `research-strategy-development/strategy-family-engine` for family registry and feature store semantics.
