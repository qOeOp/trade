# Instrument Status Provider Contract

Owns the deterministic adapter from one immutable, finalized venue instrument-status archive to Replay-compatible status epochs and provenance.

## Responsibilities

- Read an archive committed by `market-data-store`; never collect or rewrite venue facts.
- Require Archive v3 acquisition-receipt/source-payload/source-batch/hash-chain closure, a passed batch-window continuity audit, an anchor event, strictly ordered state transitions, full requested-window coverage, and a finality watermark at or beyond `coverage_end`.
- Normalize `trading/halted` transitions into contiguous half-open epochs under one versioned, hash-bound policy.
- Consume a Control Plane-issued certification ref/hash that exactly binds this provider capability; the provider never self-certifies.
- Emit Replay status epochs, certification-bound provenance, archive/audit/batch-chain hashes, explicit `external_completeness=not_verified`, supersession ref, provider capability, and a self-hashed Evidence v4 envelope.

## Boundaries

- Does not infer status from OHLCV gaps or periodic snapshots.
- Does not certify that a venue archive omitted no external event; it proves only imported batch-window continuity, hash closure, declared finality, and deterministic normalization.
- Does not choose whether a corrected archive supersedes a frozen predecessor for a new Trial; Dataset/Trial governance owns that policy, while old hash-bound evidence remains reproducible.
- Does not create, extend, revoke, or validate the time window of Control Plane certification; Trial admission owns that check.
- Does not choose datasets, reserve Trials, execute Replay, settle halts/delistings, or write strategy/review state.
