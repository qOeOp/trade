# Replay Execution Plane Contracts

Owns the versioned Replay request, market input, fill, ledger, result, artifact, and fingerprint contracts.

## Certified v1 capability

- One asset and one isolated position lane.
- Closed-candle signal with earliest execution at the next bar open.
- Market entry and full reduce-only stop or take-profit exit.
- Conservative stop-first same-bar collision and worse-open stop gap.
- Per-fill fee/slippage and exact timestamp funding events.
- Deterministic Result Artifact and complete identity fingerprint.

Unsupported order types, partial fills, shared portfolio margin, liquidation, and fast mode are rejected rather than approximated.

