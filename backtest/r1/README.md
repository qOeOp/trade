# R1 native replay

`python -m backtest.r1.run_portfolio` is the single R1 backtest entry. H19a's complete Strategy source is [`strategies/r1.py`](../../strategies/r1.py); the other supported research variants remain in [`research/r1_variants/`](../../research/r1_variants/). Only H19a has been consolidated into one complete source file. It runs the existing native
Strategy variants in one 100,000 USDT Nautilus `BacktestNode` margin account.
The published `nautilus_trader==2.0.0rc3` package owns data replay, orders,
fills, funding settlement, risk, portfolio accounting and reports. No exchange
trading credential is needed.

For a new registered tiered experiment, first read the [research record and
artifact guide](../../research/records/README.md). Its custody command calls
this same native runner with frozen source and seals the result in a configurable
local directory. The direct `/tmp` example below is a temporary replay.

## Run H19a

```bash
uv sync --frozen
R1_COINS=(BTC ETH BNB ADA XRP SOL DOGE LTC TRX LINK DOT AVAX BCH ETC XLM ATOM FIL NEAR UNI AAVE ICP APT ARB SUI OP INJ TIA SEI PEPE SHIB HBAR ALGO FET WLD IMX STX LDO)
uv run --frozen python -m backtest.r1.run_portfolio \
  --catalog-root /tmp/r1-37-1y-5m-2026oct7 \
  --daily-root /tmp/r1-37-2026oct7 \
  --quantity-csv /tmp/r1-37-1y-5m-2026oct7/per_coin_stop_fix.csv \
  --coins "${R1_COINS[@]}" \
  --start 2025-10-07T00:00:00Z --trade-start 2025-10-17T00:00:00Z \
  --end 2026-10-07T08:30:00Z \
  --signal-variant support-broad-two-tier-4h --exit-variant tier-target-b \
  --risk-budget-bps 25 --coin-notional-cap-pct 5 \
  --output /tmp/r1-node-h19a-37
```

For H18a, use `--signal-variant support-three-tier-line-cancel-4h` and a
different output directory. Other accepted signal and exit variants are listed
by `--help`. `--mark-root` optionally selects the derived MARK Catalog cache;
the default cache is keyed by input Catalog path and interval under the system
temporary directory. The downloaded source Catalog stays read only.

`BacktestNode` loads funding from the existing Catalog directly. `native_node.py`
turns the existing MARK bar closes into native `MarkPriceUpdate` data, validates
LAST/MARK alignment, and verifies cached mark events before reuse.
`replay_inputs.py` checks the input receipts and funding settlement coverage.
There is no funding event decoder or second matching/account engine.

## Paired acceptance

```bash
uv run --frozen python -m backtest.r1.checks.compare_node \
  /tmp/nautilus-minimal-cleanup-h19a-37 /tmp/r1-node-h19a-37
```

The H18a control is `/tmp/nautilus-upstream-final-h18a-37`. Both full annual
37-instrument results matched the former native runner exactly. The migration
receipt `receipts/parity-node-migration.json` covers 16 tested combinations across
all signal families and both staged exits. Two combinations already failed
order integrity in the former runner; the Node entry reproduces those failures
and does not qualify them as strategies. Historical proof receipts
`receipts/parity-node-h18a.json` and `receipts/parity-node-h19a.json` remain for the funding-loader
transition. All result paths under `/tmp` are local evidence, not repository data.

The pinned rc3 Strategy activates its native take-profit child before the
stop child to avoid a synchronous sibling rejection. Recheck that behavior,
fees, funding and full paired results before changing Nautilus versions.

## Historical R&D variant port

The H23a–H27a Strategy variants were ported onto the same `BacktestNode`
entrypoint. Their historical annual 37-instrument `BacktestEngine` reports
remain the controls. The paired receipts in
[fixed historical result receipts](https://github.com/qOeOp/trade/tree/44e229331fdc7d9b78e234079673b8df71faefc4/research/r1_native/results) compare
orders, fills, positions, funding adjustments, account snapshots, daily returns
and account metrics; companion tier audits check native order lifecycle. These
are implementation parity checks on the already exposed year, not new strategy
qualification or independent validation. The raw CSVs still live in temporary
local paths and are not sealed by `research.records`. H25a–H27a's structured
records are explicitly retrospective transcriptions.

## Source and evidence boundaries

The Strategy directory contains trading rules. This directory contains the one native replay, R1-specific input/report adaptation and maintained acceptance tools; it does not own signal selection. Research variants are selected explicitly through the same runner, without importing the removed local Nautilus fork.

Small receipts in `receipts/` retain their original bytes and source identities. The `parity_receipts` paths in `receipts/evidence.json` are historical locators; their [fixed Git archive](https://github.com/qOeOp/trade/tree/44e229331fdc7d9b78e234079673b8df71faefc4/strategies/r1) contains the original three receipts. Their same-named current copies under `receipts/` are byte-identical. Their old implementation paths describe historical runs. Fresh runs report each executing source file and hash; frozen custody supports both the historical and current layout. A code move does not upgrade a historical strategy result to qualification.

`receipts/parity-single-file-h19a.json` binds the standalone H19a source and
runtime hashes to a fresh control at `44e229331`: all annual 37-instrument orders,
fills, positions, funding adjustments, account rows, returns and per-coin
diagnostics match. Native order integrity and the independent tier audit pass.
H18a and H29a annual BTC/ETH pilots also match after the import migration. Raw
reports remain temporary; this is implementation acceptance, not independent
strategy qualification.
