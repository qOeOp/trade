# Flow Projector Contract

Owns rebuildable execution-state projections derived from `plan_event`.

## Responsibilities

- Reduce a flow chain into current orders, position, risk lock, and open action gap.
- List active flows and lane conflicts.
- Build an account-scoped portfolio projection over all bound flows, including exposure, reserved/open risk, active flow count, realized PnL, risk locks, reconcile status, freshness, content hash, and stable projection ref.
- Expose latest slow-track observe for fast-track inheritance without cross-domain event-store reads.
- Apply reconcile drafts only when explicitly authorized.
- Keep projections rebuildable from the event store.
- Derive position changes from monotonic cumulative fill watermarks; duplicate and stale cumulative snapshots contribute zero additional quantity.
- Return stable `flow-projector.script-response.v1` envelopes from the owner CLI.

## Boundaries

- Reads event-store state but does not own event schema.
- Does not call exchange, market data, research, review, or catalog tools.
- Does not create live exchange commands.
- Does not write anything except approved reconcile event drafts through event-store append.
- Production callers outside this domain must use the owner CLI or protocol bus, not `src/lib/*` imports.
- Test imports are allowed only as behavior anchors.

## Owner tool surface

- `--active-flows`
- `--reduce-flow`
- `--latest-slow-observe`
- `--portfolio-account --account-ref <ref> --account-scope <ref> [--symbol <symbol>]`
- `--apply-reconcile --yes`
