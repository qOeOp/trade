# Market data

Binance USD-M perpetual market data, from public sources only, in a Dolt database of its own on the
research ledger's service. A replay cites one commit of it; the exporter turns that commit into the
Nautilus Catalogs the runner reads. The design is the site's market-data code page
(`docs/rd/design-code-market.zh.mdx`); the decisions and measurements it rests on are below.

| Module | Holds |
|---|---|
| `schema.sql` | the tables: `market_schema`, `instrument` terms (with their classification), 1-minute LAST and MARK `bar`, `funding`, `universe_month`, `quote`, complete `agg_trade`, and `metrics` (open interest and long/short ratios) |
| `sources.py` | data.binance.vision archives (each checked against its `.CHECKSUM`) and listings, public REST klines, funding and exchangeInfo; the coded `MarketError` |
| `series.py` | stitching one series (monthly, daily, REST), missing intervals, derived bars and their check against native bars |
| `instrument.py` | the terms snapshot of a commit and the engine instrument built from it |
| `universe.py` | the rule `usdt-perp-listed30d-v1`: classification, monthly members, membership paths |
| `store.py` | connections, `resolve_commit`, `import_month` (one month, one transaction, one commit; after the latest month or just before the earliest), exact scaling, `freshness` |
| `export.py` | per-contract Catalogs (one per lifecycle episode), the native names and the bar, mark and funding writers |
| `lifecycle.py` | lifecycle manifests (`native-lifecycle-v1`) checked against a commit, and their native events written into a Catalog |
| `coverage.py` | per-contract coverage facts at a commit (`coverage_facts`, `quote_facts`, `diagnose_coverage`) |
| `read.py` | BTC and equal-weight universe daily returns for the report (`daily_returns`); one contract's stored bars and funding at a commit for source reviewers (`stored_bars`) |
| `quotes.py` | best bid/ask inferred from Binance aggTrades under `RULE` and the checks a quote import applies (`derive`, `scaled_rows`) |
| `aggtrades.py` | complete source aggTrades: bounded ZIP/CSV ingestion, exact scale-8 integers, one transaction per contract month, several contracts of a month written at once |
| `metrics.py` | open interest and three long/short ratios from the daily `metrics` archives, exact decimals, the days of a month not yet held appended per contract |

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
which drops a pinned market commit; without a backup, `HISTORY_UNCHECKED`). `market publish [--remote
URL]` pushes `main` and its tags to the public DoltHub copy without force, holding the import lock;
imports and upgrades publish by themselves. The import
account may insert, call `dolt_commit` on `main` and update `market_schema` only to step its import
sequence by one (a trigger guards the other columns: Dolt 2.4.2 has no column grants); the reader
only selects. The first `market import` on the empty database writes the
`market_schema` row and the commit tests (`dolt_tests`, group `commit`); later imports only run them.
Commands without `--market` use the active market profile.

The [62-archive retention inventory](../docs/plans/market-archive-retention-inventory.zh.md)
found all cached originals still present with matching hashes, but found no matching original copies
in the inventoried backup files and paths; recovery was not attempted. `market backup` syncs database
history, while original ZIPs remain in the external cache. This inventory does not certify raw-file
backup recovery or database-backup health; offline, cloud-only, unmounted and permission-limited
locations remain unverified. No existing backup, cache or rule was changed.

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

## Complete aggTrades

`agg_trade` retains the official seven USD-M aggTrade fields plus the archive's `symbol`, including
events which did not change a quote. Its primary key is `(symbol, transact_time, agg_trade_id)`;
there are no secondary indexes or derived columns. `price` and `quantity` are signed BIGINTs exactly
multiplied by 100,000,000 under `binance-aggtrades-int64-scale8-v1`, independently of the bar scales.
Every value must fit exactly: loss of precision or integer overflow refuses and rolls back the entire
month (`SCALE_LOSS`), with no rounding or alternative encoding.

```bash
uv run --frozen python -m cli.main market upgrade
uv run --frozen python -m cli.main market import-trades --month 2025-10 --symbols BTCUSDT ETHUSDT SOLUSDT
```

