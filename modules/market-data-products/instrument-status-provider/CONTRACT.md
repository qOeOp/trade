# Instrument Status Provider Contract

Owns the deterministic adapter from one immutable, finalized venue instrument-status archive to Replay-compatible status epochs and provenance.

## Responsibilities

- Read an archive committed by `market-data-store`; never collect or rewrite venue facts.
- Require an anchor event, strictly ordered state transitions, full requested-window coverage, and a finality watermark at or beyond `coverage_end`.
- Normalize `trading/halted` transitions into contiguous half-open epochs under one versioned, hash-bound policy.
- Emit Replay status epochs, provenance, provider capability, and a self-hashed evidence envelope.

## Boundaries

- Does not infer status from OHLCV gaps or periodic snapshots.
- Does not certify that a venue archive omitted no external event; it certifies only the imported archive, declared finality, normalization, and content closure.
- Does not choose datasets, reserve Trials, execute Replay, settle halts/delistings, or write strategy/review state.
