# Research records and local artifact custody

Git records are the research lineage; the native runner and Nautilus reports
remain the trading facts. Seven attempt records and
four historical run records are **retrospective transcriptions** of
[`RD_EXPERIMENTS.md`](../r1_native/RD_EXPERIMENTS.md) and the hashed reports under
`research/r1_native/results/`. The eighth attempt, F01, was registered before
its new combined strategy and economic result; four new same-runner native
replays fill its 00/10/01/11 family. One later sealed 37-coin repeat brings the
index to eight attempts and nine runs. These are development evidence, not
independent strategy qualification.

Run from the repository root:

```bash
uv sync --frozen
TRADE_RESEARCH_ARTIFACT_ROOT=/path/to/local/artifacts uv run --frozen python -m research.records.cli validate
uv run --frozen python -m research.records.cli show H13c
uv run --frozen python -m research.records.cli show H18a
uv run --frozen python -m research.records.cli show F01
uv run --frozen python -m research.records.cli find --mechanism 61.8% --failure-layer source
uv run --frozen python -m research.records.cli compare H19a-2026-10-08 H18a-paired-2026-10-08
uv run --frozen python -m research.records.cli compare H18a-2026-10-08 H15a-paired-2026-10-08
uv run --frozen python -m research.records.cli compare F01-11-20261008 F01-10-20261008
```

`validate` checks JSON Schema, references, SHA-256 of retained small reports,
the H19a/H18a summary's recorded window/account/source fields, and the native
audit result. For the H18a/H15a pair it also checks that four recorded source
file byte hashes match Git blobs at the frozen `e5a882101` commit. Other runs
without `source_revision` remain `unknown`. It reports whether cited registration
Git commit objects are present; that presence alone does not prove what was
registered or when results were read.
`compare` refuses a different registered control, input receipt,
window, account contract, recorded cost model, Nautilus version, instrument
universe, or failed audit. Its differences are descriptive on the already
exposed year. A recorded contract match does not independently prove matching
fees, funding, raw data bytes, or current availability of every CSV. The
historical `code_parent` commits are references to frozen source; this pilot
does not reconstruct a complete executable source and dependency bundle from them.

H18a is a real dependent-composition check: its hypothesis extends H15a, while
its line-state component comes from H08. H08's complete entry rule failed a
source gate; H18a does not inherit that rule. H18a's cancellation action only
exists for H15a's pending tiers, so a standalone H08 cell and a four-cell
factorial interaction are undefined. See the
[`case study`](../../docs/plans/research-record-h18a-case.zh.md).

F01's [four-cell result](../../docs/plans/r1-factorial-line-cancel-result.zh.md)
and [comparison report](../../reports/r1_factorial_f01/comparison.json) show
that the family can be indexed and read back even when the 11 cell fails its
economic goal. The historical and F01 full CSV reports currently live in
`/tmp` and are marked `temporary`; the small JSON reports and their hashes are
retained in Git. The new custody command below does not retroactively make these
old `/tmp` runs sealed. The contract and limits are in
[`docs/plans/research-record-contract.zh.md`](../../docs/plans/research-record-contract.zh.md).

## Seal a new native R1 run

Use a directory outside Git and `/tmp`; the path below is an example. The
attempt must already have a committed preregistration. `--source-ref` identifies
the frozen strategy commit. The wrapper runs the **existing** native
`run_portfolio.py` from those exact source bytes, not a second backtest engine.
For a new input dataset, first create and review its identity with
`research.records.artifacts input-identity --catalog-root ... --daily-root ...
--quantity-csv ... --coins ... --output ...` and commit that small JSON file.

```bash
ARTIFACT_ROOT=/Users/vx/.local/share/trade/research-artifacts
uv run --frozen python -m research.records.artifacts run \
  --root "$ARTIFACT_ROOT" --run-id MY-RUN-ID --attempt-id MY-ATTEMPT-ID \
  --source-ref MY-FROZEN-COMMIT \
  --input-identity research/r1_native/results/2026-10-07-input-identity.json -- \
  --catalog-root /path/to/minute-catalog --daily-root /path/to/daily-catalog \
  --quantity-csv /path/to/quantities.csv --coins BTC ETH \
  --start 2025-10-07T00:00:00Z --trade-start 2025-10-17T00:00:00Z \
  --end 2026-10-07T08:30:00Z \
  --signal-variant support-broad-two-tier-line-cancel-4h \
  --exit-variant tier-target-b --risk-budget-bps 25 \
  --coin-notional-cap-pct 5
```

The wrapper currently covers **R1 tiered variants with the pinned native tier
auditor**. It hashes selected minute/daily Catalog trees and quantity CSV before
and after replay, saves frozen source, lockfile, stdout/stderr, the six native
reports and the native audit, then atomically publishes `<root>/<run-id>`.
It never overwrites an existing run ID. A failed process also gets a sealed
`failed` manifest and remains available for diagnosis. `passed` means these
integrity checks passed; it does not mean that the strategy meets its economic
goal. The local root needs its own backup plan before disaster-recovery claims.

```bash
uv run --frozen python -m research.records.artifacts verify --root "$ARTIFACT_ROOT" --run-id MY-RUN-ID
uv run --frozen python -m research.records.artifacts backup --root "$ARTIFACT_ROOT" --run-id MY-RUN-ID --backup-root /path/to/second/local/directory
uv run --frozen python -m research.records.artifacts restore --root "$ARTIFACT_ROOT" --run-id MY-RUN-ID --destination /path/to/new/empty/output
uv run --frozen python -m research.records.artifacts register --root "$ARTIFACT_ROOT" --run-id MY-RUN-ID --role diagnostic --cost-model 'frozen native fees and Catalog funding'
TRADE_RESEARCH_ARTIFACT_ROOT="$ARTIFACT_ROOT" uv run --frozen python -m research.records.cli validate
```

`register` writes a schema-checked `run.json` into the Git worktree. Review and
commit it with the strategy/research history; it binds the external manifest by
SHA-256. The read-only record CLI resolves `artifact://` refs through
`TRADE_RESEARCH_ARTIFACT_ROOT`. A failed run can be registered as a diagnostic
without inventing a native summary. Full raw inputs are referenced by their
verified identity and remain in the source Catalog.

The second directory can recover a run after the primary directory is lost;
placing both on one disk does not protect against disk loss. Interrupted staging
is retained under `.staging` or `.quarantine` for inspection; only a directory
with a verified final manifest is a sealed run.
