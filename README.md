# Trade research

This repository keeps trading strategies as source code and replays them with the published [NautilusTrader](https://nautilustrader.io/) package. The current runnable slice is R1: one strategy family, 37 Binance USDⓈ-M perpetual instruments, and one fixed-capital native margin account. It uses native data, orders, fills, risk, execution, portfolio accounting, and reports.

## Run the verified R1 replay

Install Python 3.14 and [uv](https://docs.astral.sh/uv/), then:

```bash
uv sync --frozen
R1_COINS=(BTC ETH BNB ADA XRP SOL DOGE LTC TRX LINK DOT AVAX BCH ETC XLM ATOM FIL NEAR UNI AAVE ICP APT ARB SUI OP INJ TIA SEI PEPE SHIB HBAR ALGO FET WLD IMX STX LDO)
uv run --frozen python strategies/r1/run_portfolio.py \
  --catalog-root /tmp/r1-37-1y-5m-2026oct7 \
  --daily-root /tmp/r1-37-2026oct7 \
  --quantity-csv /tmp/r1-37-1y-5m-2026oct7/per_coin_stop_fix.csv \
  --coins "${R1_COINS[@]}" \
  --start 2025-10-07T00:00:00Z --trade-start 2025-10-17T00:00:00Z \
  --end 2026-10-07T08:30:00Z \
  --signal-variant support-broad-two-tier-4h --exit-variant tier-target-b \
  --risk-budget-bps 25 --coin-notional-cap-pct 5 \
  --output /tmp/r1-h19a-replay
```

The historical Catalog is external to Git and must be supplied at the paths shown or replaced with equivalent explicit paths. No exchange trading credential is needed. The command is a backtest; it does not place live orders. Its `/tmp` output is temporary. For a new registered R1 tiered experiment whose result will guide strategy iteration, use the [research record and artifact guide](research/records/README.md) to preregister the hypothesis, run this same native replay with a frozen source, and retain its result. See [R1 usage](strategies/r1/README.md) for H18a and comparison commands.

The current documentation is published at [Trade 研究文档](https://qoeop.github.io/trade/zh/). Build the original Next.js/Fumadocs site locally with `npm ci --prefix docs-site && npm run build --prefix docs-site`; the static export is `docs-site/out`.

## Repository map

- [`strategies/r1/`](strategies/r1/): native Strategy source, one `BacktestNode` replay entry, input validation and paired-result checkers.
- [`research/r1_native/`](research/r1_native/): frozen R&D experiment ledger, source checks, results and historical analysis scripts. Scripts importing the removed fork are retained as provenance, not supported entry points; develop new diagnostics against the published package and current strategy source.
- [`research/records/`](research/records/): searchable Git hypothesis/run records and local artifact custody for registered native research.
- [`docs/architecture.zh.md`](docs/architecture.zh.md): current product blueprint.
- [`docs/plans/nautilus-upstream-poc.zh.md`](docs/plans/nautilus-upstream-poc.zh.md): 37-instrument paired replay evidence and migration findings.
- [`docs/plans/r1-native-rd-findings.zh.md`](docs/plans/r1-native-rd-findings.zh.md): durable product and process findings from the R&D work.

The old vendored Nautilus source and parallel product services have been removed after paired replay acceptance. Minimal `quality` and documentation publishing workflows remain. The published package version is pinned in `pyproject.toml` and `uv.lock`; changing it requires a fresh paired native replay.
