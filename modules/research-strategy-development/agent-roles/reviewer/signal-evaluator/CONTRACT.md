# research/signal-evaluator

## Type

atomic module

## Owns

- Latest closed-candle signal evaluation for one compiled R&D family candidate.
- Read-only post-freeze signal diagnostics for one frozen candidate across one or more datasets.
- Stable script response envelope for signal output.

## Inputs

- JSON payload with `manifest_path`, `entry_price`, and either:
  - `candidate`, or
  - `--strategy <strategy.md>` pointing at a `rnd_family_v1` strategy contract.
- `--forward-holdout` accepts the legacy frozen candidate, explicit freeze time, and dataset manifests.

## Outputs

- `strategy-signal-result`.
- `forward-holdout-result` in compatibility mode.

## Boundaries

- Does not write files, catalog, `trade.db`, or exchange state.
- Forward holdout mode is a signal diagnostic, not Forward Evidence, Shadow, review, or promotion authority.
- Does not run R&D search, replay batches, panel candidate evaluation, review, or promotion.
- Uses `research-strategy-development/signal-engine` for latest signal semantics.
