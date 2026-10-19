# Market data

Binance USD-M perpetual market data, from public sources only, in a Dolt database of its own on the
research ledger's service. A replay cites one commit of it; the exporter turns that commit into the
Nautilus Catalogs the runner reads. The design is the site's market-data code page
(`docs/rd/design-code-market.zh.mdx`); the decisions and measurements it rests on are below.

| Module | Holds |
|---|---|
| `schema.sql` | the tables: `market_schema`, `instrument` terms (with their classification), 1-minute LAST and MARK `bar`, `funding`, `universe_month`, and the `v_universe` view |
| `sources.py` | data.binance.vision archives (each checked against its `.CHECKSUM`) and listings, public REST klines, funding and exchangeInfo; the coded `MarketError` |
| `series.py` | stitching one series (monthly, daily, REST), missing intervals, derived bars and their check against native bars |
| `instrument.py` | the terms snapshot of a commit and the engine instrument built from it |
| `universe.py` | the rule `usdt-perp-listed30d-v1`: classification, monthly members, membership paths |
| `store.py` | connections, `resolve_commit`, `import_month` (one month, one transaction, one commit), exact scaling, `freshness` |
| `export.py` | per-contract Catalogs (one per lifecycle episode), the native names and the bar, mark and funding writers |
| `lifecycle.py` | lifecycle manifests (`native-lifecycle-v1`) checked against a commit, and their native events written into a Catalog |
| `coverage.py` | per-contract coverage facts at a commit (`coverage_facts`, `diagnose_coverage`) |
| `read.py` | BTC and equal-weight universe daily returns for the report (`daily_returns`) |

## The database

`market init --name <name> --kind active|isolated|temporary --service-root <service>
[--backup-root <directory>]` (the administrator) creates the database (the name with `-` as `_`),
its tables, an import account and a reader account, and the profile (`kind: market`, `role: <kind>`,
`backup`) in the profile directory. Like the active ledger, the active market database needs
`--backup-root`, and its service and backup lie outside the checkout and temporary directories.
`market backup` syncs the whole history incrementally with dolt_backup to `<backup>/backup` (the
administrator, holding the import lock; outside the service directory and any Git work tree), and
refuses to overwrite a backup whose head is no commit of the market history (`BACKUP_DIVERGED`:
dolt_backup would replace it silently). `market review` reports whether the backup's head is still
an ancestor of `main` (`HISTORY_REWRITTEN` when not: the import account can amend its last commit,
which drops a pinned market commit; without a backup, `HISTORY_UNCHECKED`). The import
account may insert, call `dolt_commit` on `main` and update `market_schema` only to step its import
sequence by one (a trigger guards the other columns: Dolt 2.4.2 has no column grants); the reader
only selects. The first `market import` on the empty database writes the
`market_schema` row and the commit tests (`dolt_tests`, group `commit`); later imports only run them.
Commands without `--market` use the active market profile.

- **Universe** (`usdt-perp-listed30d-v1`): USDT perpetuals of coins; index contracts
  (`underlyingType` INDEX, or by name once exchangeInfo has dropped them: ALL, BLUEBIRD, BTCDOM,
  DEFI, FOOTBALL), other contract types (TRADIFI perpetuals, delivery), non-coin underlyings and
  the stablecoin bases USDC, FDUSD, TUSD, USDP, DAI, BUSD are excluded with their reason. A contract
  is a member of month M when it traded (a LAST minute with volume) on the day before M and its
  unbroken run of trading days up to that day is at least 30 days. Not ranked, no top N; a contract
  delisted later stays in the months it qualified for. The first imported month has no members (no
  history before it is held). A contract is classified by its earliest stored observation: later
  terms rows (a delisting contract reported SETTLING without a contract type) are recorded and never
  reclassify it.
- **Bars.** Only 1-minute LAST and MARK of eligible contracts; prices are integers x 10^8, volumes
  x 10^4 (`market_schema`). Every other timeframe is derived at export (`series.derive_bars`).
- **Sources, stitched invisibly.** Monthly archives, daily archives for months without one and for
  days a monthly archive lacks, then public REST for what no archive holds yet. A minute two sources
  both hold must agree on every field. Minutes no source holds stay missing and are reported.
- **Terms.** exchangeInfo's filters verbatim with the classification, a new row when they change; a
  contract that left exchangeInfo before its first import gets `inferred` increments.

## Import and freshness

```bash
uv run --frozen python -m cli.main market import --month 2026-09 [--symbols BTCUSDT ...]
```

