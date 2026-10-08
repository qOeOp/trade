# R1 native replay

`run_portfolio.py` is the single R1 backtest entry. It runs the existing native
Strategy variants in one 100,000 USDT Nautilus `BacktestNode` margin account.
The published `nautilus_trader==2.0.0rc3` package owns data replay, orders,
fills, funding settlement, risk, portfolio accounting and reports. No exchange
trading credential is needed.

## Run H19a

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
uv run --frozen python strategies/r1/compare.py \
  /tmp/nautilus-minimal-cleanup-h19a-37 /tmp/r1-node-h19a-37 \
  --catalog-root /tmp/r1-37-1y-5m-2026oct7
```

The H18a control is `/tmp/nautilus-upstream-final-h18a-37`. Both full annual
37-instrument results matched the former native runner exactly. The migration
receipt `parity-node-migration.json` covers 16 tested combinations across
all signal families and both staged exits. Two combinations already failed
order integrity in the former runner; the Node entry reproduces those failures
and does not qualify them as strategies. Historical proof receipts
`parity-node-h18a.json` and `parity-node-h19a.json` remain for the funding-loader
transition. All result paths under `/tmp` are local evidence, not repository data.

The pinned rc3 Strategy activates its native take-profit child before the
stop child to avoid a synchronous sibling rejection. Recheck that behavior,
fees, funding and full paired results before changing Nautilus versions.
