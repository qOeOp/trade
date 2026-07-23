# exchange.write-pre-adapter-gate

## Responsibility

Validate exchange write requests before they reach adapter tools.

## Inputs

- Action, mode, idempotency key, and source intent ref.
- Explicit authorization flag.
- Full `trade.execution.capability.v1`; action, intent, idempotency, account scope, source refs, and expiry must match.
- Optional client order id and symbol.

## Outputs

- `exchange-write-pre-adapter-gate.v1`

## Boundaries

- Does not call Binance.
- Does not record fills.
- Does not override policy-risk decisions.
- Does not compile execution commands.
