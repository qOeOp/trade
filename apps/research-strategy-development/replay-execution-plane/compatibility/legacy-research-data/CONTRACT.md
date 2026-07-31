# Legacy Research Data

## Type

legacy OHLCV data compatibility module

## Owns

- Legacy `Candle` type。
- 既有 JSON manifest 读取、timeframe CSV 定位与 candle parsing 语义。
- Legacy funding event normalization、区间求和与 trailing average。

## Inputs

- Repository-readable manifest path、timeframe 与 CSV bytes。

## Outputs

- Parsed manifest record。
- Frozen legacy candle arrays。
- Legacy funding event index/range statistics。

## Boundaries

- 只维持既有 R&D/Forward 数据读取，不执行 native Replay admission。
- 不校验完整 PIT Dataset/Trial contract，不生成 SourceEvent、Signal、Fill、Result 或 Artifact。
- 不修复、补齐或 forward-fill candle；不得成为新数据接入 owner。
- 随 legacy data consumers 一并退役。
