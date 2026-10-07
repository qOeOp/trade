# R-1 native replay

This slice reimplements the source R-1u role-reversal rule from commit
`0725a7b3f89902e27cd421a18b4b879a13268534` using Nautilus Strategy,
Binance USD-M historical data requests, ParquetDataCatalog, and BacktestEngine.
The historical research scripts are a rule reference only; their fill and PnL
arrays are not used. No execution client or exchange credentials are configured.

From the repository root, install the locked visualization extra, which supplies
pandas for native CSV reports, then rebuild the local Rust extension:

```bash
uv sync --project python --python 3.14 --frozen --extra visualization
make build-debug
```

Then fetch public history and replay it:

```bash
python/.venv/bin/python research/r1_native/prepare.py \
  --catalog /tmp/r1-btc-catalog \
  --start 2024-01-01T00:00:00Z --end 2024-04-01T00:00:00Z
python/.venv/bin/python research/r1_native/run.py \
  --catalog /tmp/r1-btc-catalog \
  --start 2024-01-01T00:00:00Z --end 2024-04-01T00:00:00Z \
  --output /tmp/r1-btc-result
```

For a shorter trading window, keep at least thirty days of earlier data in
`--start` and set `--trade-start` to the first allowed entry time. The earlier
data updates the native daily strategy state without submitting orders.
For a recent short window, download longer daily history with the same native
client and pass it separately to avoid resetting the trend and pivot state at
the start of the minute catalog:

```bash
python/.venv/bin/python research/r1_native/prepare.py \
  --daily-only --catalog /tmp/r1-btc-daily \
  --start 2024-01-01T00:00:00Z --end 2026-10-07T08:30:00Z
python/.venv/bin/python research/r1_native/run.py \
  --catalog /tmp/r1-btc-catalog --warmup-daily-catalog /tmp/r1-btc-daily \
  --start 2026-09-01T00:00:00Z \
  --trade-start 2026-10-05T15:00:00Z --end 2026-10-07T08:30:00Z \
  --output /tmp/r1-btc-recent-result
```

The long daily history seeds the native Strategy before the minute replay. It
cannot submit orders during this preparation period. The minute catalog still
drives orders and fills, and its internal daily aggregation continues the
signal state into the trading window.

`--trade-start` deliberately begins with no position and no resting order. To
evaluate a short reporting window with positions carried from earlier signals,
start trading before that window and inspect the native position report for
positions whose open and close timestamps straddle it. For example, omitting
`--trade-start` in the September through October replay above includes the
BTC position opened on 2026-10-05 and held into 2026-10-07.
Pass `--report-start 2026-10-05T15:00:00Z` to capture native USDT
mark-to-market equity immediately before that reporting window and at the
replay end. The engine runs the two contiguous input batches in streaming mode
without resetting the account or orders; the summary records both portfolio
snapshot timestamps and the equity change. This makes the short-window PnL
comparable even when positions were opened earlier.

`prepare.py` uses the native public Binance futures client to read the current
perpetual instrument, LAST and MARK minute bars, and settled funding rates.
Both preparation and replay accept `--bar-minutes 5` for a lower-resolution
long-horizon sensitivity run; their default remains one minute. A five-minute
result has different touch, stop, and target timing and is not an exact
one-minute replication. Record the chosen interval with each result.
For long public backfills, `prepare.py --request-pause-ms 1000` schedules each
next native request through the actor clock to stay within venue request limits.
If only the funding request failed after both bar series finished, repeat the
same preparation command with `--resume-funding` to reuse the checked bar data.
`run.py` requires contiguous and aligned minute timelines, settlement coverage,
and at least thirty days of warmup. The strategy subscribes to native daily
aggregation of LAST bars, then submits native expiring limit brackets.
The output contains native orders, fills, positions, account, and result stats,
plus the exact input bar digest. It refuses a replay when minute coverage or
the one-position rule fails.
The venue uses Nautilus `reject_stop_orders=False`: if a bar gaps beyond the
protective stop as the entry fills, the stop executes at the current market
price. This avoids leaving a filled position without its protection. The
linked take-profit can then be rejected because the stop already closed its
parent; that contingent rejection has no remaining position to protect.

The runner handles one contract per invocation. The 2026-10-07 37-contract
comparison repeats the same native runner over the frozen 17-major/20-large
forward universe, maps PEPE and SHIB to their `1000` perpetual contracts, and
uses a quantity near 1000 USDT notional based on the last 2026-08-31 daily
close. Those 37 independent BacktestEngine accounts have no shared portfolio
margin or cross-coin risk constraints; summing their native equity changes is
an experiment-level diagnostic, not a single-account portfolio backtest.

