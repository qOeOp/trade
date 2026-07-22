# Legacy Research Order Lane

## Type

legacy OHLCV order-lane compatibility module

## Owns

- Standalone legacy OHLCV lane simulation for market、limit and stop-market orders。
- Frozen intrabar priority、reduce-only quantity cap and legacy R-basis reporting。

## Inputs

- Legacy Candle arrays and simulated-lane order contracts。
- Optional initial position、entry and risk basis。

## Outputs

- Legacy simulated fills、final position and two realized R projections。

## Boundaries

- 不被主 `replayStrategy` 调用，不生成 legacy `ReplayTrade` 或 `ReplayResult`。
- 不执行 exchange order，不写 ledger、artifact、catalog 或 durable state。
- 不是 native Replay engine/order-state/accounting authority；不得承接新执行语义。
- 随唯一 legacy certification consumer 一并退役。
