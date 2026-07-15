# Market Data Store Contract

Owns `market_data_store` for market manifests, funding events, feature manifests, and immutable instrument-status archives, plus `ohlcv_store` for canonical candles.

## Responsibilities

- Create and migrate the market data / OHLCV store schemas.
- Upsert source/data manifests by content hash.
- Insert canonical candles into `ohlcv_store` keyed by exchange/symbol/timeframe/open time.
- Insert funding events keyed by exchange/symbol/funding time.
- Register feature manifests derived from source manifests.
- Commit self-hashed instrument-status Acquisition Receipt v1 with ordered attempt history and exact response payload bytes; preserve terminal failures and create-or-identical retries.
- Commit finalized venue instrument-status Archive v3 with create-or-identical CAS; preserve ordered transitions, acquisition-bound source-batch manifests, batch content/hash chain, declared coverage/finality, continuity audit, and archive hash.
- Admit a Source Batch only when it binds a stored, successful `historical_event_archive` receipt whose venue/symbol/window/watermark/raw hash/count and payload all match. A `current_snapshot_only` receipt is never promotable.
- Admit only gap-free, overlap-free source-batch windows whose linked record counts close the normalized event set. The audit scope is `batch_window_continuity`; `external_completeness` is always `not_verified`.
- Preserve corrections as an append-only, same-scope, single-successor `supersedes_archive_hash` chain; never mutate or hide the predecessor.
- Serve acquisition receipt metadata and an archive by id through owner read ports; raw BLOB reads remain an integrity/audit library surface, not a default CLI payload.

## Boundaries

- Does not own trading decisions or position state.
- Does not write `trade.db`.
- Does not call exchange write APIs.
- Does not store research experiment results; those remain artifacts/evidence refs.
- Does not normalize status epochs, infer missing events, select a canonical/latest correction, or certify external venue completeness, authenticity, signature, transport identity, or source-system exhaustiveness.
