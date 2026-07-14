# Replay Execution Plane Contracts

Owns the versioned Replay request, Dataset Manifest, market input, fill, ledger, result, artifact, and fingerprint contracts.

## Certified v1 capability

- One asset and one isolated position lane.
- Closed-candle signal with earliest execution at the next bar open.
- Market entry and full reduce-only stop or take-profit exit.
- Conservative stop-first same-bar collision and worse-open stop gap.
- Per-fill fee/slippage and exact timestamp funding events.
- Deterministic Result Artifact and complete identity fingerprint.
- Manifest-bound content hash, RFC 3339 UTC timestamps, explicit instrument lifecycle, universe survivorship, observed-through and bar/funding availability policy.

Unsupported order types, partial fills, shared portfolio margin, liquidation, and fast mode are rejected rather than approximated.
