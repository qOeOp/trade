# Replay Cancellation Recovery

Control Plane-owned startup coordination component for reconciling Runner-owned local cancellation outboxes with the authoritative SQLite cancellation/Observation registries.

## Inputs

- Existing Research Control Plane DB path.
- Existing certified local Replay Artifact Store root.
- RFC 3339 UTC registration-at timestamp.

## Protocol

1. Require the existing cancellation authority schema；do not initialize an empty or wrong DB.
2. Ask Replay Runner to discover and validate the complete local outbox set.
3. Use the Control Plane SQLite adapter to inspect every exact Observation before any acknowledgement.
4. Register only `pending` observations；report `already_registered` without redelivery.
5. Return only portable hashes/identities；never expose machine-local DB、artifact or namespace paths.

`research.replay-attempt-admission` is the production claim-side gate. It accepts the exact Claim input plus an explicit recovery timestamp, opens one existing authority DB session, completes the protocol above, then and only then calls `claimReplayAttempt`. Recovery time must be at or before `claimed_at`; malformed/tampered discovery or authority conflict yields zero claim. The returned lease is revalidated against Attempt、worker、Trial/run、Reservation/hash、Request、claim/expiry bindings and the result contains no local paths. Existing idempotent claim semantics remain owned by State Store.

## Boundaries

- This component owns cross-Plane startup orchestration, not Replay record semantics or Control Plane registry semantics.
- The standalone job must run before the same worker pool admits fresh Replay work, but it does not itself claim Trial Attempts or run Engine.
- The standalone recovery job does not claim；the separate admission operation composes recovery with the existing Control Plane claim authority and still never runs Replay.
- It does not discover remote stores, delete/quarantine outboxes, define retention/GC, provide a distributed transaction, or claim startup/stop SLA.
- Valid recovered Observations remain committed when a later claim validation fails；the protocol is ordered and fail-closed, not a filesystem/SQLite distributed transaction.
- Until a worker supervisor/pool identity exists, the caller must bind `artifact_root` to the same stopped worker pool it is admitting；this component does not invent that deployment model.
- It does not publish Result、Artifact Manifest、Checkpoint Receipt、Resume Authorization、Review Decision or strategy policy.
