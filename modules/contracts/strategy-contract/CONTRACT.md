# contracts/strategy-contract

## Type

contract module

## Owns

- Strategy markdown contract loading.
- `## Trade Contract` YAML subset parsing.
- Strategy contract compile and lint semantics.
- R&D-family candidate projection from strategy contracts.

## Inputs

- Strategy markdown file with frontmatter.
- Fenced YAML block under `## Trade Contract`.
- Optional candidate parameter overrides.

## Outputs

- `StrategyContractCompiled`.
- `StrategyContractLintResult`.
- `StrategyContractCandidateInput`.

## Boundaries

- Does not run research, replay, review, execution, catalog writes, or exchange calls.
- Does not read manifests or market data.
- Does not own any agent-facing CLI command.
