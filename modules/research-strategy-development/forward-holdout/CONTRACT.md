# research.forward-holdout

## Responsibility

Evaluate a frozen R&D candidate on forward-only closed candles and optional supplemental benchmark data. The module decides whether the frozen candidate is blocked, waiting, or has a fresh entry signal.

## Inputs

- Frozen candidate payload
- `strategy_id`, `setup_id`, explicit `frozen_at`
- One or more forward dataset manifests
- Optional indicator report paths
- Optional supplemental benchmark manifest

## Outputs

- `forward-holdout-result.schema.json`
- Read-only holdout evaluation report

## Boundaries

- Does not run R&D search.
- Does not write artifacts or catalog rows.
- Does not write RD program state.
- Does not produce strategy evidence or promotion decisions.
- Does not write `trade.db`.
- Does not call exchange APIs.
