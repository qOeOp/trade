# contracts/replay-contract

## Type

contract module

## Owns

- Stable replay result type shell.
- Stable replay result JSON schema.
- Stable replay fingerprint type shell.
- Stable replay fingerprint JSON schema.
- Cross-Plane Replay Artifact storage-policy identifiers.

## Inputs

- In-memory replay result records.

## Outputs

- `ReplayResult` and related read-model types.
- `replay-result.schema.json`.
- `ReplayFingerprint`.
- `replay-fingerprint.schema.json`.

## Boundaries

- Does not run replay.
- Does not read manifests, candles, supplemental data, or strategy files.
- Does not compute data hashes, harness hashes, assumptions hashes, fills, signals, or gates.
- Does not write files, catalogs, ledgers, `trade.db`, or exchange state.
