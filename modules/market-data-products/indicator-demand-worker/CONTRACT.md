# Indicator Demand Worker Contract

## Owns

- One long-running compute worker for explicitly supported `indicator_set` demands.
- Exact binding to a compatible OHLCV demand、zero-gap owner audit、immutable candle slice、closed-world Go provider flags、deterministic normalized feature artifact and create-or-identical owner admission.

## Boundaries

- Does not fetch candles、guess an indicator set、accept code / command / path from callers、or compute against incomplete / stale source coverage.
- Provider `generated_at`、host path and prose report are excluded from artifact identity. Same source slice + feature set + provider values must reproduce the same content hash across hosts.
- Does not write `trade.db`、make strategy decisions、promote strategies、call exchange write APIs or control another daemon.
