# Trade research

Agents develop complete single-file Nautilus strategies in temporary directories
and publish source bytes, revisions and derivation relations to Dolt. This
repository maintains shared replay, evidence checks and runtime image build
inputs. The current migration slice is H19a (`r1.broad-two-tier`), 37 Binance
USDⓈ-M perpetual instruments and one fixed-capital native margin account.
The published [NautilusTrader](https://nautilustrader.io/) package owns data,
orders, fills, risk, execution, portfolio accounting and reports.

## Run R1

Install Python 3.14 and [uv](https://docs.astral.sh/uv/), configure the local
Dolt store and export an exact strategy revision. Follow
[R1 usage](backtest/r1/README.md) for a temporary host diagnostic, or the
[research record and artifact guide](research/records/README.md) for a
preregistered run in a fixed OCI image. The current `r1-native-v1` contract
supports H19a only; unconverted historical variants require explicit archived
source and its matching environment.

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

- [`backtest/r1/`](backtest/r1/): the shared `BacktestNode` replay, external-source loader, native report checks and historical receipts.
- [`backtest/r1/runtime/`](backtest/r1/runtime/): image build inputs for Python, Nautilus, shared runner and auditor; strategy bodies are excluded.
- [`research/records/`](research/records/): complete Dolt strategy revisions, research decisions, decision evidence and native artifact custody. [`history.json`](research/records/history.json) locates read-only historical source; Git is no metadata backend.
- [`docs/architecture.zh.md`](docs/architecture.zh.md): current product blueprint.
- [`docs/plans/dolt-strategy-oci-migration.zh.md`](docs/plans/dolt-strategy-oci-migration.zh.md): source/runtime migration contract and remaining scope.
- [`docs/plans/nautilus-upstream-poc.zh.md`](docs/plans/nautilus-upstream-poc.zh.md): historical 37-instrument paired replay evidence.
- [`docs/plans/r1-native-rd-findings.zh.md`](docs/plans/r1-native-rd-findings.zh.md): retained product and process findings.

The vendored Nautilus source and parallel product services have been removed.
Minimal quality and documentation publishing workflows remain. Image builds use
`pyproject.toml` and `uv.lock`; changing a strategy, dependency or data requires
a fresh paired native replay before claiming parity.
