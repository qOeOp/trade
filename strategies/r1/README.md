# Official Nautilus replay POC

This is the read-only native replay entry for current R1 research. The
strategy files are frozen native `Strategy` source copied from `research/r1_native`
with package imports changed from `vibe_trading` to the published
`nautilus_trader`. There is no replacement matching engine, portfolio ledger,
or optimizer. `run_portfolio.py` runs one native margin account shared by the
37 instruments, exactly as the research control does. Each independent future
strategy could later receive a separately fixed-capital account.

## Run

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
  --output /tmp/nautilus-poc-h19a
```

For H18a, change `--signal-variant` to
`support-three-tier-line-cancel-4h`. The existing Catalog is read only. The
published rc3 Catalog reads its bars and instruments; `funding_catalog.py`
decodes the fork's legacy funding Parquet rows into native `FundingRateUpdate`
objects. Nautilus processes the settlement, orders, fills, account and reports.

`compare.py REFERENCE_DIR CANDIDATE_DIR --catalog-root CATALOG_ROOT` compares
native order identity/status, fills, account economics and integrity. The final
37-instrument H18a and H19a runs pass; see `parity-h18a.json`,
`parity-h19a.json`, `parity-cleanup-h19a.json` and `evidence.json`. The Strategy places the take-profit ID
first in the parent OTO activation list to avoid a late sibling rejection
when the stop fills synchronously. This remains a pinned rc3 behavior and must
be reverified before any Nautilus upgrade.

The published rc6 was also tested from the same data. It requires an official
Catalog format migration and a venue `MakerTakerFeeModel(0.0002, 0.0005)` to
restore the historical instrument fee settings. Its unadapted 37-instrument replay diverged; see
`../../docs/plans/nautilus-upstream-poc.zh.md`. The rc6 migration/output remain
diagnostic files under `/tmp`, not a new product path.
