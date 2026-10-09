# Research records and local artifact custody

Git records are the research lineage; the native runner and Nautilus reports
remain the trading facts. Ten attempt records, including H25a/H26a/H27a, and
ten historical run records are **retrospective transcriptions** of
[`RD_EXPERIMENTS.md`](../r1_native/RD_EXPERIMENTS.md) and the hashed reports under
`research/r1_native/results/`. The eighth attempt, F01, was registered before
its new combined strategy and economic result; four new same-runner native
replays fill its 00/10/01/11 family. One later sealed 37-coin repeat brings the
index to eleven attempts and fifteen runs. The H25a/H26a/H27a raw reports
remain `temporary`; their structured entries do not backdate registration or
seal their old `/tmp` CSVs. These are development evidence, not
independent strategy qualification.

## One research round (Agent-owned)

The research Agent chooses the next question and the smallest experiment that
can falsify it. The user supplies the research goal and risk boundaries, not
instructions for every candidate. Before extending or combining hypotheses,
use `find`, then `show <id> --brief`; open full `show`, `compare`, and cited
native reports where the decision depends on them. Name the precise prior
claim supported or rejected, the hypothesis parent(s), any reused component,
the source parent, and the economic control. A reused component does not
inherit its source attempt's whole hypothesis or result.

Before inspecting a **new** result, write a short preregistration Markdown
file under `docs/plans/` and a pending `attempt.json` under
`research/records/attempts/<id>/`.
The Markdown must answer these questions in concrete terms:

1. What single mechanism changes, which native event should reveal its
   activation, and what observation would refute the mechanism? State source,
   data, execution, and economic stop conditions separately.
2. Which comparison is legal? Name the frozen control, strategy/account,
   input identity, instrument set, window, capital, risk and cost assumptions,
   source and dependency revision, primary **net account** response, and hard
   risk limits. Use a parent/child pair if B only exists with A; use `00/10/01/11`
   only when both changes can be independently switched on the same origin.
3. Which candidates were considered, what selection rule and maximum number
   of new runs are allowed, and which prior data windows, metrics, and results
   have already been seen? Name the data that can still provide independent
   confirmation, or state that none is available. Failed source or pilot gates
   remain in the candidate history; do not relabel a viewed window as holdout.
4. What observation selects the next action: stop, repair a data/execution
   defect, retain for independent confirmation, or ask a narrower question?
   Predefine the action threshold without reading the new economic result.

Initially commit the pending `attempt.json` and Markdown together, with
`registration.reference` pointing to the Markdown,
`decision.layer=decision.outcome=pending`, and
without a self-referential `original_registration_commit`. Then record that
first commit in `original_registration_commit` in a second commit. Use a source
revision descended from the registration commit for the native custody run.
This two-commit sequence lets the runner check that a registration commit
exists before it runs; the Agent must still inspect the content and timing of
that commit. Do not fill `comparison_family` with nonexistent run IDs; add the
actual IDs after the runs. Keep result-derived fields and interpretation out
of the preregistration revision. The current schema does not have dedicated
`falsifier`, `selection_rule`, or `exposure` fields, and `validate` does not
check the four Markdown answers; these are Agent review obligations, not
machine-enforced gates.

After a run, verify/register its native artifact and read the legal pair.
Give feedback in this order: question and control; verified native facts with
report references; unknown or unproven links; a falsifiable explanation; one
smallest next experiment and its stop condition. Distinguish a valid run from
an economically good strategy. An exposed development window can reject the
current candidate under its preregistered rule, but cannot by itself confirm
a selected strategy independently. If the evidence cannot distinguish two
explanations, report that limit rather than selecting the larger backtest
number. See [F01 preregistration](../../docs/plans/r1-factorial-line-cancel-prereg.zh.md)
for a four-cell design example; it predates this checklist and is not a
complete template for search budget and exposure. The [stepwise plan](../../docs/plans/rd-experiment-native-evidence-plan.zh.md)
describes how this contract will be evaluated.

Run from the repository root:

```bash
uv sync --frozen
TRADE_RESEARCH_ARTIFACT_ROOT=/path/to/local/artifacts uv run --frozen python -m research.records.cli validate
uv run --frozen python -m research.records.cli show H13c
uv run --frozen python -m research.records.cli show H18a
uv run --frozen python -m research.records.cli show F01
uv run --frozen python -m research.records.cli show F01 --brief
uv run --frozen python -m research.records.cli find --mechanism 61.8% --failure-layer source
uv run --frozen python -m research.records.cli compare H19a-2026-10-08 H18a-paired-2026-10-08
uv run --frozen python -m research.records.cli compare H18a-2026-10-08 H15a-paired-2026-10-08
uv run --frozen python -m research.records.cli compare F01-11-20261008 F01-10-20261008
```

Use `show <attempt-id> --brief` first for the hypothesis chain, decision,
four-cell run IDs, and evidence availability; use full `show` when checking
the exact record and report references. The compact view never substitutes
for `compare` or the native reports when deciding whether a result improved.

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

## Access, retention, and disaster recovery

The configured artifact root and backup root must be owned by the account
running custody and have mode `0700`. New sealed and restored directories use
`0700`; files use `0600`. The command rejects a permissive root instead of
silently changing a shared directory when creating a run or backup. On an existing root, restrict the root,
all run directories, and files before the next write, then run `verify` again.
Do not put exchange credentials in the artifact root.

Git records and sealed runs, including failed runs, have **no automatic expiry**:
retain them while a Git run record cites their hashes. A deletion requires an
explicit research decision, a record update marking unavailable evidence, and
a verified replacement or an accepted loss of replay detail. This version has
no deletion command. Review abandoned `.staging` and `.quarantine` directories
after seven days; after checking no live lock or registered run depends on
them, remove unneeded diagnostic copies within 30 days. They are not sealed
evidence. Monitor disk capacity before starting large native replays; move the
root to larger storage rather than pruning referenced runs to free space.

`backup` proves a second copy has the same bytes; its result reports
`same_device_as_primary`. A second directory on the same machine is only local
copy recovery. To accept disaster recovery, place the backup on a separately
administered host or object store, record its owner and physical storage
boundary, verify the manifest there, make the primary unavailable, and restore
the reports on that independent host. Recheck the restored hashes against the
Git run record. Repeat a restore drill at least quarterly. An SSH or object
storage destination needs a separately authorized transport or mounted remote
filesystem; this CLI accepts filesystem paths only. Catalog inputs are not
copied by this command and need their own recovery plan.
