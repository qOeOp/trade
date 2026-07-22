# research/replay-engine

## Type

internal engine / shared research implementation

## Owns

- Replay result semantics.
- Conservative fill ordering.
- Replay cost, funding, temporal provenance, diagnostics, and gate calculations.
- Replay-related pure hashing helpers.
- Bounded full-series versus cutoff-recomputed strategy-decision integrity detection.

## Inputs

- Local OHLCV manifests.
- Optional supplemental data refs.
- A compiled `ReplayStrategy`.
- Strategy decisions receive only a frozen OHLCV/indicator prefix through the decision cutoff and an observed `decisionPrice`; next-event prices are execution-only facts.

## Outputs

- `ReplayResult` and related replay contract types.
- Latest-signal evaluation shells used by research tools.
- Next-open materialization that preserves the predeclared reward/risk ratio and rejects fills exceeding the signal's entry-risk limit.
- A deterministic temporal-integrity report with complete/sampled coverage, mismatch count, and bounded mismatch evidence.

## Boundaries

- Does not write files, catalog, `trade.db`, or exchange state.
- Does not promote strategies.
- Does not call Binance write tools.
- Strategies cannot read future bars or choose an actual next-open fill price.
- The integrity detector rebuilds indicators at each cutoff; callers with external feature stores must also provide a cutoff-bounded strategy factory.
- Agent-facing execution belongs in future atomic runner modules, not this engine.
