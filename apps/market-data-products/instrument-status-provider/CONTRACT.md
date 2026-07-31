# Instrument Status Provider Contract

Owns two separately certified deterministic adapters: finalized venue status archives become complete Replay status history; one immutable Binance USD-M `exchangeInfo` acquisition becomes a current-status plus instrument-spec snapshot with an explicit incomplete-history limitation.

## Responsibilities

- Read an archive committed by `market-data-store`; never collect or rewrite venue facts.
- Require Archive v3 acquisition-receipt/source-payload/source-batch/hash-chain closure, a passed batch-window continuity audit, an anchor event, strictly ordered state transitions, full requested-window coverage, and a finality watermark at or beyond `coverage_end`.
- Normalize `trading/halted` transitions into contiguous half-open epochs under one versioned, hash-bound policy.
- Consume a Control Plane-issued certification ref/hash that exactly binds this provider capability; the provider never self-certifies.
- Consume the producer/consumer wire only from `apps/contracts/replay-contract`; never import Replay Plane implementation.
- Emit Replay status epochs, certification-bound provenance, archive/audit/batch-chain hashes, explicit `external_completeness=not_verified`, supersession ref, provider capability, and a self-hashed Evidence v4 envelope.
- Under the separate current-snapshot capability, bind the exact acquisition receipt and raw payload to one status snapshot, one spec snapshot, and the linear accounting increments. `TRADING` alone maps to `trading`; every other venue state fails safe as `halted`.
- Current-snapshot `effective_at` / `trading_enabled_at` is the actual receipt completion time, not an inferred historical listing transition. Its provenance is `current_snapshot_only`; it never removes the Replay limitation for unobserved inter-sample status changes.

## Boundaries

- Does not infer status from OHLCV gaps or turn periodic/current snapshots into complete history.
- Does not certify that a venue archive omitted no external event; it proves only imported batch-window continuity, hash closure, declared finality, and deterministic normalization.
- Does not choose whether a corrected archive supersedes a frozen predecessor for a new Trial; Dataset/Trial governance owns that policy, while old hash-bound evidence remains reproducible.
- Does not create, extend, revoke, or validate the time window of Control Plane certification; Trial admission owns that check.
- Does not choose datasets, reserve Trials, execute Replay, settle halts/delistings, or write strategy/review state.
