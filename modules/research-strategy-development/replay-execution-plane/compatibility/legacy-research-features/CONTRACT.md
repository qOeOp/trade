# Legacy Research Features

## Type

legacy derived-feature compatibility module

## Owns

- Legacy `IndicatorSet` shape。
- Frozen EMA、ATR 与 fixed indicator-set calculation semantics。

## Inputs

- Legacy numeric series or `Candle` arrays。

## Outputs

- Legacy EMA / ATR arrays。
- `ema20 / ema50 / ema200 / atr14` indicator set。

## Boundaries

- 只维持既有 R&D/Forward feature semantics，不是新特征研发或 feature-store owner。
- 不读取文件，不执行 Replay，不生成 Signal、Fill、Result 或 Artifact。
- 不接管 `tech-indicators` 或 native Replay 的 indicator contract。
- 随 legacy feature consumers 一并退役。
