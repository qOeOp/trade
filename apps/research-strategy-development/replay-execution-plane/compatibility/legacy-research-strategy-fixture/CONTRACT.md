# Legacy Research Strategy Fixture

## Type

legacy replay certification fixture / compatibility-only

## Owns

- Frozen `S-BTC-4H-TREND-PULLBACK` strategy fixture and its one-entry lookup surface。
- Legacy EMA50/EMA200 trend、ATR pullback、stop and reward-risk signal semantics。

## Inputs

- Legacy replay options and kernel execution entrypoint。
- Frozen legacy Candle、indicator and strategy contracts。

## Outputs

- The bounded fixture strategy、fixture id list and compatibility replay result。

## Boundaries

- 仅供 legacy certification；不是产品 strategy registry、Draft Strategy 或 strategy-family authority。
- 不接受动态注册，不承接新策略、新参数或新调用方。
- 不拥有 Replay execution、Result、Artifact、Review 或 promotion 语义。
- 随 legacy integration/fingerprint certification 一并退役。
