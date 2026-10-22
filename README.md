# Trade research

Agents develop complete single-file Nautilus strategies in temporary directories
and publish source bytes, revisions and derivation relations to Dolt. This
repository maintains the Agent rules and skills, shared replay, evidence checks
and runtime image build inputs. R1 replays 37 Binance USDⓈ-M perpetual
instruments in one fixed-capital native margin account.
The published [NautilusTrader](https://nautilustrader.io/) package owns data,
orders, fills, risk, execution, portfolio accounting and reports.

## Run a research line

Install Python 3.14 and [uv](https://docs.astral.sh/uv/). Agents use one entry, the command line
[`cli/`](cli/) (design page `docs/rd/design-code-cli.zh.mdx`): `<noun> <verb>` commands that each
print one JSON result, or a coded refusal with its repair commands on standard error and exit 1.
Every replay runs in the CI-built image; the
[`research-round` skill](.agents/skills/research-round/SKILL.md) holds the order of the commands
for a registered, sealed run. The current `replay-contract@v6` contract runs one complete source file
whose native `Strategy` entry class supplies `replay_diagnostics` and `replay_integrity_findings`
and holds every rule, sizing included; the runner takes no strategy parameter.

`runtime_contract` names the replay interface and execution conventions as `replay-contract@v6`;
its version is separate from the image digest, which pins the implementation. The publisher, host
image layout and in-image probe declare the same contract. A new CI image is required after this
rename; existing Dolt records and retained images keep their recorded identities and are not
rewritten or accepted under an alias.

```bash
uv sync --frozen
uv run --frozen python -m cli.main --help
uv run --frozen python -m cli.main research status
uv run --frozen python -m cli.main replay run --help
```

`--ledger` names a ledger profile (a file path, or a name in the profile directory
`~/.local/share/trade/ledgers`, overridden by `TRADE_LEDGER_HOME`; default the active ledger) and
`--market` the market database profile (default: the market profile in the same directory, which
the report readers also use). Runner arguments (window and instrument scope) follow `--`.

### The ledger and the market database

The current research ledger uses schema generation 3. Each execution has one `trial_id`; a
research/validation result uses that same primary key. Commands and new registration bodies use
`--trial-id` and `control_trial_id`. There is no `run_id` alias: old numeric references belong to
their original ledger generation. The market database has its own independent schema.

For a generation change, retain the old database and backup unchanged and read them with their
matching old checkout (schema 2: `f7e7c1df974da88d2478ec5731551f13689a649c`). Prepare generation 3
under a distinct profile/database name and backup root; do not rewrite old records. Creating or
switching the active ledger requires the user's explicit authority. A new database does not erase
previous research exposure or transfer an old line's qualification; cross-generation continuation
needs an explicit handoff before research resumes. The command below is for a fresh installation:

```bash
uv run --frozen python -m cli.main ledger init --name research --kind active \
  --service-root "$HOME/.local/share/trade/dolt" \
  --backup-root "$HOME/.local/share/trade/dolt-backups/research"
```

Clean prechecks keep their original identity, stage outcomes, logs, summary, audit, review and
semantic fingerprint in Dolt. Their native tables are cache. Read an original cache with
`replay report --trial-id N --directory /tmp/original`; after a cache loss use
`replay reproduce --trial-id N --output /tmp/rebuilt`, then `replay report --trial-id N
--reproduction /tmp/rebuilt --reproduction-trial M`. `M` is the new explore execution, not a new
economic result or review. Only a successful exact reproduction of the registration's cited,
exempt precheck is exempt from additional exposure. Failed or changed reproductions remain
recorded exposures. Failed/incomplete prechecks and prechecks without a usable fingerprint retain
their original reports; a later success never replaces their original facts.

`ledger init` refuses a profile or database that exists, and an active ledger whose service or
backup lies in the checkout or a temporary directory. A failed `ledger init` removes the database,
accounts and branch grant it created; grants and accounts left by a dropped database of the same
name are replaced. Rebuilding the active ledger needs the user's authority:

1. Stop every session that uses it. With the code of the old schema generation (a new generation's
   code refuses the old ledger with SCHEMA_MISMATCH), sync its backup with `ledger export --kind
   backup` and write the full export outside the checkout with `ledger export --kind reproduce
   --output <archive>`; then move its profile file (`research.json` in the profile directory) and
   its backup directory into the archive.
2. Drop the database as the service administrator (`root`, password in the service's `service.json`).
3. Run the `ledger init` above with the same name and `RESEARCH_DOLT_BINARY` pointing at Dolt 2.4.2,
   then `ledger export --kind backup` and `ledger review`.

Tests, demos and engineering trials use
`ledger temp` (a throwaway service and database under the temporary root, its profile file printed
for `--ledger`) and stop it with `ledger service stop` before deleting the directory. The Dolt
integration tests start their own throwaway services (`tests/ledger/dolt.py`) with the Dolt 2.4.2
binary in `RESEARCH_DOLT_BINARY` or on PATH, and skip without it.

Market data (Binance public USD-M perpetual data from 2020-01 and the monthly
pool) lives in its own Dolt database beside the ledger
([`market`](market/README.md)); a replay cites one commit of
it. It is created the same way with its backup directory, synced with `market backup` and checked
with `market review`:

```bash
uv run --frozen python -m cli.main market init --name market --kind active \
  --service-root "$HOME/.local/share/trade/dolt" \
  --backup-root "$HOME/.local/share/trade/dolt-backups/market"
```

Research needs no exchange trading credential. Persistent research data lives only in the Dolt research
ledger and its `dolt_backup` copy; `/tmp` reports are working copies. A stored
run binds the strategy revision, actual image manifest digest, platform, inputs
and resolved configuration.

The documentation is published at [Trade 研究文档](https://qoeop.github.io/trade/zh/).
Build the original Next.js/Fumadocs site locally with
`npm ci --prefix docs-site && npm run build --prefix docs-site`; the static
export is `docs-site/out`.

## Repository map

- [`AGENTS.md`](AGENTS.md): always-loaded Agent rules: authority boundaries, when to write product code, and where things go.
- [`.agents/skills/`](.agents/skills/): on-demand skills: `research-start`, `research-round`, `nautilus-report-analysis`, `research-sources`, `video-evidence` and `product-doctor`; `.claude/skills` links here.
- [`evals/`](evals/): one eval suite per skill (`evals/<skill>/<case>/`), run with `claude plugin eval .` from the repository root, whose [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json) loads `.agents/skills` as one plugin; results go to the ignored `evals/results/`.
- [`engine/`](engine/): the native replay (`config`, `load`, `run`, `report`), the independent auditor (`audit.py`), the semantic fingerprint (`compare.py`) and engineering parity (`compare_reports.py`).
- [`engine/runtime/`](engine/runtime/): image build inputs for Python, Nautilus, the runner and auditor, built by CI ([`runtime-image`](.github/workflows/runtime-image.yml)); strategy bodies are excluded.
- [`cli/`](cli/): the command line, the one entry Agents use; it holds no product logic.
- [`ledger/`](ledger/), [`registration/`](registration/), [`replay/`](replay/), [`qualification/`](qualification/), [`report/`](report/): the research ledger, registration and admission, the one replay entry, economic-evidence qualification and the report readers.
- [`runtime/`](runtime/): runtime image identity (digest pinning, the in-image probe, main builds) and the isolated container command.
- [`market/`](market/): the Binance market database, its monthly universe, lifecycle manifests, coverage facts and the per-commit Catalog export.
- [`services/video-evidence/`](services/video-evidence/): the stdlib checker that recomputes a video evidence bundle's hashes, frames, ASR input and citations from the bytes; the trust boundary of the `video-evidence` skill, tested by the root CI.
- [`docs/rd/`](docs/rd/) (published at https://qoeop.github.io/trade/): the research-chain design, the product blueprint and specification.
- [`docs/plans/`](docs/plans/): the refactor plan, storage decisions and field reviews still in force.

The vendored Nautilus source and the former backtest, market-data and
strategy-authoring services were removed (#1458); `services/video-note-mcp/`,
restored as an independent tool (#1468), was retired in favour of the
`video-evidence` skill (#1507). CI runs the quality, documentation and PR-title
workflows. Image builds use `pyproject.toml` and `uv.lock`; a change that should
preserve strategy, dependency or data behavior needs a fresh paired native
replay before claiming parity.
