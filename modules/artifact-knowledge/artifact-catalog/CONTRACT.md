# Artifact Catalog Contract

## Owns

- `data_catalog.db` schema initialization
- Dataset, run, research report, evidence, panel, feature report, and artifact indexing
- Catalog query and stale artifact listing
- Catalog-aware GC and file-system artifact GC
- Feature report artifact registration
- Native `J06 catalog_hygiene_scan` domain job result for artifact-knowledge

## Inputs

- Catalog DB path
- Runtime roots under `data/` or `tmp/`
- Artifact refs and retention settings
- Local OHLCV manifest refs for feature report generation

## Outputs

- Catalog query results
- Hash-verified, size-bounded text reads for cataloged artifacts
- Stale / kept / deleted artifact reports
- Registered artifact metadata
- Feature report artifact refs
- Domain-runtime job result with `artifact_catalog` write surface for J06

## Forbidden

- Writing `trade.db`
- Calling Binance APIs
- Reading arbitrary paths or catalog entries without an exact current content hash
- Making strategy promotion decisions
- Owning RD experiment logic
