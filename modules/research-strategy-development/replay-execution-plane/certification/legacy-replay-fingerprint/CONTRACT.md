# Legacy Replay Fingerprint Certification

## Type

canonical parity certification surface

## Owns

- Legacy replay evidence fingerprint 的只读 parity certification surface。
- 对 compatibility `legacy-research-kernel` 的 harness、OHLCV manifest/data 与 assumptions 重算。

## Inputs

- 可选 OHLCV manifest、timeframe 与 supplemental data refs。
- 可选 replay assumptions。

## Outputs

- `{ harness_hash, data_hash?, assumptions_hash? }`。
- `legacy-replay-fingerprint.script-response.v1` JSON envelope。

## Boundaries

- 只服务 legacy replay evidence 完整性复核，不代表 native Trial Replay authority。
- 不运行 replay，不转发 Trial request，不生成 Result。
- 不写文件、catalog、数据库或 exchange state。
- 底层 legacy research kernel 退役时必须显式迁移或终止该 certification；不得静默承接新 Replay 语义。
