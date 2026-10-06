# Market Data MCP

## Responsibility

This independent Cargo workspace is the thin MCP adapter for Market Data.
Keep protocol mapping here; data preparation, validation, custody and durable jobs belong to the backend.
Follow the [root principles](../../AGENTS.md) and [Market Data design](../../docs/owners/market-data.md).

## Source Entry Points

- [src/lib.rs](src/lib.rs): tool schemas, request mapping, response envelopes and adapter tests.
  Read `tools()` for the current exposed interface; avoid duplicating its inventory in guidance.
- [src/main.rs](src/main.rs): stdio transport, HTTP client and environment-held API credentials.
- [market_data_pit.rs](../../crates/strategy_factory_rd_owner_api/src/market_data_pit.rs): backend API entry.
  Open backend sources when changing domain behavior, rather than adding that behavior to this adapter.

Use Nautilus data APIs and shared types through their existing modules.
A tool declaration does not prove backend availability or permission to read protected data.
Keep credentials out of tool arguments, results and logs.

## Checks

Run `make check-market-data-mcp` from the repository root for code changes.
It checks formatting, Clippy and tests in this service's own workspace.
For backend changes, also run the affected Owner checks required by the root instructions.
Documentation-only edits use the applicable pre-commit checks.
