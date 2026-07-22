# research/legacy-replay-fingerprint

## Type

atomic module

## Owns

- Legacy replay evidence fingerprint 的只读 owner surface。
- 对 compatibility replay-engine 的 harness、OHLCV manifest/data 与 assumptions 重算。

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
- 随 compatibility replay-engine 一并退役，不承接新 Replay 语义。
