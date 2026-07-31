# Fast Track Guard Contract

Owns J02 fast-cadence execution guard checks for active flows.

## Responsibilities

- Read active flow projections through portfolio-execution-state owner tools.
- Refresh account and symbol facts through read-only tools.
- Re-evaluate trigger readiness through execution-gate.
- Emit fast-track observe events through the event-store owner surface.
- Write an analysis-only fast-track artifact.
- Return native `domain-runtime.domain-job-result.v1` for J02 `fast_track_guard`.

## Boundaries

- Does not execute exchange writes.
- Does not compile or route execution commands.
- Does not own event schema or flow projection internals.
- Does not import portfolio-execution-state internals in production code.
- Does not create new strategy theses.
