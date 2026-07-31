# Legacy Research Contracts

## Type

legacy research type contract / compatibility-only

## Owns

- Legacy `ReplaySignal / ReplayTrade / ReplayStrategy / ReplayOptions / ReplayResult` TypeScript shapes。
- Legacy latest-signal、temporal-integrity and simulated-lane result shapes。

## Inputs

- Type-only references to legacy Candle、IndicatorSet、FundingEvent、evaluation gate and provenance contracts。

## Outputs

- Compile-time legacy research interfaces；无 runtime API。

## Boundaries

- 只冻结既有 TypeScript shape，不执行 Replay、不读取数据、不计算指标或 metrics。
- 不是 native Replay contracts；不得新增字段来承接新 Trial、Result、Artifact 或 promotion 语义。
- Runtime consumers may use the kernel compatibility facade, but source-level type consumers import this owner directly。
- 随 legacy contract consumers 一并退役。
