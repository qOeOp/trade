# contracts/replay-contract

## Type

contract module

## Owns

- Stable replay result type shell.
- Stable replay result JSON schema.
- Stable replay fingerprint type shell.
- Stable replay fingerprint JSON schema.
- Cross-Plane Replay Artifact storage-policy identifiers.
- Market Data producer 与 Replay consumer 共享的 instrument-status、aggregate-trade wire types、hash 与结构校验。

## Inputs

- In-memory replay result records.

## Outputs

- `ReplayResult` and related read-model types.
- `replay-result.schema.json`.
- `ReplayFingerprint`.
- `replay-fingerprint.schema.json`.
- `replay-market-data-contract.ts` producer/consumer boundary；Replay Plane 仅兼容重导出，不再由内部实现反向拥有 provider wire。

## Boundaries

- Does not run replay.
- Does not read manifests, candles, supplemental data, or strategy files.
- Does not compute data hashes, harness hashes, assumptions hashes, fills, signals, or gates.
- 只校验共享 wire 的结构、时序与 hash closure；不读取 Market Data archive，不决定 Dataset/Trial admission。
- Does not write files, catalogs, ledgers, `trade.db`, or exchange state.
