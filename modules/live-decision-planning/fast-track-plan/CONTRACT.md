# Fast Track Plan Contract

Owns fast-cadence checks for active flows.

## Responsibilities

- Read active flow projections.
- Refresh account and symbol facts through read-only tools.
- Re-evaluate trigger readiness through execution-gate.
- Append fast-track observe events through the event store.
- Write an analysis-only fast-track artifact.

## Boundaries

- Does not execute exchange writes.
- Does not compile or route execution commands.
- Does not own event schema or flow projection internals.
- Does not create new strategy theses.

