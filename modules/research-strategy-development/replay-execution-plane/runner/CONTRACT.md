# Replay Trial Runner

Owns Trial-scoped Replay orchestration, Attempt authority validation, attempt-local idempotency, cooperative cancellation, resumable checkpoint handoff, typed failure, and atomic Result Artifact commit.

Artifact Manifest v17 is the success commit marker. Runner requires Control Plane-issued Trial Reservation Snapshot v1 and Replay Attempt Lease v1, verifies request/reservation/lease hashes and lease time window before cancellation, attempt-local idempotency lookup, engine work, or publication. Each Attempt writes an isolated directory; manifest commit binds producer Attempt/lease, the exact required role set, every member SHA-256, last EventKey, and a terminal completeness hash. Run Outcome v7 exposes the latest accepted Attempt generation and manifest ref/hash so Control Plane can fence finalization.

Step Engine may emit Engine Checkpoint v1 only after a complete source-event boundary. The runtime callback may return a renewed Control Plane lease plus `continue|cancel`; Runner rejects changed attempt authority, same-generation mutation, generation rollback, stale heartbeat, or expired lease. A cooperative cancel returns no Result/Artifact and carries the resumable checkpoint. Resume revalidates request/data/policy/hash and deterministic source prefix; the checkpoint is not an authoritative Result and is not written into KG. Runner never renews or mutates Control Plane state itself: the callback must supply a Control Plane-issued lease. Checkpoint durable storage, cross-host blob retrieval, and crash-atomic checkpoint publication remain pending.

If the simulated full close leaves negative isolated collateral, Runner returns typed `liquidation-deficit-unsupported` with the breached snapshot, trigger observation, and `remaining_collateral`; it publishes neither Result nor Artifact and never invents insurance-fund, bankruptcy-price, or ADL facts.

An open position reaching manifest-bound delisting returns `instrument-delisted-with-open-position`, carries the phase-`00` terminal EventKey, is non-retryable, and commits no partial Result. A settlement price requires a separately frozen data contract; Runner does not synthesize one.
