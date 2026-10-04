//! One durable pointer per dataset: the single Source Binding a dataset's own identity was ever
//! admitted under, read back on every later call rather than re-admitted.
//!
//! `admit()` stamps the Owner's own fresh clock reading into a proposal's identity before deriving
//! it (`source_binding::authority::canonical_semantic_bytes`'s `encode_time_without_claim`), so
//! two calls admitting byte-identical proposal content at two different real instants still derive
//! two different `lineage_root`s - there is no way to make `admit()` itself idempotent across
//! calls. A dataset whose own semantic content never changes (a fixed public venue dataset, not a
//! corrected or renegotiated one) must therefore be admitted exactly once and have that one
//! admission's locator persisted here; every later caller reads this row back instead of admitting
//! again.
//!
//! `dataset_key` is the caller's own stable name for the dataset (for example
//! `"binance/usdm-perpetual/klines"`), never an exchange- or adapter-specific table of its own:
//! this table is generic across every dataset Market Data ever anchors this way.

pub(super) const SCHEMA_V1: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS market_data_private.source_binding_dataset_anchors_v1 (dataset_key TEXT PRIMARY KEY CHECK (octet_length(dataset_key) BETWEEN 1 AND 256), binding_id BYTEA NOT NULL CHECK (octet_length(binding_id)=32), fact_digest BYTEA NOT NULL CHECK (octet_length(fact_digest)=32), lineage_root BYTEA NOT NULL CHECK (octet_length(lineage_root)=32), lineage_version BIGINT NOT NULL CHECK (lineage_version>0), anchored_at_ns BIGINT NOT NULL CHECK (anchored_at_ns>0))",
    "REVOKE ALL ON TABLE market_data_private.source_binding_dataset_anchors_v1 FROM PUBLIC",
];