`run_portfolio.py` reuses the prepared five-minute catalogs and the same native
Strategy in one `BacktestEngine` margin account. Pass the exact set of coins,
quantity CSV, catalog roots, and aligned interval. The runner checks bar and
funding coverage, streams one calendar month at a time, and exports native
orders, fills, positions, account events, returns, and a shared-account summary.
The default `--signal-variant daily-pivot` reproduces the R-1u signal. The
registered H03 comparison uses `--signal-variant box-4h` with Nautilus native
four-hour aggregation of those same five-minute LAST bars. Add
`--trade-start 2025-10-17T00:00:00Z` to **both** runners in a paired H03
comparison: the input starts on October 7, while the first ten days establish
the box. The output records both input and order-eligibility starts, and
annualizes over the eligible interval. H03 is a source-derived development
variant with a fixed 2R target; it does not encode the author's conditional
higher-timeframe target ladder or the R-1s staged exit.

For an exit-path diagnostic on an existing run, `analyze_exits.py` reads those
native reports and the same LAST catalog. It reports strict and permissive
pre-exit favorable-price bounds without creating counterfactual fills or PnL:

```bash
python/.venv/bin/python research/r1_native/analyze_exits.py \
  --catalog-root /tmp/r1-37-1y-5m-2026oct7 \
  --run /tmp/r1-rd-portfolio-37-expiry-fix \
  --output research/r1_native/results/2026-10-07-exit-attribution-d05.json
```

For the existing one-year research sample, the invocation is:

```bash
python/.venv/bin/python research/r1_native/run_portfolio.py \
  --catalog-root /tmp/r1-37-1y-5m-2026oct7 \
  --daily-root /tmp/r1-37-2026oct7 \
  --quantity-csv /tmp/r1-37-1y-5m-2026oct7/per_coin_stop_fix.csv \
  --coins BTC ETH BNB ADA XRP SOL DOGE LTC TRX LINK DOT AVAX BCH ETC XLM ATOM FIL NEAR UNI AAVE ICP APT ARB SUI OP INJ TIA SEI PEPE SHIB HBAR ALGO FET WLD IMX STX LDO \
  --start 2025-10-07T00:00:00Z --end 2026-10-07T08:30:00Z \
  --output /tmp/r1-rd-portfolio-37
```

The file `RD_EXPERIMENTS.md` records the source-video evidence and every studied
variant; `docs/plans/r1-native-rd-findings.zh.md` tracks process and product
findings for later blueprint reconciliation. This already-viewed year is
development evidence; repeated selection
from its scores needs explicit multiplicity accounting and later forward
observation. The current quantity schedule is frozen for baseline comparison,
not a risk-budget sizing rule.
`SOURCE_CASES.md` lists original chart/video checks for later source-derived
variants; passing those checks is about faithful encoding, not profitability.

For the separately registered H01 experiment, add `--risk-budget-bps 25` and
`--coin-notional-cap-pct 5` to the portfolio command. The Strategy reads native
Portfolio equity when submitting an entry, rounds the smaller stop-risk or
per-coin notional-cap quantity through the native Instrument, and reports
orders skipped below its minimum. This is a new sizing variant; it does not
change the R-1u entry or exit signal. Its exact outcomes and limits belong in
`RD_EXPERIMENTS.md`.

This is an exploratory single-instrument replay. The current public instrument
definition is recorded in `instrument-assumption.json` as a current-snapshot
approximation, not a point-in-time contract record. The historical MARK minute
close feeds native mark-price updates; settled funding feeds Nautilus funding
settlement. Intraminute mark paths, historical exchange spread, full execution
cost assumptions, and minute mark-to-market drawdown remain unverified, so its
returns are not a complete perpetual result or R-1 product acceptance.
R-1s staged exits are outside this slice. Signals created while a position is
open wait for its slot; a
minute touch during that interval voids them, and untouched signals can submit
after the position closes. Only one native entry bracket rests for a coin at a
time. When several candidates remain, the closest level to the last price is
submitted, and a closer candidate replaces it after native cancellation. This
prevents the native bar matcher from filling several same-side entries before
the first fill callback can cancel siblings. The priority is a minute-bar
approximation of first touch, especially when a bar gaps over several levels
or pending candidates are on opposite sides. Native fills and account reports
remain the authority for the orders actually submitted.

The historical research forward scanner uses TradingView spot daily candles
with up to 5000 days of history. This replay uses Binance perpetual candles and
the available native daily warmup catalog. Direct equality of its BTC levels
with that scanner is therefore not expected.

The example uses 0.010 BTC per order, a 100,000 USDT starting balance, and
the native instrument's current fee fields. The 2R target is set from the
signal's limit price, as in the forward R-1u order record. Settlement charges
use the latest minute mark close available before each funding boundary; the
exact mark at that instant and historical point-in-time contract metadata are
not reconstructed.
