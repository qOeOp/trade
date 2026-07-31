# contracts/execution-contract

## Type

contract module

## Owns

- Execution contract input and compiled entry types.
- Pure compile / validate logic for executable order contracts.
- Quantity rounding and entry intent resolution.

## Boundaries

- Does not submit exchange orders.
- Does not write `trade.db`.
- Does not decide whether a trade should be taken.
