# Replay Trial Runner

Owns Trial-scoped Replay orchestration, idempotency, early cancellation, typed failure, and atomic Result Artifact commit.

The artifact manifest is the commit marker. Files without a manifest are incomplete attempts and are never published as evidence. The runner delegates all market semantics to the reference engine.

