# Backtest MCP

## Responsibility

This independent Cargo workspace is the thin MCP adapter for Backtest.
Keep protocol mapping here; run admission, durable execution and evidence belong to the backend.
Follow the [root principles](../../AGENTS.md) and [Backtest design](../../docs/owners/backtest.md).

## Source Entry Points

- [src/lib.rs](src/lib.rs): tool schemas, request mapping, response envelopes and adapter tests.
  Read `tools()` for the current exposed interface; avoid duplicating its inventory in guidance.
- [src/main.rs](src/main.rs): stdio transport, HTTP client and environment-held API credentials.
- [backtest_run_routes.rs](../../crates/strategy_factory_rd_owner_api/src/backtest_run_routes.rs): backend API entry.
- [engine.rs](../../crates/backtest/src/engine.rs): native Nautilus backtest engine.
  Open backend and native sources when changing execution behavior.

Extend Nautilus through native APIs; matching, Risk, Execution and Portfolio stay with their native owners.
Do not add an engine, run ledger or research optimizer to this adapter.
A tool declaration does not prove a completed replay or an accessible report.
Keep credentials out of tool arguments, results and logs.

## Checks

Run `make check-backtest-mcp` from the repository root for code changes.
It checks formatting, Clippy and tests in this service's own workspace.
For backend changes, also run the affected Owner checks required by the root instructions.
Documentation-only edits use the applicable pre-commit checks.
