# Market Data Store Contract

Owns `market_data_store`, the logical store for market data manifests, canonical candles, funding events, and feature manifests.

## Responsibilities

- Create and migrate the market data store schema.
- Upsert source/data manifests by content hash.
- Insert canonical candles keyed by exchange/symbol/timeframe/open time.
- Insert funding events keyed by exchange/symbol/funding time.
- Register feature manifests derived from source manifests.

## Boundaries

- Does not own trading decisions or position state.
- Does not write `trade.db`.
- Does not call exchange write APIs.
- Does not store research experiment results; those remain artifacts/evidence refs.

