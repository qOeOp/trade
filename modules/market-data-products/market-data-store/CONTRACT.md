# Market Data Store Contract

Owns `market_data_store` for market manifests, admitted L2 epoch manifests, immutable L2 experiment-attachment referrer receipts, funding events, feature manifests, immutable instrument-status archives, and immutable aggregate-trade archives, plus `ohlcv_store` for canonical candles.

## Responsibilities

- Create and migrate the market data / OHLCV store schemas.
- Upsert source/data manifests by content hash.
- Admit only `complete` Rust L2 epoch proposals after exact snapshot hash, snapshot update id, TL2S header/frame CRC, segment byte/hash/count, sibling-ref, repo runtime-path, and epoch count closure checks; commit epoch plus segment index create-or-identical.
- Label admitted L2 scope as `epoch_contiguous` and external completeness as `not_verified`; preserve but reject `incomplete` proposals from the formal Replay/RD source catalog.
- Reconcile finalized manifest trees idempotently, deduplicate observations by path plus exact content hash, and preserve bounded rejection reasons for incomplete or invalid proposals.
- Issue at most one immutable compaction job per admitted epoch; admit only a proposal that closes the exact owner-issued job, source manifest, row count, Parquet byte length and hash.
- Advance successfully compacted epochs from `raw_hot` to `compacted_pinned` with an immutable compaction ref while keeping `deletion_eligible=0`. Raw deletion requires a separate catalog/referrer and GC gate.
- Expose a self-hashed compacted-epoch source descriptor only when the exact compaction ref remains owner-pinned and non-deletable; the descriptor is a read contract, not Replay execution authority.
- Register one create-or-identical immutable referrer receipt from the complete self-hashed `Replay L2 Experiment Attachment Authority v1` returned by the Control Plane owner read port. Revalidate the frozen authority shape/hash and exact local compacted source; persist only hashes/bounds and no Trial、Request、Dataset or raw-row body.
- Keep referrer registration observational: it does not change `l2_epoch_retention`, never sets `deletion_eligible=1`, and grants no GC、Replay Runner、Fill、queue or economic authority. A separate future GC gate must treat live referrers as blockers rather than infer deletion from compaction or receipt presence.
- Insert canonical candles into `ohlcv_store` keyed by exchange/symbol/timeframe/open time.
- Insert funding events keyed by exchange/symbol/funding time.
- Register feature manifests derived from source manifests.
- Commit self-hashed instrument-status Acquisition Receipt v1 with ordered attempt history and exact response payload bytes; preserve terminal failures and create-or-identical retries.
- Commit finalized venue instrument-status Archive v3 with create-or-identical CAS; preserve ordered transitions, acquisition-bound source-batch manifests, batch content/hash chain, declared coverage/finality, continuity audit, and archive hash.
- Admit a Source Batch only when it binds a stored, successful `historical_event_archive` receipt whose venue/symbol/window/watermark/raw hash/count and payload all match. A `current_snapshot_only` receipt is never promotable.
- Admit only gap-free, overlap-free source-batch windows whose linked record counts close the normalized event set. The audit scope is `batch_window_continuity`; `external_completeness` is always `not_verified`.
- Preserve corrections as an append-only, same-scope, single-successor `supersedes_archive_hash` chain; never mutate or hide the predecessor.
- Serve acquisition receipt metadata and an archive by id through owner read ports; raw BLOB reads remain an integrity/audit library surface, not a default CLI payload.
- Import Binance USD-M historical aggregate-trade JSON only through an explicit `offline_import` source receipt; preserve exact source bytes and create-or-identical Archive v1.
- Deterministically normalize `a/p/q/f/l/T/m` into one-symbol ordered events; require contiguous aggregate ids, non-decreasing trade time, half-open window membership, source finality, and raw-byte/receipt/audit/archive hash closure.
- Label aggregate-trade availability as trade-time resolution-limited and local completeness as `not_verified`; never promote recent REST reads or local id continuity into external complete-history authority.

## Boundaries

- Does not own trading decisions or position state.
- Does not write `trade.db`.
- Does not call exchange write APIs.
- Does not ingest WebSocket frames, own the current order book, write Parquet, mutate Rust evidence files, delete raw evidence, or infer continuity across L2 epochs.
- Does not store research experiment results; those remain artifacts/evidence refs.
- Does not open or query the Control Plane database, prove remote caller identity, or replace the Control Plane registry. Registration accepts only the complete owner-read authority snapshot and verifies its self-hash plus local source binding.
- Does not normalize status epochs, infer missing events, select a canonical/latest correction, or certify external venue completeness, authenticity, signature, transport identity, source-system exhaustiveness, dissemination latency, or cross-source ordering.
