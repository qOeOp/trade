# Replay Cancellation Recovery

Control Plane-owned atomic startup job for reconciling Runner-owned local cancellation outboxes with the authoritative SQLite cancellation/Observation registries.

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

## Boundaries

- This component owns cross-Plane startup orchestration, not Replay record semantics or Control Plane registry semantics.
- It must run before the same worker pool admits fresh Replay work, but it does not itself claim Trial Attempts or run Engine.
- It does not discover remote stores, delete/quarantine outboxes, define retention/GC, provide a distributed transaction, or claim startup/stop SLA.
- It does not publish Result、Artifact Manifest、Checkpoint Receipt、Resume Authorization、Review Decision or strategy policy.
