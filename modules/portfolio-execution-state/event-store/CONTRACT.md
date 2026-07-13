# Event Store Contract

Owns the local trade event schema and append/read contract for `trade.db.plan_event`.

## Responsibilities

- Create and migrate the `plan_event` table.
- Validate stable event shells before append.
- Append `observe`, `order_fill`, and `review` events.
- Append `event-write-envelope` inline events through the protocol fabric fact rail contract.
- List chain ids for owner-side scans.
- Read ordered events for a single flow chain.
- Expose the latest order-fill event for execution idempotency checks.
- Return stable `event-store.script-response.v1` envelopes from the owner CLI.

## Boundaries

- Does not reduce flow state or infer positions.
- Does not call exchange, market data, research, review, or catalog tools.
- Does not interpret strategy quality or trade decisions.
- Is the only source owner for `plan_event` append semantics.
- Production callers outside this domain must use the owner CLI or protocol bus, not `src/lib/*` imports.
- Test imports are allowed only as behavior anchors.

## Owner tool surface

- `--init`
- `--append-event`
- `--append-event-envelope`
- `--append-order-fill`
- `--append-review`
- `--list-chain-ids`
- `--read-flow-events`
- `--read-latest-order-fill`
