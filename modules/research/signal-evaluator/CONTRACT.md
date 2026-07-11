# research/signal-evaluator

## Type

atomic module

## Owns

- Latest closed-candle signal evaluation for one compiled R&D family candidate.
- Stable script response envelope for signal output.

## Inputs

- JSON payload with `manifest_path`, `entry_price`, and either:
  - `candidate`, or
  - `--strategy <strategy.md>` pointing at a `rnd_family_v1` strategy contract.

## Outputs

- `strategy-signal-result`.

## Boundaries

- Does not write files, catalog, `trade.db`, or exchange state.
- Does not run R&D search, replay batches, panel evaluation, review, or promotion.
- Uses `research/signal-engine` for latest signal semantics.
