# research/strategy-hypothesis-designer

## Type

atomic module

## Owns

- Agent-native strategy design context.
- Versioned `strategy_hypothesis_contract` shape.
- Contract lint before any candidate batch, panel run, or strategy policy rendering.
- Deterministic queue-item projection from a designed hypothesis into RD memory.

## Inputs

- RD program state summaries: objective, failures, reliability gate, rejected mechanisms, universe lessons, and artifact refs.
- Strategy universe taxonomy / backlog refs.
- Agent-authored strategy hypothesis contracts.

## Outputs

- Strategy designer prompt text for agent / skill execution.
- Lint results for `trade-flow.strategy-hypothesis-contract.v1`.
- RD `next_hypothesis_queue` seed items that remain blocked until required data/family bindings are explicit.

## Boundaries

- Does not run replay, panel evaluation, campaigns, forward holdout, or strategy review.
- Does not write `strategies/*.md`; validated candidates still go through `strategy-policy-writer`.
- Does not call Binance, write `trade.db`, or decide live permission.
- Does not accept free-form strategy prose as executable input; the agent must produce the structured contract first.