Each named contract month is one transaction and one commit. The call holds the same `market-import` lock
on one connection while the contracts are written at once, one import connection each: a single writer
spends most of its time waiting on each batch's round trip, and Dolt serves writers of different contracts
in parallel (three writers, about three times the rows per second of one, measured on 2.4.2). A refused
contract leaves the others' commits in place, and the refusal names them. It uses the existing restricted
import account, commit tests, one automatic DoltHub publication and the `market backup` path. It streams each
checksum-verified daily ZIP/CSV with bounded download and INSERT buffers; daily row counts, first/last
IDs and times, maximum time gap, archive SHA-256s and the codec identity live in the import commit.
The eve is validated for source continuity and the same complete-field/codec checks, but is not inserted.
Missing, duplicate or non-contiguous
agg IDs, within a batch or across batches/days/eve, remain `SEQUENCE_GAP`, except that an ID Binance repeats
for a distinct later trade (a later time and raw trade IDs after the previous row's) is imported as both
rows, which the primary key already tells apart; no alternate archive source
or repair is attempted. The first published day may start without an eve only when no earlier stored
complete trades exist. Current months stop at the last closed UTC day and cannot later be extended;
any stored row in the contract month is `MONTH_EXISTS`.

An upgrade only appends the missing table and preserves old tables, accounts, schema scales and commits.
Schedule the active upgrade after any existing import queue is complete. The complete source table is
not read by old bars/quotes exports or replay, and does not add TradeTick files or change quote derivation.
Measurements, the independent field review and release gates are in
[the phase-one record](../docs/plans/aggtrades-source-import.zh.md).

## Open interest and long/short ratios

`metrics` holds the daily `metrics` archives of Binance USD-M (data.binance.vision, published a day
late, one row every five minutes): `sum_open_interest` (a base-asset quantity) and the three ratios
`count_toptrader_long_short_ratio` (top traders' accounts), `sum_toptrader_long_short_ratio` (top traders'
positions) and `count_long_short_ratio` (all accounts), keyed by the archive's `create_time` and named as
the archive names them. Values are exact `DECIMAL(38,16)`: a value needing more decimals or integer digits
refuses the day (`SCALE_LOSS`), never rounded. A ratio the archive leaves empty (whole days in 2022) is
NULL. The archive's taker volume ratio is a trade aggregate (exact from `agg_trade` where trades are
imported) and its open interest value is open interest times an exchange price snapshot; neither is stored.

A row stamped t describes t + 5 min: its open interest equals public REST's at t + 5 min on 288 of 288
rows, and REST publishes a sample one to two and a half minutes after its stamp (measured 2026-10-31).
The import stores `create_time` as given; a replay export decides when a row is visible.

```bash
uv run --frozen python -m cli.main market upgrade
uv run --frozen python -m cli.main market import-metrics --month 2025-10 --symbols BTCUSDT ETHUSDT SOLUSDT
```

