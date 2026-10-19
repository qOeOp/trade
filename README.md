# Trade research

Agents develop complete single-file Nautilus strategies in temporary directories
and publish source bytes, revisions and derivation relations to Dolt. This
repository maintains the Agent rules and skills, shared replay, evidence checks
and runtime image build inputs. R1 replays 37 Binance USDⓈ-M perpetual
instruments in one fixed-capital native margin account.
The published [NautilusTrader](https://nautilustrader.io/) package owns data,
orders, fills, risk, execution, portfolio accounting and reports.

## Run R1

Install Python 3.14 and [uv](https://docs.astral.sh/uv/), configure the local
Dolt store as described in the [research record guide](research/records/README.md)
and export an exact strategy revision. Every replay runs through
`artifacts run` in the CI-built image: see [native replay](engine/README.md)
for an exploration, or the
[`research-round` skill](.agents/skills/research-round/SKILL.md) for a
preregistered sealed run. The current `r1-native-v6` contract runs one
complete source file whose native `Strategy` entry class supplies
`replay_diagnostics` and `replay_integrity_findings` and holds every rule,
sizing included; the runner takes no strategy parameter. Seals of
`r1-native-v1` to `v3` remain readable.

```bash
uv sync --frozen
uv run --frozen python -m research.records.cli ledger status
uv run --frozen python -m research.records.cli round status
uv run --frozen python -m research.records.artifacts run --help
```

Market data (Binance public USD-M perpetual data from 2020-01 and the monthly
pool) lives in its own Dolt database beside the ledger
([`market`](market/README.md)); a replay cites one commit of
it. Research needs no exchange
trading credential. Persistent research data lives only in the Dolt research
ledger and its `dolt_backup` copy; `/tmp` reports are working copies. A stored
run binds the strategy revision, actual image manifest digest, platform, inputs
and resolved configuration.

The documentation is published at [Trade 研究文档](https://qoeop.github.io/trade/zh/).
Build the original Next.js/Fumadocs site locally with
`npm ci --prefix docs-site && npm run build --prefix docs-site`; the static
export is `docs-site/out`.

## Repository map

- [`AGENTS.md`](AGENTS.md): always-loaded Agent rules: authority boundaries, when to write product code, and which skill to use.
- [`.agents/skills/`](.agents/skills/): on-demand skills: `research-round` (with references and a regression eval), `nautilus-report-analysis`, `research-sources` and `video-evidence`; `.claude/skills` links here.
- [`engine/`](engine/): the native replay (`config`, `load`, `run`, `report`), the independent auditor (`audit.py`), the semantic fingerprint (`compare.py`) and engineering parity (`compare_reports.py`).
- [`engine/runtime/`](engine/runtime/): image build inputs for Python, Nautilus, the runner and auditor, built by CI ([`runtime-image`](.github/workflows/runtime-image.yml)); strategy bodies are excluded.
- [`market/`](market/): the Binance market database, its monthly pool, lifecycle manifests and the per-commit Catalog export.
- [`research/records/`](research/records/): complete Dolt strategy revisions, research decisions, decision evidence and native artifact custody. [`history.json`](research/records/history.json) locates read-only historical source; Git is no metadata backend.
- [`services/video-evidence/`](services/video-evidence/): the stdlib checker that recomputes a video evidence bundle's hashes, frames, ASR input and citations from the bytes; the trust boundary of the `video-evidence` skill, tested by the root CI.
- [`docs/architecture.zh.md`](docs/architecture.zh.md) (English twin [`docs/architecture.md`](docs/architecture.md)): current product blueprint.
- [`docs/plans/r1-native-rd-findings.zh.md`](docs/plans/r1-native-rd-findings.zh.md): retained product and process findings.

The vendored Nautilus source and the former backtest, market-data and
strategy-authoring services were removed (#1458); `services/video-note-mcp/`,
restored as an independent tool (#1468), was retired in favour of the
`video-evidence` skill (#1507). CI runs the quality, documentation and PR-title
workflows. Image builds use `pyproject.toml` and `uv.lock`; a change that should
preserve strategy, dependency or data behavior needs a fresh paired native
replay before claiming parity.
