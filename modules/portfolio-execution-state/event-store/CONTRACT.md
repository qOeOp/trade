# Event Store Contract

Owns the local trade event schema and append/read contract for `trade.db.plan_event`.

## Responsibilities

- Create and migrate the `plan_event` table.
- Validate stable event shells before append.
- Append `observe`, `order_fill`, and `review` events.
- Read ordered events for a single flow chain.
- Expose the latest order-fill event for execution idempotency checks.

## Boundaries

- Does not reduce flow state or infer positions.
- Does not call exchange, market data, research, review, or catalog tools.
- Does not interpret strategy quality or trade decisions.
- Is the only source owner for `plan_event` append semantics.

