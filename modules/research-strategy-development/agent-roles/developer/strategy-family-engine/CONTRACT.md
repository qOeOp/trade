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
- Legacy compile-time shapes come from `legacy-research-contracts`；Candle/manifest/funding range、派生 indicators 与 frozen hashes 分别来自 `legacy-research-data` / `legacy-research-features` / `legacy-replay-identity`。不依赖 kernel 实现，公式不重复。
- When `targets` is declared, including an empty target set, research remains setup-conditioned and never falls back to full-sample forward-return labels.
- The caller owns dataset-stage authorization and must supply only purged training targets; validation and holdout labels are not factor-selection inputs.
- Factor discovery may consume only a feature report whose provider-native prefix recomputation evidence passed for the active timeframe.
