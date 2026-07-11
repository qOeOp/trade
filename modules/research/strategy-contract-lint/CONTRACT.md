# research/strategy-contract-lint

## Type

atomic module

## Owns

- One strategy markdown contract lint command.
- Stable script response envelope for lint output.

## Inputs

- Strategy markdown path.

## Outputs

- `StrategyContractLintResult`.

## Boundaries

- Does not run R&D, replay, signal evaluation, review, catalog writes, `trade.db` writes, or exchange calls.
- Uses `contracts/strategy-contract` for lint semantics.
