# Agent rules

External Agents choose research questions and methods. This repository supplies the skills, the
contracts enforced by code (Dolt research ledger, digest-pinned OCI runtime) and published Nautilus.
The research-chain site (sources in `docs/rd/`, published at https://qoeop.github.io/trade/) holds the rules, architecture and decisions; read functions and skills from the code and `.agents/skills/`.

## Needs the user's explicit authority

Stop and ask before any of these:

- Changing the project's fonts. PP Supply Mono is the default for Latin text and numbers in the
  IDE and research-chain site. Keep the existing font assets, family order, and glyph fallbacks.
  Do not replace, remove, or override them, even for a redesign, refactor, or licensing fix,
  without the user's explicit approval for that font change. Report any issue to the user first.
- Real orders. Live trading on the real Binance account is a product feature the user operates:
  the user saves the credential and starts each run from the Live page (`live serve` control,
  `engine.live` runner). An Agent builds and changes Live code but never starts a Live run, places,
  changes or cancels a real order, reads or saves an exchange credential, or changes account
  settings; each real-account trial needs its own scope from the user, who starts it. Paper
  (`engine.paper`: Binance public data, Nautilus Sandbox fills, no credential) needs no authority,
  and research never uses a credential.
- Destructive writes: resetting or clearing the Dolt ledger; rewriting or deleting published
  records or stored runs, old sealed artifacts, database backups, retained runtime images, canonical
  Catalog inputs or historical receipts.
- Creating or switching the active ledger or market directory: `ledger init --kind active`,
  `market init --kind active`, or changing which profile is the active one. Isolated and temporary
  databases need none.
- Changing (relaxing or tightening) a refusal or audit check in code, tests, configuration or a
  skill, or either of the user's two research targets (maximum drawdown and minimum annual
  return), including to get past a failing check. Win rate is a report dimension, not a target.
- Starting, stopping or restarting Docker Desktop or a deployment's own services (the `trade-ide`
  compose services, the remote host's), terminating any host process, or changing host
  configuration: Docker or system settings, credential helpers, the network path, installing or
  upgrading host tools or plugins.
- Reading any credential (browser cookies included) other than the research data keys
  `research-sources` names. Those sit in the main checkout's `.env` beside exchange credentials:
  read one named value inside the command that uses it, never source or print the file, never
  echo, log or store a value. Never read `dolt/service.json` under a data directory (passwords) or
  fetch a running IDE's home page (paper token).
- Adding a stored field (a ledger or record column, table or stored value): ask for each field after
  the review and record that Code or Agent requires.
- Tagging a release (`vX.Y.Z`): only a tag on a checked `main` commit reaches the remote host, and
  each one is the user's call (`CHANGELOG.md`).

Ask in plain terms: name the kind of change (product code and its PR, ledger records, a stored
field, configuration), what is refused now and what the change will allow, and any way to reach
the goal without it.

Tests, demos and engineering trials of product code write only to an isolated Dolt database
(`ledger temp`), never the active ledger: publication is append-only.

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

- Persistent research data lives only in the Dolt ledger (with its `dolt_backup` copy and its public
  DoltHub copy) and, for market data, the market directory (no copy: it is recomputed from Binance's
  public archives when lost). The ledger is public, and both hold only what a replay cannot give
  back (`docs/rd/design-ledger.mdx` lists the kinds); of a third-party video, only its identity,
  hashes and quoted excerpts. Store each fact once and never what stored data derives. Everything
  else (drafts, exploratory scripts, replay outputs and native reports, media, derived reports) is a
  working copy in `/tmp`.
- Execution records are not research data: the remote host's `paper` database and Live's private
  root never reach the ledger, DoltHub or Git.
- Write to the ledger only through the command line `python -m cli.main` (its `replay` commands
  included), never with direct SQL or another account. No strategy bodies or experiment receipts
  in Git.
- Product and workbench findings: `docs/plans/`. Skills: `.agents/skills/` only (`.claude/skills` is
  a symlink to it), holding runtime content only; evals and how to change a skill: `.agents/README.md`.

## Nautilus and parity

- Check Nautilus APIs against the version pinned in `uv.lock` and the code in `engine/`; probe
  uncertain behavior natively.
- A change that should preserve behavior is accepted only by the paired native replays in
  `engine/README.md` (Paired acceptance); a clean exit or green tests is not parity.

## Checks and PRs

- Code changes: `uv run --frozen python -m unittest discover -s tests -t . -p 'test_*.py'` (Dolt
  integration tests: `README.md`).
- Skill text is product code: a skill change follows `.agents/README.md`.
- A PR's title and body follow `.github/pull_request_template.md`; the body reports only checks
  actually run.
- Base every PR on `main`; never stack one PR on another, since the quality checks run only for
  PRs into `main`.
- A merge is not a release; `deploy/remote/README.md` says what a release switches and what stays.
- Until 1.0, a version keeps no compatibility with earlier ones. A breaking change says in `CHANGELOG.md` what
  the upgrade drops. No code reads, migrates or special-cases an earlier format of runs, profiles, graphs or
  ledgers; old research restarts on a new ledger.
- A fix for a doctor finding follows the header of `docs/plans/doctor/index.zh.md`. It adds or
  changes only its own finding's eval case and leaves every other grader alone; a grader change is
  its own PR.
