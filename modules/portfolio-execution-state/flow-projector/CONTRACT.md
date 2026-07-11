# Flow Projector Contract

Owns rebuildable execution-state projections derived from `plan_event`.

## Responsibilities

- Reduce a flow chain into current orders, position, risk lock, and open action gap.
- List active flows and lane conflicts.
- Apply reconcile drafts only when explicitly authorized.
- Keep projections rebuildable from the event store.

## Boundaries

- Reads event-store state but does not own event schema.
- Does not call exchange, market data, research, review, or catalog tools.
- Does not create live exchange commands.
- Does not write anything except approved reconcile event drafts through event-store append.

