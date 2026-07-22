# Aggregate Trade Provider Contract

Owns the deterministic, read-only projection from one immutable Binance USD-M aggregate-trade archive into Replay exact-price-path evidence.

## Responsibilities

- Consume only Aggregate Trade Archive v1 committed by `market-data-store`; never fetch, repair, extend, or rewrite venue facts.
- Require raw response byte/hash closure, deterministic Binance aggregate-trade normalization, one symbol, contiguous aggregate ids, non-decreasing event time, half-open window membership, and a finality watermark at or beyond `coverage_end`.
- Consume a Control Plane-issued certification ref/hash that exactly binds this provider capability; the provider never self-certifies.
- Consume the producer/consumer wire only from `modules/contracts/replay-contract`; never import Replay Plane implementation.
- Emit Replay Aggregate Trade Event v1, Coverage Attestation v1, archive/receipt/audit hashes, provider capability, explicit `external_completeness=not_verified`, and a self-hashed Evidence v1 envelope.

## Boundaries

- Does not claim that the imported venue source omitted no record, authenticate the external transport, or restore Binance insurance-fund/ADL trades excluded by the aggregate-trade feed.
- Treats Binance trade time as the earliest observable time at millisecond resolution; this is resolution-limited evidence, not measured dissemination latency.
- Does not infer fills, queue priority, partial fills, slippage, impact, fees, cross-source ordering, or bar-boundary ordering.
- Does not select datasets, certify itself, reserve Trials, execute Replay, write Result/Artifact, or authorize strategy promotion.
