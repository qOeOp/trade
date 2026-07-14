# research/data-split

## Type

atomic module

## Owns

- Discovery / validation / locked holdout manifest splitting.
- Embargo calculation from hold bars, feature lookback, and funding interval.
- Optional split report persistence and catalog registration.

## Inputs

- Source OHLCV manifests.
- Split ratios, timeframe, embargo parameters, output root.
- Optional report and catalog paths.

## Outputs

- Split segment manifests and CSV files.
- `StrategyDataSplitReport`.

## Boundaries

- Does not run R&D search, replay, panel evaluation, strategy review, or exchange calls.
- Does not write `trade.db`.
- Uses `contracts/catalog-contract` for catalog writes.
