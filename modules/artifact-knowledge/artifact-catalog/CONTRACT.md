# Artifact Catalog Contract

## Owns

- `data_catalog.db` schema initialization
- Dataset, run, research report, evidence, panel, feature report, and artifact indexing
- Catalog query and stale artifact listing
- Catalog-aware GC and file-system artifact GC
- Feature report artifact registration
- Native `J06 catalog_hygiene_scan` domain job result for artifact-knowledge
- Live-root reconciliation skips unfinalized `.partial.*` files and SQLite sidecars, and reports bounded counts for transient skips and files that disappear after enumeration instead of failing the entire scan.

## Inputs

- Catalog DB path
- Runtime roots under `data/` or `tmp/`
- Artifact refs and retention settings
- Deployment `environment_id`; CLI input or `--environment-id` overrides `TRADE_ENVIRONMENT_ID`, which overrides `local:local`.
- Local OHLCV manifest refs for feature report generation

## Outputs

- Catalog query results
- Hash-verified, size-bounded text reads for cataloged artifacts
- Stale / kept / deleted artifact reports
- Registered artifact metadata
- Feature report artifact refs
- Domain-runtime job result with `artifact_catalog` write surface for J06
- Every database access is bound to the exact `artifact_catalog` deployment identity and fails closed on mismatch.

## Forbidden

- Writing `trade.db`
- Calling Binance APIs
- Reading arbitrary paths or catalog entries without an exact current content hash
- Making strategy promotion decisions
- Owning RD experiment logic