Each call appends, for each contract (default: the month's universe members), the days of the month
after those its earlier imports hold, through the last closed UTC day, as one transaction and commit
(`MONTH_EXISTS` once every closed day is held). The archive carries no sequence to check across an
interruption, so a month may be completed by later calls. Days without an archive before the last
published one are recorded in the receipt's `unpublished`; later ones wait for a later call. Rows come
unsorted; identical repeats of one `create_time` (every row of BTCUSDT from 2020-09 to at least 2021-05)
are merged and counted (`repeated_rows`), different ones refuse (`SOURCE_SHAPE`), as do a time off the
five-minute grid of its day and a row without open interest. The receipt (commit message) carries each
day's archive SHA-256, rows, repeated rows and empty ratios; `market coverage` reports them per contract
with the five-minute rows the stored days lack. The decision and field review are in
[the plan](../docs/plans/binance-open-interest-input.zh.md).

`market follow-metrics --symbols BTCUSDT ETHUSDT SOLUSDT` keeps those contracts current unattended. It runs
until stopped.

Each round:
- calls the import above once per contract, for each month with days still missing;
- downloads the archives into the cache first, outside the import lock;
- publishes whenever the market is ahead of origin;
- writes a status file (default `metrics-import/status.json` under the temporary directory) and prints the
  same status as one JSON line.

A round comes an hour later while a contract waits for an archive; otherwise it runs daily at 00:30 UTC.

Refusals are sorted by what fixes them:
- **Next round:** a lock another import or a backup holds, an unreachable or bootstrapping service, the
  network, an unconfirmed push.
- **Until the process restarts:** a content refusal stops its contract; a refusal about the whole database
  or its publication stops every contract.

A contract that no import holds is never imported: its history is imported once by hand. A day still missing
`LAG_DAYS` (3) days after it closed marks its contract `lagging` and is then polled daily.
`market.follow.check()` is the healthcheck. It is unhealthy while any contract is stopped, lagging or unknown,
or while the status is older than 26 hours. Decisions: [the plan](../docs/plans/daily-metrics-import.zh.md).

## Quotes

Binance no longer publishes best bid/ask archives (bookTicker ended in 2024-04), and the native backtest's
liquidation reads cached quotes only. `quote` therefore holds best bid/ask **inferred** from the public
daily `aggTrades` archives under one declared rule, `quotes.RULE` (`binance-aggtrades-bbo-v1`): the rule
reads a trade whose buyer is the maker as a sell into the best bid and takes its price as the inferred
bid, and a buyer-taker trade as a lift of the best ask; each side is carried forward until it trades
again; a stale side that crosses the
fresh one is pushed one price increment off it (counted in the import result, never silent). Every state
change is stored: thinning to each second's extremes was measured to move a liquidation to the second's
adverse extreme up to a second late (2025-10-01: 84 USDT worse, 0.9 s later), so there is no thinned form.
About 0.9M rows a day for BTCUSDT, 4–6 GB a contract-year in Dolt for the most active contracts. Sizes are not
observable and not stored; the exporter fills the instrument's `max_quantity` ("no depth modeled"). This is a
declared approximate quote model: between two trades a side's true quote may have moved, and the error is
two-sided (a stale side can sit inside the true spread). It is an inference, not an observation: the latest
trade price need not be the best bid or ask an API order could have hit at that instant. Binance USD-M RPI
(retail price improvement) fills enter aggTrades without a tag, while RPI orders are absent from the API
order book and bookTicker and cannot be matched by API orders (Binance FAQ, published 2025-11-17); which
contracts and archive months this touches cannot be read from the archives and stays unknown.

```bash
uv run --frozen python -m cli.main market upgrade                      # the administrator: add missing tables, drop views no longer defined
uv run --frozen python -m cli.main market import-quotes --month 2025-10 [--symbols BTCUSDT ...]
```

`market import-quotes --month` appends one UTC month per contract (default: the month's universe members)
in one transaction and one commit whose message carries `quote_rule` and the SHA-256 the exchange
published for every archive read (the input identity an audit re-checks a re-download against); a later import
under another rule is `RULE_VERSION_MISMATCH`, a month already held is `MONTH_EXISTS`. Each day's archive is checked against its
`.CHECKSUM`. Every month, an earlier one included, is inferred with the price increment of the
contract's newest stored terms row, not the increment in force that month: across a tick change a
stale side that crosses is pushed today's increment off the fresh side. The `agg_trade_id` sequence
must be contiguous within the day and continue the day before
(`SEQUENCE_GAP`; an ID Binance repeats for a distinct later trade, one whose raw trade IDs follow the
previous trade's, is a trade of its own and feeds the inference), the eve's archive is read for the carried state, times must not go backwards. The result
reports per contract the trades, states, adjustments, minutes with trades and the trade-gap p99: a contract
with sparse trades may carry old inferred sides. These diagnostics are not per-side quote age or
an admission threshold: daily trade gaps exclude day-boundary gaps, and the aggregate p99 returned
is the maximum daily p99, not a pooled monthly percentile. Validate suitability for each contract,
period and intended liquidation use against observed BBO and matched native replay evidence;
report missing evidence without automatically dropping contracts or shortening the window. See
research-start's `references/readiness.md` for the boundary. `market coverage` gives each contract's
quote imports (month, `through`, rule, commit and the rows the receipt counts), its first and last
stored quote in the interval and the parts of the interval no import covers.
The historical four-day probe reported inferred BTCUSDT mid deviations within 0.7 bps at p99;
its original reference files and contemporary hashes were not found. The subsequent
[twelve month-start native liquidation comparisons](../docs/plans/monthly-quote-liquidation-validation.zh.md)
completed as engineering runs, not full suitability acceptance: the May reference has a confirmed
collection disconnect, inferred T and observed E differ in time semantics, and historical byte identity
remains unverified. Neither result establishes complete reference continuity or other-contract suitability.

The [October/November 2025 post-hoc readings check](../docs/plans/quote-readings-posthoc-202510-11.zh.md)
recomputed 61 days and matched all 93,261,348 stored quote states at one fixed market commit.
The original import commits still lack `readings` and were not rewritten; temporary recomputation
is separate evidence, not a recovered import-time receipt. It does not close the observed-BBO,
liquidation-suitability or durable archive-retention gaps described in that record.

## Import and freshness

```bash
uv run --frozen python -m cli.main market import --month 2026-09 [--symbols BTCUSDT ...]
```

`market import --month` appends one UTC month (the current month through the last closed day) in
one transaction and one commit, holding the database's import lock (`GET_LOCK('market-import:<db>')`;
a second import is `CONCURRENT_IMPORT`): the stitched bars and funding, changed terms, and the
universe of that month. Months extend at either end: the latest month completed, the month after
it, or the month just before the earliest (a backfill); any other month is `MONTH_INVALID`. Stored
months cannot change (bars are insert-only, and a month's 30-day look-back lies before it), so only
the imported month's universe is computed; importing the current month again must give its stored
members (`UNIVERSE_CHANGED`). A complete month is `MONTH_EXISTS`.
On the current month's first day, with the month before held through its end, the import writes
that month's members only (no bars or funding; `through` is the month's first day): they depend on the
days before it alone, and paper starts read them.

A backfill inserts only, so every stored commit, and every replay pinned to one, stays as it was. The
month must hold no bar or funding row of any contract yet (`MONTH_EXISTS`); it becomes the first
month and has no members. The stored months whose look-back it completes (the month after a 31-day
backfill) had none for want of history and get their members now (`universe_filled` in the result);
one that already has members is `UNIVERSE_CHANGED`. Imported back month by month, the database ends
with the rows a forward import from that month gives; only the terms' observation times differ. The
commit message has the forward format: whether an import was a backfill follows from the commit order.
A replay moved to a later commit gets a longer daily warm-up (the export derives it from a contract's
first stored minute). Quotes (`market import-quotes`) are imported per contract and month in any order,
but a replay of an earlier month needs its bars and members, so backfill the bars first.

The current month imported again is stitched whole: its stored part is reread from the sources and
compared with the stored rows (bars field by field, funding settlement by settlement), any difference
is `MONTH_EXISTS`, and only the tail after the stored last minute is appended; nothing new returns the
stored commit. The commit tests run once, in `DOLT_COMMIT`; a failure is `DATA_TESTS_FAILED` naming
the tests.

Two sources' rows of one minute must agree at the stored scale (`1.50` and `1.5` agree). Funding is
one settlement per slot: a funding time belongs to its nearest whole UTC hour (Binance settles at most
hourly, with milliseconds of jitter), two sources in one slot must give one rate (the earlier source's
time is kept), and one source with two settlements in a slot is `SOURCE_SHAPE`. `market coverage` reports each contract's
settlement spacing in the interval (runs of equal spacing between settlements, a new run is a spacing
change) and the settlements missing inside a run, instead of the settlement times (`market bars` lists them). An archive row outside
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

Input preparation follows the declared execution environment: bars does not read or convert stored
quote rows; quotes retains the inferred best bid/ask conversion. Every file actually exported still
enters the same content fingerprint. Reproduction uses the original capture's quote counts to
restore historical bars exports that included quotes, then checks the original input and report
fingerprints without changing them. A locked registration still refuses a changed export identity;
it is not migrated to a new projection.

Every replay trades on the latest terms observed at its commit (`historical_terms:
CURRENT_SNAPSHOT_APPROXIMATION` in the receipt). When that observation is later than the replay
window's end (a market imported after the fact), the runner adds the limitation
`CURRENT_SNAPSHOT_APPROXIMATION: <symbol> trades on terms observed at <time> (observed_at <ms>)` to
the run's summary, and so to its reports. `market coverage` returns that terms row per contract
(`terms`: observation time, source, price and size increments, quantity, notional and price limits).
The commit test `universe_members_have_terms` checks only that every member has terms at the commit
(the user's decision); a live month-by-month import observes the terms during the month and so meets
the stricter form as well.

## Reading prices

`market bars --symbol S [--price-type LAST|MARK] [--timeframe 1m|1d] --start T --end T [--at C]
[--limit N | --output FILE]` gives a source reviewer the prices a replay of commit C reads, without a
trial or an exposure: the stored 1-minute LAST or MARK bars, or the daily LAST bars the export
derives (whole UTC days only), and the funding settlements of the interval, each bar with the time
the Catalog delivers it (`ts_event_ms`, its close). It reads through the exporter's own functions
(`read_bars`, `daily_bars`, `read_funding`) as the reader account at the exact commit, prints at most
`--limit` bar periods (default 1440) with `next_start` for the rest, or writes the whole interval to
a new JSON file under the temporary root. It writes nothing and never publishes. `ledger sql` stays
refused on a market profile (`LEDGER_KIND`); `--help` states the full contract.

## Decisions and measurements

- Only 1-minute LAST and MARK are stored; every other timeframe would be a second copy that can
  disagree. Fees, margins, instrument IDs and listing dates are not stored: they are exporter
  assumptions recorded in the receipt or are derived.
- The pinned Nautilus has no Python writer for `FundingRateUpdate`: the exporter writes the Catalog's
  own layout for it, which `ParquetDataCatalog.query` reads; status and close events go through the
  Catalog's writers. The runner checks the engine consumed exactly the exported counts. Recheck both
  on a Nautilus upgrade.
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
the universe, the import's refusals, freshness, membership, coverage, daily returns, stored bars and an
export the engine streams whole.
## Remote supply for replay inputs

The replay/registration `MarketAdapter` also accepts a remote market profile. The supply host
keeps the full Dolt database (or its read-only DoltHub replica); a replay client needs only the
native files of its pinned commit, selected contracts and input window. This does not feed the
`agg_trade` table or `TradeTick` into the engine. Bars, quotes, funding, daily warm-up, lifecycle
evidence, membership and all existing audit checks retain their current meanings.

Start the read-only supply process on the host that already has the local market profile:

```bash
uv run --frozen python -m market.remote --market MARKET_PROFILE --bind 127.0.0.1 --port 8210
```

Use a client profile file with no Dolt service or SQL account:

```json
{
  "kind": "market",
  "database": "market",
  "remote_url": "http://127.0.0.1:8210",
  "cache_root": "/tmp/trade-market-remote",
  "timeout_seconds": 3600
}
```

Pass its path as the existing `--market` argument to `replay explore`, `replay precheck`,
`replay run`, `replay reproduce` or registration input preparation. This is an input adapter;
market administration/import commands and paper's live setup still require their local profiles.
No active profile is changed. The default bind is loopback; a deployment across hosts must supply
its normal HTTPS/reverse-proxy access boundary. The Python HTTP process exposes public market
inputs without application authentication and is not an internet-facing deployment by itself.

The protocol resolves a reference once, then requires the full immutable commit for metadata and
exports. The protocol version and the database must agree on both ends; a refusal names the field
that differs and both values. The exporter code need not: the client verifies every file against
the supply's manifest, the input identity holds the content hash of what it received (a different
export is a different `export_content_sha256`, which comparisons refuse), and the supply's exporter
hash is recorded as `exporter_source_sha256`, provenance only. A nonfresh request reuses a cached
manifest only when the supply's current exporter made it. When the protocol differs, update the
supply to the client's version or pass a local market profile with `--market`. The server exposes
only designed metadata/export reads and content-addressed file downloads; there is no SQL, import,
arbitrary file-path or ledger-write endpoint. Daily warm-up still includes the history the current
exporter requires, even when it precedes the requested minute window.

Client cache objects are verified by size and SHA-256 before atomic completion. Partial downloads
can resume on a later explicit call; corrupted/truncated responses never become native inputs.
Each replay gets an independent materialized directory, so an executing replay cannot modify a
shared cache object. Transport manifests stay outside that directory and do not enter native input
fingerprints. The existing semantic fingerprint and replay's before/after immutability checks are
unchanged. Temporary input copies are cleaned by the existing entry's cleanup, while verified cache
objects remain available for later requests.

Nonfresh exports may use the verified local manifest and objects. **Fresh still means a new
server-side export**: formal runs, prechecks and reproduction contact the source, verify its newly
generated manifest, and reuse only byte-identical cache objects. A warm fresh request can therefore
avoid downloading unchanged Parquet files, but it cannot skip source export or verification. No
fallback to `main`, a different source, a local database or partially available inputs is used.

Caches are disposable working copies, not a second canonical database or backup. This first step
does not add automatic eviction: budget for the client cache plus its current materialized window,
and the supply host's exported windows. Operators own their working-cache retention; canonical
data, existing Catalog inputs and old backups are never removed by this adapter.
