# Legacy Replay Identity

## Type

legacy evidence identity compatibility module

## Owns

- 既有 replay evidence 的 canonical、file、manifest/data 与 harness SHA-256 算法。
- 对 legacy research kernel 与 identity implementation source set 的 harness identity 计算。

## Inputs

- JSON-compatible identity values。
- Repository-readable OHLCV manifest、timeframe 与 supplemental refs。

## Outputs

- Legacy-compatible canonical、content、data 与 harness hashes。

## Boundaries

- 不读取策略，不生成 Signal、Fill、Result 或 Artifact。
- 不是 native Replay fingerprint authority，也不得为新 Replay 语义定义 identity。
- 仅供现有 legacy evidence 消费者迁移；不得新增领域语义或调用方。
- 随 legacy evidence consumer 与 fingerprint certification 一并退役。
