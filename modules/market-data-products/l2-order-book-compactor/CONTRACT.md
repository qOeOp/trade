# L2 Order Book Compactor Contract

Deterministic Rust worker that converts one owner-admitted complete TL2S epoch into one bounded-schema Parquet proposal.

## Owns

- Re-verification and ordered decoding of finalized TL2S segment frames.
- Batched Arrow RecordBatch construction and Zstd Parquet writing.
- Create-new Parquet and compaction proposal publication.
- Bounded Parquet reads for parity and future Replay adapters.

## Boundaries

- Consumes a TypeScript owner-issued compaction job; never scans for authority or writes SQLite.
- Does not compact incomplete epochs, cross epoch boundaries, infer gaps, or mutate raw evidence.
- A proposal is not owner-admitted merely because this worker produced it.
- Raw deletion remains disabled after compaction; owner state advances only to `compacted_pinned`.

## Commands

- `cargo run -- --action compact --job-file tmp/l2-order-book-compactor/job.json`
- `cargo run -- --action read --parquet data/l2-parquet/BTCUSDT/<epoch>.parquet --offset 0 --limit 100`
- `cargo fmt --all -- --check`
- `cargo check`
- `cargo clippy --all-targets -- -D warnings`
- `cargo test`
