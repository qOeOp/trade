# Trade research

Agents develop complete single-file Nautilus strategies in temporary directories
and publish source bytes, revisions and derivation relations to Dolt. This
repository maintains the Agent rules and skills, shared replay, evidence checks
and runtime image build inputs. A replay runs the Binance USDⓈ-M perpetuals its runner arguments
name (`--symbols`, or every monthly universe member with `--universe pool`) in one fixed-capital
native margin account.
The published [NautilusTrader](https://nautilustrader.io/) package owns data,
orders, fills, risk, execution, portfolio accounting and reports.

## Start here

This product is self-hosted for one operator: you run your own ledger, market directory and server. It has no accounts
and no hosted multi-user mode. An Agent (Claude Code or Codex) does the research; you choose the research lines and
set the two targets, maximum drawdown and minimum annual return.

Know these before you start:

- **Your research can be public and permanent.** A deployment's ledger, and any ledger you give a DoltHub repository,
  publishes complete strategy source, results and judgments on every command that changes it. DoltHub history cannot
  be taken back, and there is no private mode. Market data comes from Binance's public archives; their terms are yours
  to check.
- **Binance must answer from your host.** It refuses some regions and hosting providers: see
  [What the market range costs](deploy/README.md#what-the-market-range-costs), which also gives the disk and memory measured.
- **Paper trading needs no credential**: Binance public data and simulated fills. **Live trading (`live/`) is an
  engineering trial outside what this release supports**: it has run only on the operator's own account with about
  100 USDT of test funds, and with no testnet or demo path, connecting it means a real account. Do not connect one.

You need a `git clone` (a ZIP has no revision for runs to record), Docker with a linux/arm64 or linux/amd64 engine (every
replay runs in an image), Python 3.14 and [uv](https://docs.astral.sh/uv/).

**With the deployment** (ledger service, market upkeep, IDE, paper trading): you also need a DoltHub account and a
public repository, which its page asks for on first start. Follow [`deploy/README.md`](deploy/README.md), or for a server
[`deploy/remote/README.md`](deploy/remote/README.md).

**Command line only**: with [Dolt 2.7.2](https://github.com/dolthub/dolt/releases/tag/v2.7.2), and nothing published until
you run `ledger publish`:

```bash
uv sync --frozen
export RESEARCH_DOLT_BINARY=/path/to/dolt
uv run --frozen python -m cli.main ledger init --name research --kind active \
  --service-root "$HOME/.local/share/trade/dolt" \
  --backup-root "$HOME/.local/share/trade/dolt-backups/research"
uv run --frozen python -m cli.main market init --name market --kind active \
  --root "$HOME/.local/share/trade/market"
uv run --frozen python -m cli.main market follow --bar-symbols BTCUSDT ETHUSDT SOLUSDT --bars-from 2024-01
```

`market follow` keeps running, so give it its own terminal; its first round starts after 5 minutes.

Then open your Agent at the repository root and say "start research". It reads the ledger, offers lines that can start
and asks for your targets. It stops and asks before anything [`AGENTS.md`](AGENTS.md) reserves for you.

## Run a research line

Install Python 3.14 and [uv](https://docs.astral.sh/uv/). Agents use one entry, the command line
[`cli/`](cli/): `<noun> <verb>` commands that each
print one JSON result, or a coded refusal with its repair commands on standard error and exit 1.
Every replay runs in the CI-built image; the
[`research-round` skill](.agents/skills/research-round/SKILL.md) holds the order of the commands
for a registered, sealed run. The current `replay-contract@v7` contract runs one complete source file
whose native `Strategy` entry class supplies `replay_diagnostics` and `replay_integrity_findings`
and holds every rule, sizing included; the runner takes no strategy parameter.

`runtime_contract` names the replay interface and execution conventions as `replay-contract@v7`;
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
`--market` the market profile (default: the market profile in the same directory, which
the report readers also use). Runner arguments (window and instrument scope) follow `--`.

### The ledger and the market

The current research ledger uses schema generation 3. Each execution has one `trial_id`; a
research/validation result uses that same primary key. Commands and new registration bodies use
`--trial-id` and `control_trial_id`. There is no `run_id` alias: old numeric references belong to
their original ledger generation. A market commit is a day of the market directory
(`market/README.md`), independent of the ledger's versions.

For a generation change, retain the old database and backup unchanged and read them with their
matching old checkout (schema 2: `f7e7c1df974da88d2478ec5731551f13689a649c`). Prepare generation 3
under a distinct profile/database name and backup root; do not rewrite old records. Creating or
switching the active ledger or market needs the user's authority ([`AGENTS.md`](AGENTS.md)
owns that list). A new database does not erase previous research exposure or transfer an old
line's qualification; cross-generation continuation needs an explicit handoff before research
resumes. The command below is for a fresh installation:

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
economic result or review. A successful exact reproduction of a trial the exposure check does not
count (the registration's cited short precheck, a precheck that sealed no result, or a trial of
its retry chain) rereads bytes already accounted for and is not counted either. Failed or changed
reproductions remain recorded exposures. Failed/incomplete prechecks and prechecks without a usable fingerprint retain
their original reports; a later success never replaces their original facts.

A research or validation run's native reports are cache too. `replay run --output /tmp/run-N`
keeps its working directory (a new path under the temporary root); without `--output` it is
removed once stored. Read the kept directory with `replay report --trial-id N --directory
/tmp/run-N` (or `tables()` with that directory): every report file must match the run's sealed
capture. Without one, use `replay reproduce` and `--reproduction` as above.

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
3. Run the `ledger init` above with the same name and `RESEARCH_DOLT_BINARY` pointing at Dolt 2.7.2,
   then `ledger export --kind backup` and `ledger review`.

Tests, demos and engineering trials use
`ledger temp` (a throwaway service and database under the temporary root, its profile file printed
for `--ledger`) and stop it with `ledger service stop` before deleting the directory. The Dolt
integration tests start their own throwaway services (`tests/ledger/dolt.py`) with the Dolt 2.7.2
binary in `RESEARCH_DOLT_BINARY` or on PATH, and skip without it.

Market data (Binance public USD-M perpetual data, imported month by month, and the monthly
pool) lives in a market directory of plain Parquet files ([`market`](market/README.md)); a replay
cites one market commit, the last day it includes. `market coverage` reports which months a commit holds (the first
imported month has no pool members: membership counts the trading days before a month). An empty one is made with (the active one needs
the user's authority; the deployment's is `$TRADE_DATA/market`, `deploy/README.md`):

```bash
uv run --frozen python -m cli.main market init --name market --kind active \
  --root "$HOME/.local/share/trade/market"
```

Research needs no exchange trading credential. Persistent research data lives only in the Dolt research
ledger, its `dolt_backup` copy and its public DoltHub copy; `/tmp` reports are working copies. A stored
run binds the strategy revision, actual image manifest digest, platform, inputs
and resolved configuration.

Both are public. The research ledger is on DoltHub: after `dolt login`, name its repository once (the
administrator copies the login key into the service's own Dolt home); every command that may change it then
publishes it, read commands never publish, and the next such command or `ledger publish` reruns a failed
publish, as the compose ledger service does every 5 minutes (the page's status bar names a copy still behind after
15 minutes). A first `--remote` that fails is not kept, so a mistyped repository can be corrected; once it has taken
the ledger it stays:

```bash
uv run --frozen python -m cli.main ledger publish --remote https://doltremoteapi.dolthub.com/<owner>/<repository>
```

The market directory has no copy: if lost, it is recomputed from the Binance archives (`deploy/README.md`).

The documentation is published at [Trade 研究文档](https://qoeop.github.io/trade/zh/).
Build the original Next.js/Fumadocs site locally with
`npm ci --prefix docs-site && npm run build --prefix docs-site`; the static
export is `docs-site/out`.

## Repository map

- [`AGENTS.md`](AGENTS.md): always-loaded Agent rules: authority boundaries, when to write product code, and where things go.
- [`.agents/skills/`](.agents/skills/): on-demand skills: `research-start`, `research-round`, `nautilus-report-analysis`, `research-sources`, `video-evidence` and `product-doctor`; `.claude/skills` links here.
- [`.agents/evals/`](.agents/evals/): one eval suite per skill (`.agents/evals/<skill>/<case>/`), run from the repository root with `claude plugin eval .agents` (`--case <glob>` picks cases). `.agents/` is the plugin root ([`.agents/.claude-plugin/plugin.json`](.agents/.claude-plugin/plugin.json)): the runner scans the plugin root for the suites and refuses links or roots over 20000 entries, so the suites sit beside the skills instead of at the top level; results go to the ignored `.agents/evals/results/`.
- [`engine/`](engine/): the native replay (`config`, `load`, `run`, `report`), the independent auditor (`audit.py`), the semantic fingerprint (`compare.py`), engineering parity (`compare_reports.py`), paper trading (`paper.py`: one strategy on live Binance public data with Nautilus Sandbox fills, no credential) and the operator-only Live runner (`live.py`, [Live execution](engine/README.md#live-execution)).
- [`engine/runtime/`](engine/runtime/): image build inputs for Python, Nautilus, the runner and auditor, built by CI ([`runtime-image`](.github/workflows/runtime-image.yml)); strategy bodies are excluded.
- [`cli/`](cli/): the command line, the one entry Agents use: the noun-verb dispatch, the `ledger sql` read guard (`READ_FIRST`: one statement whose first word is a read keyword, else `WRITE_VIA_SQL`), the publish-after-write policy (`_publish_after`: a command that may change a database publishes it once afterwards, read commands never), `ledger service run`/`check` for the compose deployment (`cli/service.py`) and the strategy scaffold templates of `candidate new` and `candidate export` (`cli/templates/`).
- [`ledger/`](ledger/), [`registration/`](registration/), [`replay/`](replay/), [`qualification/`](qualification/), [`report/`](report/): the research ledger, registration and admission, the one replay entry, economic-evidence qualification and the report readers.
- [`runtime/`](runtime/): runtime image identity (digest pinning, the in-image probe, main builds) and the isolated container command.
- [`paper/`](paper/): the paper-run controller and the daemon behind the IDE's Paper panel.
- [`live/`](live/): the operator-only `live` command.
- [`market/`](market/): the Binance market directory (plain Parquet files), its monthly universe, lifecycle manifests, coverage facts and the per-commit Catalog export.
- [`deploy/`](deploy/): the base deployment, one compose project (ledger, market-import, paper, docker-api and the IDE) and the Dockerfile of its three images; [`deploy/remote/`](deploy/remote/README.md) adds what a server needs, automatic release included.
- [`ide/`](ide/): the trade IDE, a page onto the research; its first view is the research graph, with its stdlib tool: the research graph format, the view-model layout, the web renderer and the ledger-versus-session comparison.
- [`docs/rd/`](docs/rd/) (published at https://qoeop.github.io/trade/): the research-chain site: rules, architecture and decisions. Functions and skills are read from the code and `.agents/skills/`. A chapter's English page with no `.mdx` file of its own is built from its `.zh.mdx`.
- [`docs/plans/`](docs/plans/): storage decisions, field reviews and notes from past work; each says when it was written, and the code wins where they differ.

The vendored Nautilus source and the former backtest, market-data and
strategy-authoring services were removed (#1458); `services/video-note-mcp/`,
restored as an independent tool (#1468), was retired in favour of the
`video-evidence` skill (#1507). CI is in `.github/workflows/`. A PR changing only `docs/` or
`.agents/evals/` skips the tests in `quality`; every commit on `main` runs them. Image builds use
`pyproject.toml` and `uv.lock`; a change that should preserve strategy, dependency or data
behavior needs a fresh paired native replay before claiming parity.
