# Market Data Store Contract

Owns `market_data_store` for market manifests, funding events, and feature manifests, plus `ohlcv_store` for canonical candles.

## Responsibilities

- Create and migrate the market data / OHLCV store schemas.
- Upsert source/data manifests by content hash.
- Insert canonical candles into `ohlcv_store` keyed by exchange/symbol/timeframe/open time.
- Insert funding events keyed by exchange/symbol/funding time.
- Register feature manifests derived from source manifests.

## Boundaries

- Does not own trading decisions or position state.
- Does not write `trade.db`.
- Does not call exchange write APIs.
- Does not store research experiment results; those remain artifacts/evidence refs.
