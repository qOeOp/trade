# Replay Trial Runner

Owns Trial-scoped Replay orchestration, idempotency, early cancellation, typed failure, and atomic Result Artifact commit.

The artifact manifest is the commit marker. Request, bound Dataset Manifest, Result, fills and ledger are committed together; files without a manifest are incomplete attempts and are never published as evidence. Reusing an idempotency key with changed request or manifest is rejected. The runner delegates all market semantics to the reference engine.
