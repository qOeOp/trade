# Market Data Store Contract

Owns `market_data_store` for market manifests, funding events, feature manifests, and immutable instrument-status archives, plus `ohlcv_store` for canonical candles.

## Responsibilities

- Create and migrate the market data / OHLCV store schemas.
- Upsert source/data manifests by content hash.
- Insert canonical candles into `ohlcv_store` keyed by exchange/symbol/timeframe/open time.
- Insert funding events keyed by exchange/symbol/funding time.
- Register feature manifests derived from source manifests.
- Commit finalized venue instrument-status archives with create-or-identical CAS; preserve ordered raw transitions, declared coverage/finality, source identity, and archive hash.
- Serve an archive by id to the read-only instrument-status provider.

## Boundaries

- Does not own trading decisions or position state.
- Does not write `trade.db`.
- Does not call exchange write APIs.
- Does not store research experiment results; those remain artifacts/evidence refs.
- Does not normalize status epochs, infer missing events, or certify external venue completeness.
