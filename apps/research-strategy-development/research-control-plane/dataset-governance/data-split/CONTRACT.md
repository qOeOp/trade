# research/data-split

## Type

atomic module

## Owns

- Discovery / validation / locked holdout manifest splitting.
- Embargo calculation from hold bars, feature lookback, and funding interval.
- Optional split report persistence and catalog registration.

## Inputs

- Source OHLCV manifests, or a `market-data.store` candle-slice owner request.
- Split ratios, timeframe, embargo parameters, output root.
- Optional report and catalog paths plus deployment `environment_id`; the CLI inherits `TRADE_ENVIRONMENT_ID`.

## Outputs

- Split segment manifests and CSV files.
- `StrategyDataSplitReport`.
- The report and optional Catalog registration carry the same deployment environment identity.
- A read-only, self-hashed discovery / validation segment snapshot that re-verifies the report, manifest, and CSV content.
- When `exchange` and non-empty `dataset_kinds` are supplied, the segment-snapshot owner also emits the exact `Developer Data Snapshot Binding v3`; omitting them returns the snapshot plus a null Developer binding.

## Boundaries

- Does not run R&D search, replay, panel evaluation, strategy review, or exchange calls.
- Does not write `trade.db`.
- Does not open or query `ohlcv_store`; database-path input is a compatibility locator passed to the market-data owner and never read by Research.
- Large candle payloads cross the domain boundary only as immutable slice manifest refs.
- Segment snapshot binding never opens `locked_holdout`; it accepts only discovery or validation and fails on content drift.
- The Developer binding is an identity/provenance fact only; it grants neither evaluation nor Replay authority.
- Uses `contracts/catalog-contract` for catalog writes.
