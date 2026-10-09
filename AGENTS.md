# Project principles

- Agent first: external Agents choose research questions and methods. Use native Nautilus APIs and scripts; do not build a parallel research workflow, strategy language, matching engine or trading ledger.
- Strategy source is the primary product artifact. Bind each independent strategy to a fixed-capital native account. R1's 37 instruments form one strategy/account for the current replay.
- Use `BacktestNode` to load funding from the existing Catalog. `strategies/r1/native_node.py` validates inputs and derives native MARK updates from the prepared MARK bars; Nautilus owns settlement, orders, fills, risk and account state.
- Preserve reproducible research evidence and data lineage. A strategy, dependency or data change requires a new paired replay before claiming parity.
- Keep one current product blueprint in `docs/architecture.zh.md`. Record research/product findings under `docs/plans/`.
- During strategy R&D, keep hypotheses, results and next decisions in their attempt/run records; separately record material or recurring research-workbench gaps as product findings under `docs/plans/` with affected attempt IDs, blocked Agent task, evidence, iteration cost, workaround and smallest shared capability needed.
- Research backtests are read-only. Real trading, production writes, or changing a refusal or risk boundary require explicit user authority. Do not use exchange trading credentials for research.

## Research records and retained results

- Before extending a prior hypothesis or combining strategy variants, search the Dolt research records with `uv run --frozen python -m research.records.cli` (`find`, `show <id> --brief`, then full `show` or `compare` for evidence); use `material search` and `material show` for source material and archived research notes. Fix an exact Dolt commit with `--at` when citing a record snapshot. For a new hypothesis, commit its immutable attempt/preregistration receipt before inspecting its result, then publish the pending attempt to Dolt. Follow `research/records/README.md` for the record contract.
- Dolt is the single writer for research metadata and material revisions. Git owns strategy source, immutable preregistration receipts and retained source evidence; existing attempt/run JSON files are a read-only historical import. `--backend git` is an explicit history reader, not a write path or automatic fallback. An unavailable Dolt backend must fail visibly. Keep the database, configuration and backups outside Git and `/tmp`.
- Automatic material import preserves original bytes, hashes and source locations. It may extract explicit links and typed references; ambiguous support, correction, refutation or downstream impact requires Agent review. Append-only revisions are enforced by the publication API, not a claim that an administrator cannot change SQL data.
- Exploratory scripts and derived reports default to `/tmp`; maintained shared tools belong in Git. Keep one frozen JSON preregistration receipt under `research/records/preregistrations/`, then write later decisions only to Dolt from temporary payloads. A retained claim must explain its scope, decision value and evidence; verified rebuildable outputs are caches. Freeze only the one-off generator/dependencies needed for a retained conclusion in an external recipe, reference canonical inputs once, and verify reconstruction before removing dependent evidence. Material import is archival custody, not knowledge admission; use `material admit` for reviewed claims and `--include-archive` for historical source searches. The fixed `research/records/history.json` locates old source bytes without returning historical scripts/results to the current product tree.
- For a registered R1 tiered replay intended to inform a research decision, run the existing native runner through `uv run --frozen python -m research.records.artifacts run`, then verify, register and back up the sealed result as described in that guide. The artifact root is a configurable local directory outside Git and `/tmp`.
- Direct `run_portfolio.py` outputs under `/tmp` are useful for diagnostics and historical replay; label them temporary rather than recoverable research evidence. The Agent still chooses the question, method and next experiment; a passed artifact audit is not strategy qualification.

## Using Nautilus APIs

- Work against the version pinned in `pyproject.toml` and `uv.lock` (currently `nautilus_trader==2.0.0rc3`). Inspect the installed package and the runnable examples in `strategies/r1/` before assuming an API or behavior exists.
- When more detail is needed, search version-matched official Nautilus documentation or source. Treat current-version pages and community examples as leads until their behavior is verified against the pinned local package.
- Test uncertain API behavior with a small native probe. After changing a Strategy, data adapter, or Nautilus version, run the relevant native replay and inspect order integrity, fees, funding, and account results; rerun paired acceptance before claiming parity.

## Checks

- PR titles must use `type(scope): description` (or `type(scope)!: description` for a breaking change), with lowercase type and scope; for example, `research(r1): record D98 support failure`. Validate the actual title with `bash .github/scripts/validate-pr-title.sh "<title>"` before creating or editing a PR. Follow `.github/pull_request_template.md` for the body and report checks actually run.

Run `uv sync --frozen`, `uv run --frozen python strategies/r1/run_portfolio.py --help`, and the paired replay described in `strategies/r1/README.md` when its inputs are available. Inspect native order integrity and account economics; a successful process exit alone is insufficient.
