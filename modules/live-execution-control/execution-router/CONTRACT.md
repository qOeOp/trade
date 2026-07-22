# execution.action-router

## Type

atomic module

## Owns

- Mapping executable target actions to Binance write-tool command specs.
- Compiling `place_entry` execution contracts before routing.
- Building command argv for order place, order cancel, position adjust, and position protect tools.

## Inputs

- Target action.
- Repository root.
- Execution contract input or precompiled execution contract for `place_entry`.
- Structured request, plan, observe, or contract fields for non-entry actions.

## Outputs

- `execution-command-spec.v1` compatible command spec:
  - target action
  - tool id/name
  - cwd
  - argv command

## Boundaries

- Does not call Binance or execute commands.
- Does not read or write `trade.db`.
- Does not evaluate preflight, trigger gates, idempotency, or strategy evidence.
- Does not record order events; execution result recording belongs to recorder logic.
