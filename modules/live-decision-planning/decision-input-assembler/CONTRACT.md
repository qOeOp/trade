# decision.decision-input-assembler

## Responsibility

Assemble decision inputs from policy, market, flow, account, and research evidence refs into one explicit bundle for planning.

## Inputs

- `decision_input_ref`
- One or more source refs from policy, market, flow, account, or research evidence.
- Optional symbol scope and decision timestamp.

## Outputs

- `decision-input-bundle.v1`

## Boundaries

- Does not choose an action.
- Does not size trades.
- Does not write `trade.db`.
- Does not call exchange APIs.
- Produces a planning input bundle only.
