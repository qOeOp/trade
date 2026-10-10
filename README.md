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
and export an exact strategy revision. Follow [R1 usage](backtest/r1/README.md)
for a temporary host diagnostic, or the
[`research-round` skill](.agents/skills/research-round/SKILL.md) for a
preregistered run sealed in a fixed OCI image. The current `r1-native-v2`
contract runs one complete source file whose native `Strategy` entry class
supplies `validate_replay_configuration`, `replay_diagnostics` and
`replay_integrity_findings`; archived `r1-native-v1` revisions run only in their
original retained image.

```bash
uv sync --frozen
uv run --frozen python -m research.records.cli strategy list
uv run --frozen python -m research.records.cli strategy show r1.broad-two-tier --brief
uv run --frozen python -m backtest.r1.run_portfolio --help
```

Historical Catalog inputs remain outside Git. Research needs no exchange
trading credential. Direct `/tmp` reports are temporary; registered artifacts,
Dolt backups and retained image bytes belong in private external directories.
New runs bind the Dolt strategy revision, actual image manifest digest,
platform, inputs and resolved configuration.

The documentation is published at [Trade 研究文档](https://qoeop.github.io/trade/zh/).
Build the original Next.js/Fumadocs site locally with
`npm ci --prefix docs-site && npm run build --prefix docs-site`; the static
export is `docs-site/out`.

## Repository map

- [`AGENTS.md`](AGENTS.md): always-loaded Agent rules: authority boundaries, when to write product code, and which skill to use.
- [`.agents/skills/`](.agents/skills/): on-demand skills: `research-round` (with references and a regression eval) and `nautilus-report-analysis`; `.claude/skills` links here.
- [`backtest/r1/`](backtest/r1/): the shared `BacktestNode` replay, external-source loader, native report checks and historical receipts.
- [`backtest/r1/runtime/`](backtest/r1/runtime/): image build inputs for Python, Nautilus, shared runner and auditor; strategy bodies are excluded.
- [`research/records/`](research/records/): complete Dolt strategy revisions, research decisions, decision evidence and native artifact custody. [`history.json`](research/records/history.json) locates read-only historical source; Git is no metadata backend.
- [`services/video-note-mcp/`](services/video-note-mcp/): a standalone local MCP that writes illustrated notes from public videos. It has its own `pyproject.toml` and `uv.lock`, shares no code with replay or records, and is not run by the root CI.
- [`docs/architecture.zh.md`](docs/architecture.zh.md) (English twin [`docs/architecture.md`](docs/architecture.md)): current product blueprint.
- [`docs/plans/dolt-strategy-oci-migration.zh.md`](docs/plans/dolt-strategy-oci-migration.zh.md): source/runtime migration contract and its history.
- [`docs/plans/nautilus-upstream-poc.zh.md`](docs/plans/nautilus-upstream-poc.zh.md): historical 37-instrument paired replay evidence.
- [`docs/plans/r1-native-rd-findings.zh.md`](docs/plans/r1-native-rd-findings.zh.md): retained product and process findings.

The vendored Nautilus source and the former backtest, market-data and
strategy-authoring services were removed (#1458); `services/video-note-mcp/` was
restored as an independent tool (#1468). CI runs the quality, documentation and
PR-title workflows. Image builds use `pyproject.toml` and `uv.lock`; a change
that should preserve strategy, dependency or data behavior needs a fresh paired
native replay before claiming parity.
