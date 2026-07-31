# Legacy Research Decision

## Type

legacy research decision compatibility module

## Owns

- Frozen prefix-only `ReplayStrategy.generateSignal` input construction。
- Legacy latest closed-candle signal diagnostic and freshness checks。
- Full-series versus cutoff-recomputed decision lookahead detection。
- Legacy signal-timeframe interval parsing shared with the compatibility kernel。

## Inputs

- Legacy Strategy/Options contracts、Candle arrays and indicator sets。
- Manifest-backed latest-signal request with external entry reference。

## Outputs

- Frozen bounded decision input、`LatestSignalResult` and temporal-integrity report。

## Boundaries

- 不执行 trade resolution，不 materialize next-open fill，不计算成本、funding、metrics 或 gate。
- Latest-signal 是诊断投影，不是 Forward Evidence、Review 或 execution authorization。
- 不写文件、catalog 或 durable state；不是 native Replay decision contract。
- 随 legacy decision consumers 一并退役。
