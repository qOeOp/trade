# Research record pilot

This is a small, read-only pilot for downstream research Agents. Strategy source
and native Nautilus reports remain the authorities. Seven attempt records and
four historical run records are **retrospective transcriptions** of
[`RD_EXPERIMENTS.md`](../r1_native/RD_EXPERIMENTS.md) and the hashed reports under
`research/r1_native/results/`. The eighth attempt, F01, was registered before
its new combined strategy and economic result; four new same-runner native
replays fill its 00/10/01/11 family. These eight attempts and eight runs are
development evidence, not independent strategy qualification.

Run from the repository root:

```bash
uv sync --frozen
uv run --frozen python -m research.records.cli validate
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
retained in Git. This pilot does not claim a durable artifact store or restore
capability. Automated write-side capture, source-bundle freezing, and persistent
native report custody remain design work in
[`docs/plans/research-record-contract.zh.md`](../../docs/plans/research-record-contract.zh.md).
