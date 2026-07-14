# Replay Trial Runner

Owns Trial-scoped Replay orchestration, idempotency, early cancellation, typed failure, and atomic Result Artifact commit.

The v7 artifact manifest is the commit marker. Request, bound Dataset Manifest v2, Result, consumed source events, append-only order events, EventKey-bound fills, post-fill positions, cash ledger, balanced journal, and trial balance are committed together; files without a manifest are incomplete attempts and are never published as evidence. Reusing an idempotency key with changed request or manifest is rejected. The runner delegates all market and accounting semantics to the reference engine and accounting owner.

An open position reaching manifest-bound delisting returns `instrument-delisted-with-open-position`, carries the phase-`00` terminal EventKey, is non-retryable, and commits no partial Result. A settlement price requires a separately frozen data contract; Runner does not synthesize one.
