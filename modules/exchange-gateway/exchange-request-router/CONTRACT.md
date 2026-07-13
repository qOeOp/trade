# exchange.exchange-request-router

## Responsibility

Classify exchange requests into read routes or authorized write routes before adapter-specific handling.

## Inputs

- Request kind.
- Action.
- Symbol.
- Optional mode, idempotency key, and source intent ref.

## Outputs

- `exchange-request-route.v1`

## Boundaries

- Does not call Binance.
- Does not compile live execution commands.
- Does not write exchange runtime state.
- Does not approve trading risk.
