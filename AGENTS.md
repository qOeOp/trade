# Agent rules

External Agents choose research questions and methods. This repository supplies the skills, the
contracts enforced by code (Dolt research ledger, digest-pinned OCI runtime) and published Nautilus.
Blueprint: `docs/architecture.zh.md` (English twin `docs/architecture.md`).

## Needs the user's explicit authority

Stop and ask before any of these:

- Real trading, live venue connections or exchange trading credentials. Research never uses them.
- Destructive writes: resetting or clearing the Dolt ledger; rewriting or deleting published
  records or stored runs, old sealed artifacts, database backups, retained runtime images, canonical
  Catalog inputs or historical receipts.
- Changing (relaxing or tightening) a refusal or audit check in code, tests, configuration or a
  skill, or either of the user's two research targets (maximum drawdown and minimum annual
  return), including to get past a failing check. Win rate is a report dimension, not a target.

Position size, per-plan risk and notional limits are the Agent's design variables, set in strategy
source. Changing them needs no authority and never turns them into user constraints.

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

- Persistent research data lives only in the Dolt ledger (and its `dolt_backup` copy), and only
  what a replay cannot give back: decisions and declarations (registrations, judgments, source
  reviews, research lines, out-of-sample registrations); observations that cannot recur (failure
  logs, source originals, timestamp tokens, market data); the minimal identity to reproduce the
  rest (complete strategy source, one UTF-8 file per independent strategy; runtime image digest;
  market commit; configuration and input identity); and readings computed once at sealing (audit
  and eligibility verdicts, metrics, report measures, daily returns) with fingerprints of the
  native reports. Store each fact once and never what stored data derives. Native reports and
  other replay outputs are cache: regenerate them into `/tmp` and check them against the
  fingerprints with the semantic report comparison. Reports already stored stay as they are until
  the ledger is rebuilt against the design. Everything else (drafts, exploratory scripts, replay
  outputs, media, derived reports) is a working copy in `/tmp`.
- Write to the ledger only through the command line `python -m cli.main` (its `replay` commands
  included), never with direct SQL or another account. No strategy bodies or experiment receipts in
  Git.
- Product and workbench findings: `docs/plans/`. Skills: `.agents/skills/` only (`.claude/skills` is
  a symlink to it).

## Skills

- `research-round`: before running a backtest for a research question, freezing a candidate or
  registering a confirmation, choosing the next experiment, or claiming that a strategy improved,
  failed or generalized.
- `nautilus-report-analysis`: before computing any statistic from stored native reports.
- `research-sources`: before searching papers or economic and positioning data outside this
  repository, or stating what prior work found.
- `video-evidence`: before probing, downloading, transcribing or citing a video, or writing notes
  from one.

## Nautilus and parity

- Check Nautilus APIs against the version pinned in `uv.lock` and the code in `engine/`; probe
  uncertain behavior natively. Every replay executes a CI-built image, so an `engine/` edit reaches
  it only through a new image digest.
- When a change should preserve behavior (strategy refactor, data adapter, dependency or Nautilus
  version), run the paired native replay in `engine/README.md` before claiming parity. Inspect
  causal clocks, order protection and integrity, fees, funding and account economics; a clean exit
  or green tests is not parity. A research change to a strategy follows `research-round` instead.

## Checks and PRs

- Code changes: `uv run --frozen python -m unittest discover -s tests -t . -p 'test_*.py'` (Dolt
  integration tests start their own throwaway service and skip without a Dolt 2.4.2 binary in
  `RESEARCH_DOLT_BINARY` or on PATH; see `README.md`).
- PR titles are lowercase `type(scope): description` (`type(scope)!:` when breaking); check with
  `bash .github/scripts/validate-pr-title.sh "<title>"`. The body follows
  `.github/pull_request_template.md` and reports only checks actually run.
