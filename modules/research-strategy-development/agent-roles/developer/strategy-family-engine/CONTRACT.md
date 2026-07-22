# research/strategy-family-engine

## Type

internal engine

## Owns

- R&D family registry and family modules.
- Factor feature store reads and causal factor transforms.
- Factor seed research and bounded factor candidate composition helpers.

## Inputs

- Candidate family id and raw family parameters.
- Optional indicator/feature report path.
- OHLCV candles supplied by replay/research callers for factor research.

## Outputs

- Configured replay strategy objects.
- Normalized family params.
- Factor conditions, feature store reads, and factor research reports.
- A deterministic factor-selection identity hash plus explicit selection/purge scope.

## Boundaries

- No CLI, package, catalog write, artifact write, `trade.db` write, or exchange access.
- Does not own R&D loop state, candidate gating, review, promotion, or execution.
- Funding and replay primitives are re-exported from `research-strategy-development/replay-engine`; formulas are not duplicated.
- When `targets` is declared, including an empty target set, research remains setup-conditioned and never falls back to full-sample forward-return labels.
- The caller owns dataset-stage authorization and must supply only purged training targets; validation and holdout labels are not factor-selection inputs.
