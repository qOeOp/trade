# research/rd-integration-suite

## Type

test module

## Owns

- Cross-module R&D integration tests.
- Stable research output schema parity tests.
- Regression coverage for RD runner, campaign, ledger, replay, signal, family, state, and supervisor interactions.

## Inputs

- Test fixtures created inside each test.
- Owner module source imports from `apps/research-strategy-development/**` and `apps/contracts/**`.

## Outputs

- Test pass/fail results only.

## Boundaries

- Exposing a user-facing tool entrypoint
- Owning production RD logic
- Owning replay, candidate, campaign, state, ledger, family, contract, or tracker helpers
- Writing `trade.db`
- Calling Binance write tools
- Deciding live execution
- Writing artifacts, catalogs, ledgers, RD memory, strategy files, or exchange state
