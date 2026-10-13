# Market data

Binance USD-M perpetual market data, from public sources only, in its own Dolt database on the
research ledger's service. A replay cites one commit of it; `export` turns that commit into the
Nautilus Catalogs the runner reads. Design and measurements: [WS8a](../../docs/plans/market-data-dolt-measurement.zh.md),
[field review](../../docs/plans/ws8b-market-data-field-review.zh.md),
[WS8b acceptance](../../docs/plans/ws8b-market-data-acceptance.zh.md).

| Module | Holds |
|---|---|
| `schema.sql` | the tables: 1-minute LAST and MARK `bar`, `funding`, `instrument` terms by observation, `daily_volume` and the monthly `pool` |
| `binance.py` | data.binance.vision listings and archives (each checked against its `.CHECKSUM`), public REST, exchangeInfo; no account or key |
| `universe.py` | which contracts are eligible, their daily quote volume, and the pool rule |
| `store.py` | the import (one commit per run, resumable), exact scaling, freshness and pool reads |
| `export.py` | the derivation of every timeframe from 1-minute bars and the per-contract Catalog export, with its cache |
| `cli.py` | `import`, `status`, `pool` |

## The database

A profile of kind `market` on the research ledger's service, created once:

```bash
uv run --frozen python -m research.records.cli ledger init --kind market --name market --database market \
  --service-root "$HOME/.local/share/trade/dolt" --binary /absolute/path/to/dolt-2.4.2 \
  --role active --backup-root "$HOME/.local/share/trade/dolt-backups"
uv run --frozen python -m research.records.cli --ledger market ledger backup
```

The writer may only insert and call `dolt_commit`, on `main` only; the reader only selects. Market
data appends on `main` month by month and is never rewritten; a run cites a commit hash, so later
imports never change what an earlier run read.

- **Window and contracts.** USDT perpetuals from 2020-01. Each month's pool (rule
  `usdt-perp-top50-30d-v1`): at the start of the UTC month, among USDT perpetuals of crypto assets
  that have traded for at least 30 days in an unbroken run and still traded the day before, the 50
  with the largest quote volume over the previous 30 days (all of them when fewer qualify; ties by
  symbol). Delisted contracts count. Excluded: TRADIFI perpetuals (equities, commodities, FX),
  index contracts (BTCDOM, DEFI, ALL, BLUEBIRD, FOOTBALL) and stablecoin pairs. Daily quote volume
  is stored for every eligible contract, so the pool can be recomputed from the database; every
  import recomputes it and refuses a change to a stored month.
- **Bars.** Only 1-minute LAST and MARK, for every contract the pool ever held, over its whole life
  from 2020-01 (warm-up and closing after it left the pool need more than its pool months). Prices
  are integers x 10^8, volumes x 10^4 (`market_schema`). Every other timeframe is derived at export.
- **Sources, spliced invisibly.** Monthly archives, then daily archives for months without one and
  for days a monthly archive lacks (2026-06-29 MARK is absent from every June monthly file), then
  public REST for what no archive holds yet (the current day's tail, funding of the current month,
  daily volume before 2020). A minute two sources both hold must agree exactly. Minutes no source
  holds (exchange halts, a delisting and relisting) stay missing; the import reports them.
- **Terms.** exchangeInfo's filters verbatim, a new row when they change. A contract that left
  exchangeInfo before its first import gets `inferred` increments (the most decimals its trades
  used) and no other terms. Fees and margins are not exchange facts and are not stored: the
  exporter applies the assumption the old Catalog used and records it.

## Import and freshness

```bash
uv run --frozen python -m research.market.cli import                 # through yesterday, one commit
uv run --frozen python -m research.market.cli import --resume        # after an interruption
uv run --frozen python -m research.market.cli status                 # pool months, newest day, latest complete month
uv run --frozen python -m research.market.cli pool --month 2022-05
```

`import --through DAY` stops before that UTC day. Archives are working copies under the temp
directory (`--cache`); a lost copy is downloaded again. An interrupted import leaves its rows in the
working set: a new import refuses until `--resume`, which continues from them and commits once.

## Export

`research.records.artifacts run` exports for every replay: the market commit (`--market`, default
`main`) for the replay window, one Catalog per contract with 5-minute LAST bars, MARK price updates,
funding updates and the daily LAST bars before the window. An exploration reuses the cache under the
temp directory (`trade-market-catalog/<commit>/<window>/`, complete when `export.json` exists); a
sealed run exports afresh into a directory of its own. The derivation (WS8a section 3): open, high
and low over traded minutes only (all minutes when none traded), close the last minute's, volume
the sum; weeks start Monday 00:00 UTC.

## Tests

`tests/market/test_rules.py` needs no Dolt (splicing, scaling, derivation, pool).
`tests/market/test_store.py` starts a throwaway service (`RESEARCH_DOLT_BINARY`): writer privileges,
constraints, freshness and an export that `BacktestNode` loads whole, funding included.

## Minute research integration

This test branch uses `r1-native-v6`: real 1m LAST execution and 1m MARK observation, not the WS8b-v5 five-minute runner. Research reads market commits; it never imports or mutates the existing production market during a fixture. Select `--market-profile /absolute/path/market.json` separately from `--ledger RESEARCH`. Host export code and exact exported content are pinned with registrations/runs.
