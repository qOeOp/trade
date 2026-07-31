# Binance Instrument Status Collector Contract

Owns a read-only acquisition of the current Binance USDⓈ-M `exchangeInfo` symbol status and its immutable acquisition receipt.

## Responsibilities

- Fetch the official public `/fapi/v1/exchangeInfo` endpoint without credentials or write APIs.
- Preserve every received response body as exact bytes in `market_data_store`; bind HTTP status, byte/hash/count, timestamps, failure class, retryability, and ordered attempt hashes.
- Emit only `source_capability=current_snapshot_only` and `external_authenticity=not_verified`.
- Commit a terminal receipt create-or-identical, including exhausted failures.
- Run a bounded resident foreground loop over the Market Data owner-selected symbol set. Reuse a fresh owner snapshot, fetch only stale/missing symbols, cap symbols/jobs/timeouts, persist a redacted health state, and drain on signals.

## Boundaries

- A REST snapshot is not a historical transition archive and cannot create an Archive Source Batch or `complete_history` evidence.
- Does not infer a halt from missing OHLCV, synthesize listing history, sign venue facts, choose datasets, or call any trading endpoint. The resident loop is lifecycle plumbing only and does not convert process health into evidence coverage.
- Retry history proves local acquisition behavior, not that Binance exposed every historical state transition.
