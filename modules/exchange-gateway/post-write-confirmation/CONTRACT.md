# exchange.post-write-confirmation

## Responsibility

Normalize exchange write results and reread confirmations into exchange command/result refs.

## Inputs

- Command ref, client order id, action, status, and idempotency key.
- Optional request/result refs, exchange order ids, source intent ref, and event write ref.
- Capability ref that authorized the exact side effect.

## Outputs

- `trade.protocol.exchange-command-ref.v1`

## Boundaries

- Does not call Binance by itself.
- Does not append trade events.
- Does not decide whether an action should have been taken.
- Confirmation facts remain exchange refs until execution/state owners consume them.