`market import --month` appends one UTC month (the current month through the last closed day) in
one transaction and one commit, holding the database's import lock (`GET_LOCK('market-import:<db>')`;
a second import is `CONCURRENT_IMPORT`): the stitched bars and funding, changed terms, and the
universe of that month. Stored months cannot change (bars are insert-only, months import in order),
so only the imported month's universe is computed, from its 30-day look-back; importing the current
month again must give its stored members (`UNIVERSE_CHANGED`). A complete month is `MONTH_EXISTS`.
The current month imported again is stitched whole: its stored part is reread from the sources and
compared with the stored rows (bars field by field, funding settlement by settlement), any difference
is `MONTH_EXISTS`, and only the tail after the stored last minute is appended; nothing new returns the
stored commit. The commit tests run once, in `DOLT_COMMIT`; a failure is `DATA_TESTS_FAILED` naming
the tests.

Two sources' rows of one minute must agree at the stored scale (`1.50` and `1.5` agree). Funding is
one settlement per slot: a funding time belongs to its nearest whole UTC hour (Binance settles at most
hourly, with milliseconds of jitter), two sources in one slot must give one rate (the earlier source's
time is kept), and one source with two settlements in a slot is `SOURCE_SHAPE`. An archive row outside
its own month or day, or off the minute grid, is `SOURCE_SHAPE` before anything is trimmed. Archives are working copies under `--cache-root`.
The derived daily bars of each contract are checked against the exchange's daily klines; findings
are reported, nothing is changed.

`--symbols` is an engineering allowlist, set by a market database's first import:
the universe is computed over those contracts only, every import of the database must give the same
list, and the list is written in each commit message and reported by `freshness` (`scope`).

## Export

The replay entry exports the pinned commit for the replay window: per contract a receipt
`export.json` (format `market-coverage-v1`, the coverage facts, terms source and approximation, and
the pieces) and one Catalog per piece with the stored 1-minute LAST bars, one MARK price update per
1-minute MARK bar, funding updates, the daily LAST bars derived from every complete UTC day before
the window's end, and the piece's lifecycle events. Without a lifecycle the one piece is the contract
itself (`SYMBOL-PERP.BINANCE`, Catalog in the contract directory); with a lifecycle bundle each
episode is piece n (`SYMBOL-E<n>-PERP.BINANCE`, Catalog in `episode-<n>/`), holding only the minutes
complete inside it. A non-ASCII coin is spelled by its UTF-8 bytes in the native ID. MARK updates are
written at the precision their prices need (Binance mark prices carry 8 decimals).

Every replay trades on the latest terms observed at its commit (`historical_terms:
CURRENT_SNAPSHOT_APPROXIMATION` in the receipt). When that observation is later than the replay
window's end (a market imported after the fact), the runner adds the limitation
`CURRENT_SNAPSHOT_APPROXIMATION: <symbol> trades on terms observed at <time> (observed_at <ms>)` to
the run's summary, and so to its reports. The commit test `universe_members_have_terms` checks only
that every member has terms at the commit (the user's decision); a live month-by-month import observes
the terms during the month and so meets the stricter form as well.

## Decisions and measurements

- Only 1-minute LAST and MARK are stored; every other timeframe would be a second copy that can
  disagree. Fees, margins, instrument IDs and listing dates are not stored: they are exporter
  assumptions recorded in the receipt or are derived.
- rc3 has no Python writer for `FundingRateUpdate`, `InstrumentStatus` or `InstrumentClose`: the
  exporter writes the schema the engine's catalog decoder reads, and the runner checks the engine
  consumed exactly the exported counts. Recheck both on a Nautilus upgrade.
- pymysql's `autocommit=False` is not applied on Dolt 2.4.2 (the server reports autocommit off); the
  import account sets `autocommit = 0` itself so that one import is one transaction.
- A commit-test bound taken from each row is no index range on Dolt 2.4.2: a range on `ts_open`
  scanned each member's whole history (135 s at four months of 26 contracts, growing). The eve test
  looks up the 1,440 eve minutes of the newest month's members by full primary key instead (earlier
  months are immutable and were checked by their own commits).
- The daily warm-up is derived while streaming 20,000-minute chunks (BTCUSDT, 934,560 minutes:
  18.5 MB of growth instead of 145 MB for the whole history at once, the same 2.5 s). The export
  cache key includes the exporter's source hash.
- Exports stream through pymysql server-side cursors and write 250,000 rows per file.

## Tests

`tests/market/test_rules.py` needs no Dolt (sources against the stand-in exchange
`tests/market/exchange.py`, stitching, gaps, derivation, scaling, the universe rule, native names,
writers). `tests/market/test_store.py` starts a throwaway service (`RESEARCH_DOLT_BINARY`, fixture
`tests/market/dolt.py`) and imports three months from the stand-in exchange: schema initialization,
the universe, the import's refusals, freshness, membership, coverage, daily returns and an export the
engine streams whole.
