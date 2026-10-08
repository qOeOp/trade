# Project principles

- Agent first: external Agents choose research questions and methods. Use native Nautilus APIs and scripts; do not build a parallel research workflow, strategy language, matching engine or ledger.
- Strategy source is the primary product artifact. Bind each independent strategy to a fixed-capital native account. R1's 37 instruments form one strategy/account for the current replay.
- Keep adapters thin and explicit. `strategies/r1/funding_catalog.py` only decodes the legacy research funding format; Nautilus owns settlement, orders, fills, risk and account state.
- Preserve reproducible research evidence and data lineage. A strategy, dependency or data change requires a new paired replay before claiming parity.
- Keep one current product blueprint in `docs/architecture.zh.md`. Record research/product findings under `docs/plans/`.
- Research backtests are read-only. Real trading, production writes, or changing a refusal or risk boundary require explicit user authority. Do not use exchange trading credentials for research.

## Checks

Run `uv sync --frozen`, `uv run --frozen python strategies/r1/run_portfolio.py --help`, and the paired replay described in `strategies/r1/README.md` when its inputs are available. Inspect native order integrity and account economics; a successful process exit alone is insufficient.
