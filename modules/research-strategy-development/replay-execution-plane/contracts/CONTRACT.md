# Replay Execution Plane Contracts

Owns the versioned Replay request, Dataset Manifest, instrument-accounting spec, market input, fill, ledger, journal, trial-balance, result, artifact, and fingerprint contracts.

## Certified Result v7 / Simulator Policy v2 capability

- One asset and one isolated position lane.
- Closed-candle signal with earliest execution at the next bar open.
- Signal-time market submission remains inert until the eligible `bar_open` SourceEvent synchronously drives activation, entry fill, and bracket activation; same-time phase-`10` funding sees the `t-` flat position.
- Append-only submitted/activated/triggered/partial-or-full-filled/cancelled/rejected order events with a strictly increasing per-order sequence and nondecreasing event time.
- Every order event carries the total-order key `(event_time, boundary_phase, source_sequence, event_subphase, stable_event_id)`; equal or backward keys are rejected.
- Normalized `instrument_delisted`, `bar_open`, `bar_range`, and `funding` SourceEvents use the same key space; phase `00` delisting precedes same-time settlement and market facts, and Result v7 persists the consumed prefix only.
- Conditional trigger evidence binds the OHLC source class and observed trigger price.
- Market entry and full reduce-only stop or take-profit exit, with sibling cancellation and fill-to-order traceability.
- A terminal market SourceEvent synchronously drives the certified exit-order lane; trigger/fill/sibling-cancel EventKeys remain causally bound to that source boundary.
- Conservative stop-first same-bar collision; stop/TP gap triggers at the observed bar open, then applies adverse slippage.
- Per-fill fee/slippage and exact timestamp funding events.
- Every Fill carries the exact filled OrderEvent key; fee/realized-PnL ledger facts reuse the causal Fill key, funding reuses its SourceEvent key, and initial/ending snapshots use explicit phase-`70`/`100` checkpoint keys.
- Every certified Fill produces a post-fill Position Projection with the same EventKey. Accounting separately certifies ordered multi-Fill net average-cost add/partial-reduce/reversal projection and a flat-terminal cash reducer that merges causal fee/realized-PnL/funding facts and derives ending equity. The current Runner capability remains one non-reduce entry and one full reduce-only close; it does not expose the wider capability until matching and position-at-funding paths reach parity.
- Dataset Manifest v2 binds a linear-derivative accounting spec: base/quote/settlement assets, unit contract multiplier, and declared price/quantity/settlement increments. The certified slice requires quote-asset settlement and at most 12 increment decimal places.
- Result v7 projects every cash fact into a balanced two-leg settlement-asset journal under `rd-replay-journal-v1`, publishes a deterministic trial balance, and requires journal wallet cash to reconcile exactly to ledger ending equity. It remains a flat-terminal accounting slice, not a position-asset, margin, or portfolio ledger.
- `rd-replay-number-v3` converts admitted finite number values into decimal coefficients, performs bps adjustment, notional fee, funding, linear PnL, weighted-average and return division as BigInt rationals, then quantizes once: quantity floors to step; buy execution price ceils and sell price floors to tick; fee expense ceils; signed funding/realized cashflow floors toward negative infinity; weighted average and return use half-away-from-zero at 12 decimal places. Stop/target, OHLC, initial cash, Fill, Position, Ledger and Journal facts must align. Shared language-neutral vectors are independently certified by Bun/BigInt and Python Decimal; this proves arithmetic-policy parity, not arbitrary JSON parser or unbounded-decimal transport equivalence.
- Deterministic Result Artifact and complete identity fingerprint, including numeric and journal policy versions.
- Manifest-bound content hash, RFC 3339 UTC timestamps, explicit instrument lifecycle, universe survivorship, observed-through and bar/funding availability policy.

The lifecycle component certifies deterministic partial quantity transitions and reduce-only caps; the current market-data kernel does not claim a historical liquidity model that can produce real partial fills. Limit queue, amend/TIF, multi-entry/reversal, shared portfolio margin, liquidation, and fast mode remain unsupported rather than approximated.

The certified Manifest only proves `delisted_at`, not halt/resume history or a settlement price. An open position reaching delisting therefore produces a non-retryable typed failure with the terminal EventKey and publishes no partial Result; the engine never invents a terminal fill.
