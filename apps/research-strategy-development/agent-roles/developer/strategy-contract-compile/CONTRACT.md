# research/strategy-contract-compile

## Type

atomic module

## Owns

- One strategy markdown contract compile command.
- Stable script response envelope for compiled contract output.

## Inputs

- Strategy markdown path.
- Optional `candidate_param_overrides` JSON object.

## Outputs

- `StrategyContractCompiled`.

## Boundaries

- Does not run R&D, replay, signal evaluation, review, catalog writes, `trade.db` writes, or exchange calls.
- Uses `contracts/strategy-contract` for compile semantics.
