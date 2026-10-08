# Project principles

- Agent first: external Agents choose research questions and methods. Use native Nautilus APIs and scripts; do not build a parallel research workflow, strategy language, matching engine or ledger.
- Strategy source is the primary product artifact. Bind each independent strategy to a fixed-capital native account. R1's 37 instruments form one strategy/account for the current replay.
- Use `BacktestNode` to load funding from the existing Catalog. `strategies/r1/native_node.py` validates inputs and derives native MARK updates from the prepared MARK bars; Nautilus owns settlement, orders, fills, risk and account state.
- Preserve reproducible research evidence and data lineage. A strategy, dependency or data change requires a new paired replay before claiming parity.
- Keep one current product blueprint in `docs/architecture.zh.md`. Record research/product findings under `docs/plans/`.
- Research backtests are read-only. Real trading, production writes, or changing a refusal or risk boundary require explicit user authority. Do not use exchange trading credentials for research.

## Research records and retained results

- Before extending a prior hypothesis or combining strategy variants, search the Git research index with `uv run --frozen python -m research.records.cli` (`find`, `show`, or `compare`). For a new hypothesis, commit its attempt and preregistration before inspecting its result. Follow `research/records/README.md` for the record contract.
- For a registered R1 tiered replay intended to inform a research decision, run the existing native runner through `uv run --frozen python -m research.records.artifacts run`, then verify, register and back up the sealed result as described in that guide. The artifact root is a configurable local directory outside Git and `/tmp`.
- Direct `run_portfolio.py` outputs under `/tmp` are useful for diagnostics and historical replay; label them temporary rather than recoverable research evidence. The Agent still chooses the question, method and next experiment; a passed artifact audit is not strategy qualification.

## Using Nautilus APIs

- Work against the version pinned in `pyproject.toml` and `uv.lock` (currently `nautilus_trader==2.0.0rc3`). Inspect the installed package and the runnable examples in `strategies/r1/` before assuming an API or behavior exists.
- When more detail is needed, search version-matched official Nautilus documentation or source. Treat current-version pages and community examples as leads until their behavior is verified against the pinned local package.
- Test uncertain API behavior with a small native probe. After changing a Strategy, data adapter, or Nautilus version, run the relevant native replay and inspect order integrity, fees, funding, and account results; rerun paired acceptance before claiming parity.

## Checks

Run `uv sync --frozen`, `uv run --frozen python strategies/r1/run_portfolio.py --help`, and the paired replay described in `strategies/r1/README.md` when its inputs are available. Inspect native order integrity and account economics; a successful process exit alone is insufficient.
