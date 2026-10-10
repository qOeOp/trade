# Agent rules

External Agents choose research questions and methods. This repository supplies the skills, the
contracts enforced by code (Dolt publication API, digest-pinned OCI runtime) and published Nautilus.
Blueprint: `docs/architecture.zh.md` (English twin `docs/architecture.md`).

## Needs the user's explicit authority

Stop and ask before any of these:

- Real trading, live venue connections or exchange trading credentials. Research never uses them.
- Destructive writes: resetting or clearing the Dolt ledger; rewriting or deleting published
  records, sealed artifacts, artifact or database backups, retained runtime images, canonical
  Catalog inputs or historical receipts.
- Changing (relaxing or tightening) a refusal, audit check, risk limit or research goal in code,
  tests, configuration or a skill, including to get past a failing check.

Tests, demos and engineering trials write only to an isolated Dolt database, never the active
ledger: publication is append-only.

## Code or Agent

- Add product code (records, replay, shared tools) only for a trust boundary (otherwise the Agent
  grades its own work), a fix to an existing defect, or something an Agent cannot do (atomic writes,
  concurrency, permissions). Everything else is Agent work guided by a skill; strategy source and
  `/tmp` scripts are Agent work, not product code.
- Nautilus owns orders, fills, settlement, risk and account state. Do not build a parallel engine,
  ledger, strategy language, scheduler or research workflow.
- Before adding a stored field, get an independent sub-agent review (its consumer, the independent
  fact, why existing fields, relations or derivation cannot express it) and record the decision
  under `docs/plans/`.

## Where things go

- By default, strategy drafts, exploratory scripts and derived reports go in `/tmp`; evidence a
  decision cites is retained outside Git and `/tmp` (see `research-round`).
- Complete strategy source (one UTF-8 file per independent strategy), research records and
  decisions: Dolt. Write attempts, runs and strategies only through their `python -m
  research.records.cli` / `research.records.artifacts` commands, never through the raw store
  adapter or direct SQL; evidence originals through `material retain`. No strategy bodies
  or new experiment receipts in Git.
- Product and workbench findings: `docs/plans/`. Skills: `.agents/skills/` only (`.claude/skills` is
  a symlink to it).

## Skills

- `research-round`: before running a backtest for a research question, publishing an attempt,
  choosing the next experiment, or claiming that a strategy improved, failed or generalized.
- `native-report-analysis`: before computing any statistic from sealed native reports.

## Nautilus and parity

- Check Nautilus APIs against the version pinned in `uv.lock` and the code in `backtest/r1/`; probe
  uncertain behavior natively. Registered runs execute the image, so a `backtest/r1` edit reaches
  them only through a new image digest.
- When a change should preserve behavior (strategy refactor, data adapter, dependency or Nautilus
  version), run the paired native replay in `backtest/r1/README.md` before claiming parity. Inspect
  causal clocks, order protection and integrity, fees, funding and account economics; a clean exit
  or green tests is not parity. A research change to a strategy follows `research-round` instead.

## Checks and PRs

- Code changes: `uv run --frozen python -m unittest discover -s tests -t . -p 'test_*.py'` (Dolt
  integration tests skip unless `RESEARCH_DOLT_TEST_CONFIG` is set; see `research/records/README.md`).
- PR titles are lowercase `type(scope): description` (`type(scope)!:` when breaking); check with
  `bash .github/scripts/validate-pr-title.sh "<title>"`. The body follows
  `.github/pull_request_template.md` and reports only checks actually run.
