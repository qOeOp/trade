# policy.runtime-policy-compiler

## Type

atomic module

## Owns

- Trading config load and deprecated legacy config adaptation.
- Runtime policy normalization, hard limit clamping, source hashing, and compact snapshots.

## Inputs

- Explicit `trading-config.json` path, or explicit legacy `account_config.json` / `notify_config.json` paths.
- In-memory trading config records.

## Outputs

- Normalized trading config.
- `runtime-policy.v1` compiled policy.
- Compact policy snapshot.

## Boundaries

- Does not read `trade.db`, exchange state, market data, strategy evidence, or research artifacts.
- Does not make preflight, execution, strategy review, or R&D decisions.
- Does not write files, catalogs, ledgers, `trade.db`, or exchange state.
