# Exchange Runtime Store Contract

Owns `exchange_runtime_store`, the append-only audit ledger for exchange commands, results, and snapshot refs.

## Responsibilities

- Create and migrate `data/exchange_runtime.db`.
- Record planned/submitted/confirmed/failed/cancelled exchange commands.
- Enforce idempotency key uniqueness.
- Record exchange command results and confirmation payload refs.
- Record account/order/fill snapshot refs without storing large payloads.

## Boundaries

- Does not place, cancel, protect, or adjust orders.
- Does not decide trade intent or risk validity.
- Does not store the portfolio truth; confirmed money events still flow to `trade_event_store`.
- Does not hold exchange credentials.

