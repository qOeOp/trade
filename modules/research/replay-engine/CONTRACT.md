# research/replay-engine

## Type

internal engine / shared research implementation

## Owns

- Replay result semantics.
- Conservative fill ordering.
- Replay cost, funding, temporal provenance, diagnostics, and gate calculations.
- Replay-related pure hashing helpers.

## Inputs

- Local OHLCV manifests.
- Optional supplemental data refs.
- A compiled `ReplayStrategy`.

## Outputs

- `ReplayResult` and related replay contract types.
- Latest-signal evaluation shells used by research tools.

## Boundaries

- Does not write files, catalog, `trade.db`, or exchange state.
- Does not promote strategies.
- Does not call Binance write tools.
- Agent-facing execution belongs in future atomic runner modules, not this engine.
