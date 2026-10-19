# Market data

Binance USD-M perpetual market data, from public sources only, in its own Dolt database on the
research ledger's service. A replay cites one commit of it; `export` turns that commit into the
Nautilus Catalogs the runner reads. The design is the site's market-data code page
(`docs/rd/design-code-market.zh.mdx`); the decisions and measurements it rests on are below.

| Module | Holds |
|---|---|
| `schema.sql` | the tables: 1-minute LAST and MARK `bar`, `funding`, `instrument` terms by observation, `daily_volume` and the monthly `pool` |
| `binance.py` | data.binance.vision listings and archives (each checked against its `.CHECKSUM`), public REST, exchangeInfo; no account or key |
| `universe.py` | which contracts are eligible, their daily quote volume, and the pool rule |
| `store.py` | the import (one commit per run, resumable), exact scaling, freshness and pool reads |
| `export.py` | the per-contract Catalog export of 1-minute bars (and the daily warm-up derived from them), with its cache |
| `lifecycle.py` | lifecycle manifests (`native-lifecycle-v1`) checked against a commit, and their native status and close events written into a Catalog |
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
uv run --frozen python -m market.cli import                 # through yesterday, one commit
uv run --frozen python -m market.cli import --resume        # after an interruption
uv run --frozen python -m market.cli status                 # pool months, newest day, latest complete month
uv run --frozen python -m market.cli pool --month 2022-05
```

`import --through DAY` stops before that UTC day. Archives are working copies under the temp
directory (`--cache`); a lost copy is downloaded again. An interrupted import leaves its rows in the
working set: a new import refuses until `--resume`, which continues from them and commits once.

## Export

The replay entry exports for every replay the pinned market commit for the replay window: one
Catalog per contract with the stored 1-minute LAST bars, one MARK price update per 1-minute MARK
bar, funding updates and the daily LAST bars before the window, and `export.json` (timeframe `1m`,
counts, terms, assumptions) written last. An exploration reuses the cache under the temp directory
(`trade-market-catalog/<commit>/<window>[-l<evidence>]/`, complete when `export.json` exists); a
sealed run exports afresh into a directory of its own. Derived daily bars: open, high and low over
traded minutes only (all minutes when none traded), close the last minute's, volume the sum.

With a lifecycle bundle (`lifecycle-<commit>` in the research ledger: `lifecycle.json` and the
exchange notices it cites), each listed contract's episode bounds its export (minutes that open at
or after the listing and close before the termination, funding settled inside it), its window
events are written in the engine's Arrow layout (`data/instrument_status/`,
`data/instrument_closes/`) and the receipt carries the episode; the bundle's files are copied under
`lifecycle-evidence/`. An episode lists native `InstrumentStatus` events (PRE_CLOSE: no new
positions; CLOSE: the market closes) and, only when the exchange published a settlement price, an
`InstrumentClose` of type CONTRACT_EXPIRED on the contract's price grid, with a CLOSE status at or
before it. One episode per contract
is supported; a reused ticker (several episodes) is refused.

## Decisions and measurements

- Only 1-minute LAST and MARK are stored; every other timeframe would be a second copy that can
  disagree. Fees, margins, instrument IDs, MARK precision (8 places), 30-day volume and listing
  dates are not stored: they are exporter assumptions recorded in `export.json` (`assumed`) or are
  derived. Funding intervals are not stored; the writer leaves `interval` empty and settles at each
  stored time.
- Price increments are stored as the exchange's strings (their decimals are the precision). A
  contract whose history traded finer than today's tick is exported with the precision its data
  needs and `price_precision_widened: true`, rather than refused.
- rc3 has no Python writer for `FundingRateUpdate`, `InstrumentStatus` or `InstrumentClose`: the
  exporter writes the schema the engine's catalog decoder reads, and the runner checks the engine
  consumed exactly the exported counts. Recheck both on a Nautilus upgrade.
- Monthly archives can lack days (the June 2026 MARK archive lacks 2026-06-29 for every contract);
  the import fills them from daily archives and refuses a minute two sources disagree on.
- Exports stream through pymysql server-side cursors (the Dolt CLI as a remote client turns every
  column into text and used tens of GB) and write 250,000 rows per file with four workers.
  Measured on commit `ebg4rg1g…`: 37 contracts, one year of 1-minute bars, 96 s and 4.4 GB client
  peak (1.2 GB of Catalogs).
- A full import peaked at 17 GB on the Dolt server (20.5 GB in the following `dolt gc`) and a
  monthly append of the whole pool takes about four minutes; the user accepted both (2026-10-12).

## Tests

`tests/market/test_rules.py` needs no Dolt (splicing, scaling, derivation, pool).
`tests/market/test_store.py` starts a throwaway service (`RESEARCH_DOLT_BINARY`): writer privileges,
constraints, freshness and an export that `BacktestNode` loads whole, funding included.
