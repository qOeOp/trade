# Market Data Store Contract

Owns `market_data_store` for market manifests, funding events, feature manifests, and immutable instrument-status archives, plus `ohlcv_store` for canonical candles.

## Responsibilities

- Create and migrate the market data / OHLCV store schemas.
- Upsert source/data manifests by content hash.
- Insert canonical candles into `ohlcv_store` keyed by exchange/symbol/timeframe/open time.
- Insert funding events keyed by exchange/symbol/funding time.
- Register feature manifests derived from source manifests.
- Commit finalized venue instrument-status Archive v2 with create-or-identical CAS; preserve ordered transitions, source-batch manifests, batch content/hash chain, declared coverage/finality, continuity audit, and archive hash.
- Admit only gap-free, overlap-free source-batch windows whose linked record counts close the normalized event set. The audit scope is `batch_window_continuity`; `external_completeness` is always `not_verified`.
- Preserve corrections as an append-only, same-scope, single-successor `supersedes_archive_hash` chain; never mutate or hide the predecessor.
- Serve an archive by id to the read-only instrument-status provider.

## Boundaries

- Does not own trading decisions or position state.
- Does not write `trade.db`.
- Does not call exchange write APIs.
- Does not store research experiment results; those remain artifacts/evidence refs.
- Does not normalize status epochs, infer missing events, select a canonical/latest correction, or certify external venue completeness, authenticity, signature, or source-system exhaustiveness.
