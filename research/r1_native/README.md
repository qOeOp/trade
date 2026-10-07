# R-1 native replay

This slice reimplements the source R-1u role-reversal rule from commit
`0725a7b3f89902e27cd421a18b4b879a13268534` using Nautilus Strategy,
Binance USD-M historical data requests, ParquetDataCatalog, and BacktestEngine.
The historical research scripts are a rule reference only; their fill and PnL
arrays are not used. No execution client or exchange credentials are configured.

From the repository root, build the local `vibe-trading` package and install its
locked visualization extra, which supplies pandas for native CSV reports:

```bash
uv sync --project python --python 3.14 --frozen --no-dev --extra visualization
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

`prepare.py` uses the native public Binance futures client to read the actual
perpetual instrument and minute bars. `run.py` requires a contiguous interval
with at least thirty days of warmup. The strategy subscribes to native daily
aggregation of those minute bars, then submits native expiring limit brackets.
The output contains native orders, fills, positions, account, and result stats,
plus the exact input bar digest. It refuses a replay when minute coverage or
the one-position rule fails.

This is an exploratory single-instrument replay. The current public instrument
definition is not a point-in-time contract record. Historical mark prices,
funding, full execution cost assumptions, and minute mark-to-market drawdown
are not yet bound here, so its returns are not a complete perpetual result or
R-1 product acceptance. R-1s staged exits and the approximately 50-instrument
portfolio replay are also outside this slice. Signals created while a position
is open wait for its slot; a minute touch during that interval voids them, and
untouched signals can submit after the position closes. This preserves the
source's first-touch rule without assigning fills outside native matching.

The example uses 0.010 BTC per order, a 100,000 USDT starting balance, and
the native instrument's current fee fields. The 2R target is set from the
signal's limit price, as in the forward R-1u order record. The exchange's
historical spread, mark path, funding, and point-in-time contract metadata are
not reconstructed from the last-price minute bars.
