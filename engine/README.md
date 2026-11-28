# Native replay

Every native replay goes through the one replay entry (`replay.entry`, reached through the command
line: `replay explore`, `replay precheck`, `replay run`, `replay reproduce`): it exports the market
inputs, probes the CI-built image, writes the trial and its start receipt, then runs `python -m
engine.run`, the native auditor and the fingerprint in that image. Never start a replay or a probe
with `docker run` or `python -m engine.run` directly.

| Path | Role |
|---|---|
| `config.py` | The runtime contract, the fixed account, arguments, window parsing, the effective configuration, the runtime source identity, `--describe` and the runner's refusal codes |
| `load.py` | The hash-checked strategy source and its run identity, the exported market Catalogs, universe membership, the source's diagnostics, shared membership intersection, entry scopes and the lifecycle events rebuilt from the coverage receipt |
| `run.py` | The streamed `BacktestEngine` run, replay input construction and importable dynamic classes, lifecycle episodes, the capital observer, its expected MARK count and findings, and the execution binding check |
| `warmup.py` | The `WARMUP` declaration, the history ranges and adjacency it requires, and the bars a replay derives for it |
| `strategy.py` | Shared native allocation, callback/cache/clock evidence boundaries, subscription declarations and the process-local failure/source registry |
| `fill.py` | The existing native fill-model factory shared by Replay and Sandbox |
| `report.py` | Native reports, `order_events.jsonl.gz`, `fill_volumes.csv`, the `exposures.csv.gz` writer and `summary.json` with its statistics |
| `audit.py` | Independent audit of every run's native reports, submission timing, entry membership, stop protection and lifecycle terminations; its finding codes |
| `compare.py` | The semantic fingerprint of one run's native reports (`python -m engine.compare`) |
| `compare_reports.py` | Engineering parity between two runs |
| `runtime/` | Image build inputs |

Paper trading (`paper.py`) is described in [paper/README.md](../paper/README.md#paper-trading), Live
execution (`live*.py`) in [live/README.md](../live/README.md#live-execution).

## Four inputs

The runner takes the strategy reference, the inputs, the window and the account, nothing else.

- **Strategy.** One complete source file, its entry class and SHA-256, and the execution binding
  every replay (exploration, precheck, sealed run, reproduction) passes the same way: the runtime
  identity and effective configuration the probe reported, refused as `EXECUTION_BINDING_MISMATCH`
  when they differ from what the runner resolves itself. The `replay-contract@v8` contract is in the [strategy-authoring
  reference](../.agents/skills/research-round/references/strategy-authoring.md). The file holds every
  rule and constant, sizing included; a variant is a new revision. There are no signal, exit,
  warmup or sizing options: a source declares the history it needs in `WARMUP` (below).
- **Inputs.** One market day ([`market`](../market/README.md))
  and the contracts: `--symbols SYMBOL ...` (Binance symbols such as `BTCUSDT`) or `--universe pool`
  (every contract the universe holds in some month of the trade window), and optionally the
  day's lifecycle bundle (`--lifecycle-bundle lifecycle-<day>`). The replay entry exports the
  day into one Catalog per contract and passes the runner `--market-root`, `--market-day`,
  `--universe` (the membership file it wrote) and the symbols; the runner checks each Catalog's
  `export.json` against the market day, the window and the one-minute timeframe. Every strategy instance
  receives its contract's membership as `universe_membership` ([UTC start, end) nanosecond
  intervals, cut at the listing and at the first PRE_CLOSE or termination of its lifecycle
  episode); the source manages exits, and the independent audit requires only-reduce orders
  outside those intervals and checks that old entry residuals have ended. A contract whose episode does not intersect the window gets no instance.
  In Paper and Live the membership grows month by month from the host's `inputs/membership/<YYYY-MM>.json`
  (`engine.membership`; docs/plans/paper-monthly-membership-20261111.zh.md): an entry outside it is not sent in
  Paper and denied natively in Live (`entry_denied`, detail `entry_outside_membership`), and the run goes on.
- **Window.** `--start`, `--trade-start` and `--end` need an explicit `Z` or UTC offset (whole
  minutes, at most six fractional digits) and fall on the one-minute grid with
  `start <= trade-start < end`; the host timezone is never consulted, and the effective
  configuration holds them as `...Z` text.
- **Account.** Fixed in `config.py` (`ACCOUNT_CONTRACT`): one Nautilus margin account (100,000 USDT unless the
  runner argument `--starting-balance` gives another positive amount, which enters the account contract)
  shared by every instrument, the leverage `--leverage` (default 3, Binance's 1 to 125; the `bars` instruments carry
  margin rates 1, so an order and a position lock notional / leverage as on Binance; Paper and Live use the same
  leverage), one-minute bar execution (`execution_bar_minutes = 1`),
  the venue's maker and taker rates from the export receipts' assumed fees (maker 0.0002, taker 0.0005;
  a native `MakerTakerFeeModel`) and the stored funding. Fills
  use the native `DefaultFillModel` with both probabilities 0, so it draws no random numbers: a
  resting limit fills at its price only when a bar trades through it (a touch alone never fills),
  and the model adds no slippage (a market order still takes a quarter of the bar's volume at the
  close and the rest one tick worse). Each bar visits the extreme nearer its open first
  (`bar_adaptive_high_low_ordering`), which decides a stop and a target that fall in one bar;
  consumed-liquidity and queue tracking stay off. The
  published `nautilus_trader==2.0.0rc7` owns data replay, orders, fills, funding settlement, risk,
  portfolio accounting and reports. No exchange trading credential is needed.

The export holds the stored one-minute LAST bars, one MARK price update per one-minute MARK bar,
funding updates, every complete daily LAST bar before `--end` and, with a lifecycle bundle, the window's
native `InstrumentStatus` (PRE_CLOSE, CLOSE) and `InstrumentClose` events; a contract whose stored trades stopped
and that no bundle lists gets one CLOSE status at its last traded minute's close (market `history.data_end_stops`). The runner checks that
the engine consumed exactly the exported counts. There is no second matching or account engine.

A source declares `WARMUP = {period: bars}` (`warmup.py`), keyed by Binance kline period (1, 3, 5, 15, 30
minutes; 1, 2, 4, 6, 8, 12 hours; 1 day). The keys are also the periods it may aggregate to; a period it only
aggregates to has 0 bars. An instance's start T is the later of `--trade-start` and its contract's listing or,
while a declared history does not hold yet, the first whole minute at which it does. At T the runner requests,
for each period P with n > 0 bars, `{id}-{P}-LAST-EXTERNAL` over [floor(T, P) - n P, floor(T, P) - 1 ms]. The
source's `on_historical_bars` receives the n adjacent bars once per period, each stamped 1 ms before its bucket
ends, and then its `on_start` runs, after the data that arrives at T itself (`ts_init` T), whether T is the window's
start or later. It sees no data stamped before T nor any arriving at T, and until `on_start` its orders are
`ORDER_RULE`. It cannot request data itself: a `request_*` call is `SUBSCRIPTION_OUTSIDE_CONTRACT`.

`WARMUP` may also hold `"FUNDING": n`. Before `on_start`, the source's `on_historical_funding_rates` then receives
the last n funding settlements at or before T, each the native update a replay streams for it: the rate, with
`ts_event`, `ts_init` and `next_funding_ns` at the settlement time. A settlement stamped T itself is in the history,
since no live update of it reaches a source that starts at T. A replay reads them from the export's settlements of
the window, so T waits until the window holds n of them. Paper and Live read them from Binance's public
funding-rate history (`fapi/v1/fundingRate`, no credential), which answers the monthly archives' settlement times,
millisecond jitter included, and rates; fewer than n is `WARMUP_INSUFFICIENT`.

- Daily bars come from the export and one-minute bars from the window's export.
- The other periods are derived from the window's minutes by the market's daily rule: open of the first
  traded minute, high and low over the traded minutes, close of the last, volume summed. Their history
  therefore starts at `--start`. A native aggregation opens at its first minute's open and spans every minute,
  so it can differ from a derived bar on a bucket that opens with untraded minutes.
- For each declared aggregation, an actor feeds the native aggregator the minutes of [floor(T, P), T), so the
  first aggregated bar the source sees covers its whole bucket. A native aggregation is stamped at the end of its
  bucket.

A contract whose history never holds in the window gets no instance. A deferred start and a missing instance
are summary limitations, and a run in which no contract can start is `WARMUP_INSUFFICIENT`.

Paper and Live warm a source the same way at their own T, the first whole minute at least 30 s after they
start (`history.py`). From T + 15 s (a just-closed Binance kline was final by then in every probe) they fetch
the history and the minutes of [floor(T, P), T) from Binance's public klines (`klines.py`, no credential) into a
temporary Catalog and request them natively as a replay does, and read the declared funding settlements. The first live minute must close at T + 1 min.
Binance stamps a settlement at its hour or some milliseconds after it. At a T on a settlement hour, a replay streams
a settlement stamped after T to a source subscribed in `on_start`, and never one stamped T itself (a declared funding
history holds it); the live stream passes it before a Paper or Live source subscribes. For a source that defines
`on_funding_rate` and starts on a whole hour, the warm-up therefore reads the funding-rate history too (declared or
not, with the same wait and deadline). When the source subscribed to its contract's funding by the end of `on_start`,
a settlement stamped after T then goes to `on_funding_rate`, the replay's update at the replay's stamps and rate.
Later settlements come from the stream (`engine.cadence`): the settled rate, stamped at the settlement's hour where a
replay stamps Binance's settlement time (0 to 7 ms later in the settlements of 2026-11 sampled, 13 ms in one of
2025-10).
Binance changes a contract's funding interval between 1, 4 and 8 hours after a settlement and settles at its
multiples. The warm-up waits for the settlement that the interval now (`fapi/v1/fundingInfo`) makes due at or before
T, not the one the latest settlements' spacing predicts; in the stream, an estimate that names a later time before
the named one has come is no settlement.
Klines that miss or are not adjacent are `WARMUP_INSUFFICIENT` or `WARMUP_NOT_ADJACENT`, and a fetch or
delivery not done by T + 45 s is `WARMUP_TIMEOUT`; no order can go out before the warm-up ends. Paper
refuses the run and Live stops it. A live aggregation closes on a timer, but the bucket's last Binance minute
arrives after the bucket's end (up to 0.47 s in 84 minutes of trials), so Paper and Live build it 5 s later
(`history.BUILD_DELAY_US`); rc7 then stamps it at the bucket's end plus 5 s, not at the end as a replay does.

Paper and Live also check the contract's terms against the market's (`engine.config.TERMS_COMPARED`: tick size,
step size, minimum notional): Paper against the terms `paper start` wrote from the run's market day, at start (the
loaded instrument) and for each entry; Live at each entry's admission against the terms `prepare` read from the
market's latest day. For an entry both read Binance's `fapi/v1/exchangeInfo` then (`engine.config.venue_terms`), as
rc7 does not reload a loaded instrument mid-run, off the node's thread: the entry waits unsent while bars, timers and
reduce-only orders go on (`engine.paper_terms`), and a Paper checkpoint is not cut while one waits. An entry
its source cancels while it waits (a market exit cancels it too) is never sent and ends `CANCELED` natively
(`engine.unsent`): in Paper once its read is done, in Live on the Observer's next tick. One a source submits
during its market exit does not wait: it is denied at once, as in a replay, in Paper by Nautilus and in Live by the
entry gate (`entry_denied`, detail `entry_during_market_exit`), and Live's run goes on. A difference is
`TERMS_CHANGED`, with both values: the entry is not sent and the run stops; reduce-only orders are not checked. Paper refuses an entry whose terms it could not read the
same way. Both admit an entry only on an active USDT-margined perpetual (`engine.config.venue_inactive`: status
`TRADING`, contract type `PERPETUAL`, margin asset `USDT`): Binance keeps sending bars of a `SETTLING` contract.
Paper then does not send the entry, journals `entry_not_sent` (`PAPER_INSTRUMENT`) and goes on, as Live denies an
entry on a contract that is not `TRADING` and goes on (a Live contract whose type or margin asset changed is
`LIVE_INSTRUMENT` and ends the run; Binance does not change those under a symbol without its status). A replay never meets a change: it trades the whole window on one terms snapshot per contract
(`market.instrument`). Paper's Sandbox cannot take the replay's margin rates (rc7's Python cache cannot
replace an instrument), so it keeps the loader's 0.1 and sets its leverage to `--leverage` x 0.1, which locks the
same margin; a loaded contract with other rates is `TERMS_CHANGED` too. Live never sets leverage: the venue's
symbol leverage must equal the run's (`LIVE_MARGIN_MODE`).

The runner argument `--execution` chooses the execution environment, and the choice is part of the
account contract in the effective configuration (so of every run's identity and of the comparability of
runs); a source never chooses it (`ENVIRONMENT_DECLARED` if it declares `QUOTE_EXECUTION` or a margin
rate). `bars` (the default) is the bar environment above. `quotes` needs `--initial-margin` and
`--maintenance-margin` (decimal strings, 0 < maintenance <= initial < 1: the Binance bracket of the
strategy's largest position; `MARGIN_RATES_INVALID` otherwise, also when bars is given a rate): the
export's best bid/ask quotes (`market import-quotes`, inferred from Binance aggTrades under a declared
rule, both sizes the instrument's max quantity) are streamed to the venue and drive matching on an L1
book, bar execution is off (bars only feed signals; the source cannot subscribe to the quotes), the venue's native liquidation is on
(`liquidation_enabled`, trigger ratio 1.0, open orders cancelled first) with the standard margin model
(initial and maintenance margin are each notional x the rate, neither divided by leverage), and the instruments carry the
two rates. So in `quotes` `--leverage` takes no part in margin: it is still validated and recorded as the account's
`default_leverage`, in the effective configuration and so in the run's identity, and the venue is given it, but the
standard margin model ignores it.
An active contract whose export holds no quote in some UTC month of its trading window (from its trade start to the
window end or its termination) is `QUOTES_MISSING`, naming each such month: there bar execution is off, so a month
without quotes would replay without matching. The quotes count in the consumed
events. The summary names the environment (`execution`) and its limitations state the model, which is
declared, not the exchange's: equity is valued at the cached best bid/ask, not the mark price; the
maintenance margin is fixed at the position's average entry price; fills take the best price with no
depth; the quotes themselves are an inference from trades (see `market/README.md`).

Trade ticks are signal input for the quote environment. The entry's `--trade-ticks` (a host flag, never
passed to the runner; `TRADE_TICKS_NEED_QUOTES` without `--execution quotes`, where a market order fills
at once at the previous bar's close, so one a trade prompts mid-minute would fill at a price up to 59 seconds
older than the trade) exports every stored aggregate trade
(`market import-trades`) as one native `TradeTick` and counts it in the receipt (`counts.trade`, present
only then, so an export without trades keeps its bytes). The runner streams the trades of every contract
whose receipt counts them, each wrapped as `CustomData(DataType("TradeTick", metadata={"instrument_id":
<id>}), tick)`; how a source subscribes and reads them is in the research-round skill's
[Trades and metrics](../.agents/skills/research-round/references/strategy-authoring.md#trades-and-metrics). The venue never sees custom data, so trades match no order and move no book; a
native `TradeTick` would overwrite the venue's L1 book whatever `trade_execution` says (probed on
2.0.0rc7: a market order after a trade below the bid filled at the trade's price, not the quoted ask).
A month of the trading window without exported trades is `TRADES_MISSING`. A source subscribing to trades
the run does not stream (no `--trade-ticks`, or native `subscribe_trades`, which is never served) would see
none: the runner stops after the chunk it subscribed in and refuses `TRADES_NOT_SERVED`. Paper trading
streams no trades (its orders match bars, as in the bar environment), so a trade subscription stops a paper
run with the same code.

Open interest and long/short ratios (`market import-metrics`) are signal input in either environment. The
entry's `--metrics` exports every stored row the window shows by the rule `binance-metrics-visible-v2`
(the receipt's `metrics_rule`): a row stamped `create_time` gets `ts_event = create_time + 5 min`, the
instant it describes (public REST's row of that timestamp), and `ts_init = create_time + 10 min`, past
REST's publication. Its values are the ones REST shows, which Paper and Live read: open interest as
stored, the position ratio half-up to 4 decimals, each account ratio the quotient of its long share
`r / (1 + r)` and short share `1 / (1 + r)`, each half-up to 4 decimals first, the quotient too
(`docs/plans/binance-metrics-rest-parity.zh.md`). A position ratio the archive holds exactly at the midpoint
of the 4th decimal (about 1 row in 100) is rounded either way by REST, and nothing in the archive tells which:
`live compare` accepts the midpoint's half-down rounding there too, and no other difference. Both stamps are whole minutes, so in the bar environment an order the row prompts fills at the close
of the bar that ends there, never at a price older than the decision. The receipt counts the rows
(`counts.metrics`, present only then). The runner streams them as `CustomData(metrics_data_type(<id>),
Metrics(...))` (`engine.strategy.Metrics`; subscribing and reading as for trades, above). Unlike `--trade-ticks`, `--metrics` is also passed to the runner, which then
refuses `METRICS_MISSING` for a month of an active contract's trading window without exported metrics; an
image older than the option refuses it as `UNKNOWN_OPTION` at the probe. It stays out of the effective
configuration: the exported metrics files already carry it into the input identity. A subscription to metrics
the run does not stream is `METRICS_NOT_SERVED`. Paper and Live serve the metrics of every contract of the run
(`engine.metrics.Feed`): from 60 s before each row's `ts_init` they read REST's row of its `ts_event` (no
credential), keep it, and hand it to `on_data` with the replay's stamps and values on the Feed's first one-second tick
at or after `ts_init`, never before; what is not yet published is read again every 30 s, at `ts_init` and after it
until the next row is due, then a missing ratio is `None` and a row without open interest is skipped. After an unsubscribe
no row reaches `on_data`, not even one read already. Each run records what its source was handed, whether or not
it defines `on_data`: Live in its [evidence pack](../live/README.md#evidence-pack), Paper in `events.jsonl` as it hands the row over, before
holding the callback (`metrics`: `instrument_id`, `ts_event` and the four values, a missing ratio null), with each
unsubscribe from metrics the source followed (`metrics_unsubscribed`: `instrument_id`). `paper compare` and `live
compare` check these rows the same way against the archive's. Paper's Feed hands a row over on a timer, not a data
dispatch, so the row only joins the held data callbacks and releases none: they run with it, in the order they
came, at the next data dispatch (a MARK update arrives every second), after the fills their bars caused. Live holds
no data callback, so its `on_data` runs as the row is handed over.

The effective configuration (`--describe`) holds `runtime_contract`, `execution_bar_minutes`,
`market_root`, `market_day`, `universe_path`, `universe_sha256` (the membership file's bytes),
`symbols`, `start`, `trade_start`, `end` and `account`; its digest leaves out the two host paths, so
the registration's probe and the replay compare the same digest. A runner refusal starts with a
code of `config.REFUSALS`.

## Native strategy allocation

The runner allocates every source: replay, Paper and Live call `Strategy.__new__` with
`engine.strategy.source_config`, which holds the run's strategy ID, HEDGING (a position per entry order), UUID order
IDs, no native stop, GTD or
contingent-order management (the venue expires GTD orders, the runner ends the run, and the order rules below refuse
contingent orders) and a market exit that only reduces. The source's `__init__(self, instrument_id, bar_type, **kwargs)` calls `super().__init__()`. A source that
defines `__new__` or names `StrategyConfig` is `SOURCE_REACH`; one whose configuration differs after construction is
`SOURCE_CONFIG`; one whose classes define `on_stop` is `ON_STOP_DEFINED`.

## Subscriptions, orders and stop coverage

Replay, Paper and Live wrap the source in the same three rules (`docs/plans/r1-runtime-contract-20261110.zh.md`).
A breach is not carried out: a replay refuses once the current chunk ends and Paper stops at its next tick, both with
the breach's code; Live refuses at once and takes the STOP path.

- Subscriptions (`engine.strategy.Subscriptions`): one-minute `LAST-EXTERNAL` bars and their
  `LAST-INTERNAL@1-MINUTE-EXTERNAL` aggregations to a period the source's `WARMUP` declares, MARK, funding, instrument status and close, and the custom trades and metrics a replay streams.
  Quotes, books, index prices, option data and other bar types are `SUBSCRIPTION_OUTSIDE_CONTRACT`; native trades
  and unstreamed custom data keep `TRADES_NOT_SERVED` and `METRICS_NOT_SERVED`. Paper and Live stream no trades and
  read metrics from REST. Paper and Live give the source one MARK a minute and one funding update per settlement
  (`engine.cadence`), as many as a replay gives, but not the same MARK: a replay's is the minute's closing MARK,
  stamped 1 ms before the minute ends (`market.export.write_marks`); Paper's and Live's is the first live update
  of the new minute.
- Orders (`engine.order_rules`, code `ORDER_RULE`): positions are HEDGING, so each entry order opens its own position
  and a strategy may hold long and short positions and entries on one contract together (user, 2026-11-11; the
  simulated venue is HEDGING too, since on a NETTING venue a reduce-only exit of a virtual short is canceled while the
  net is long). An entry is a base-quantity LIMIT or STOP_MARKET order (a market entry is a marketable limit); the
  strategy's open positions on the contract at their average open price and its open entries at their limit or
  trigger price, both sides added, with the new entry stay within 3 times the native portfolio's USDT equity;
  an exit is reduce-only, names its strategy's open position and fits it, and one position's working stops hold at
  most its quantity; no modifications, order lists, emulation,
  execution algorithms, contingent or linked orders, quote quantities or order parameters; every order is one
  Nautilus's Binance client sends (no TRAILING_STOP_LIMIT or MARKET_TO_LIMIT; time in force GTC, IOC, FOK or GTD;
  trailing offsets in basis points) and triggers on the default price (replay and Paper match any other trigger
  on the bar's price, Binance on its own); a GTD order is a LIMIT, STOP_LIMIT or LIMIT_IF_TOUCHED order (the types
  the client sends GTD), not post-only, expires on a whole second (the client denies a fraction of one) and at
  least 605 seconds after the strategy submits it, by the strategy's clock (Binance's 600 seconds plus the margin
  Live leaves for an entry's account check, see [Live execution](../live/README.md#live-execution)); a strategy cancels and closes only its own orders and
  positions; every order is on the strategy instance's own contract. A source naming `submit_order_list`,
  `bracket`, `add_exec_algorithm` or `close_all_positions` is refused at load. The rules, Paper and Live sit before
  the source, so an order command (`submit_order`, `modify_order(s)`, `cancel_order(s)`, `cancel_all_orders`,
  `close_position`, `market_exit`) reached through `super()` or a strategy class would reach the venue past them:
  a source using `super()` other than to read another attribute at once, or a strategy class (native `Strategy`
  or a source class extending it) other than as a base, class check, `super()` argument, comparison, annotation or reader of
  another attribute, is refused at load (`ORDER_RULE`).
- Stop coverage (`engine.protection`): a position is covered when its own reduce-only stops (submitted with its
  position ID) on the closing side that are ACCEPTED (neither triggered nor filled) hold its quantity in unfilled
  quantity. Native order events do not name a resting stop's position, so the replay audit sums positions and stops
  per strategy, contract and side; with one position's stops held within its quantity, that is the same judgment. A gap longer than one
  minute of event time fails a replay's audit, is journalled once as Paper's `protection_gap`, and stops Live after
  30 more seconds for its open-order check.

## Streaming and memory

`BacktestNode` with one data configuration per contract and type keeps memory that grows with the window: without
a chunk size rc7 loads every configuration whole and sorts them, and with one (its streaming path) it reads each
configuration in pages and merges the pages, which still grows with the window (on one-minute bars, 40 contracts
took 2.8 GiB for three months and 5.3 GiB for six, about 0.26 GiB per million events). The runner therefore drives the pinned
`BacktestEngine` itself. Bars and MARK updates (and quotes and trades) come from the exported Catalogs through
`ParquetDataCatalog.query`, one query per data type and UTC day, merged by `ts_init`. The runner passes the files
that hold rows of that day (found from each file's row group statistics), but rc7's default
`optimize_file_loading=True` turns the listed files into their parent directories, so the day's `start` and `end` limit
the rows, not the file list; funding and lifecycle events are read whole. Events of one
`ts_init` keep the node's order (contract by contract: MARK, quotes, trades, metrics, funding, bars, status,
close; one millisecond's trades in aggregate trade ID order, after its quotes, so a market order a trade
prompts fills at the quote that millisecond ends with) and the engine gets the node's chunks (50,000
events, extended to the last event's `ts_init`). On the same inputs this gives the node's reports,
event history, exposures and fingerprint; the runner adds each instrument once where the node added
it once per configuration, which renumbers the venue order and trade IDs only. Six months of 23
contracts on one-minute bars peak at 0.7 GiB (0.9 GiB with the earlier seven-day reader). The
capital observer writes exposure rows as it values them and prints one JSON progress line to
standard error every minute of wall time (simulation time, MARK updates, valued timestamps, RSS).

## Explore a source

```bash
uv sync --frozen
STRATEGY_WORKDIR=$(mktemp -d /tmp/trade-draft.XXXXXX)
uv run --frozen python -m cli.main candidate export --candidate STRATEGY-ID@N \
  --output "$STRATEGY_WORKDIR/strategy.py"
uv run --frozen python -m cli.main replay explore --line LINE \
  --strategy-file "$STRATEGY_WORKDIR/strategy.py" --strategy-class ENTRY-CLASS \
  --output "$STRATEGY_WORKDIR/pool" -- \
  --universe pool \
  --start 2021-03-01T00:00:00Z --trade-start 2021-10-01T00:00:00Z \
  --end 2024-10-01T00:00:00Z
```

A draft file needs no export. The trading window (`--trade-start` to `--end`) lies inside the open line's
development period, here 2021-10-01 to 2024-10-01; the warm-up before it may start earlier. Exploration
hashes the file it runs; a sealed run binds the source
to the ledger's revision, its commit and exact source hash. `replay_diagnostics`
supplies source counters and `replay_integrity_findings` source failure findings; any finding or
denied/rejected order fails the run.

## Runtime image

The [`runtime-image`](../.github/workflows/runtime-image.yml) workflow builds two images on separate native arm64
and amd64 runners for `linux/arm64` and `linux/amd64`, and pushes both to `ghcr.io/qoeop/trade-runtime`, labelled with
the commit each was built from (`org.opencontainers.image.revision`). Neither holds strategy bodies, Dolt
configuration or research records, and neither is built on a workstation; there is no local registry or hand-written
runtime identity. Both pin `PYTHONHASHSEED=0`, so string hashing, and with it the iteration order of a set of
strings, is the same in every process that runs a replay.

- **Replay image** ([`runtime/replay.Dockerfile`](runtime/replay.Dockerfile)): Python, Nautilus, the locked
  dependencies and only the replay closure, the import closure of `engine.run`, `engine.audit` and `engine.compare`
  (`RUNTIME_SOURCE_PATHS` and `AUDIT_PATH` in `config.py`). Research identifies a run by this image's digest, so a
  main build runs only when a replay input (a closure file, `pyproject.toml`, `uv.lock`, the Dockerfile or the
  workflow) differs from the commit the current `main` image was built from. A Paper, Live or tooling change leaves
  `main` on its digest, and earlier runs stay comparable. CI scripts and tool configuration are not replay inputs:
  ruff and mypy read `ruff.toml` and `mypy.ini`, and `pyproject.toml` holds only the project and its dependencies.
  `dependency_lock_sha256` (`config.py` `runtime_lock`) hashes only what `uv sync --no-dev` installs from `uv.lock`:
  the packages the project's runtime dependencies reach, without the project's own version. A ruff, mypy or type-stub
  pin, or a release (which bumps only the project's own version, in `pyproject.toml` and in `uv.lock`'s editable
  package), therefore rebuilds nothing and keeps every replay identity. Tags: `main`, `pr-N`,
  `sha-COMMIT`.
  `tests/runtime/test_replay_closure.py` keeps the closure, both source lists, the Dockerfile's copies and the
  workflow's replay paths equal.
- **Execution image** ([`runtime/Dockerfile`](runtime/Dockerfile)) for Paper and Live: the replay image's steps
  unchanged, then the pinned Redis and the rest of `engine/`. It is built whenever an `engine/` file or another image
  input changes, or the tests its check runs (`tests/engine/`, `tests/live_loopback/`). Tags: `exec-main`,
  `exec-pr-N`, `exec-sha-COMMIT`. Its tested digest is the release's runtime
  (`TRADE_RUNTIME_IMAGE`, deploy/README.md), and `paper start` and `paper serve` default to `exec-main`;
  Live runs the release's digest, which each run freezes when it is prepared.

Each image's shared tags are published after both native checks pass and the reports of their protected-entry replay
(`tests.engine.test_fill_model.audited_replay`: a market entry with its reduce-only stop, written and audited by the
product) compare across the two CPUs. Per-platform tags append `-arm64` or `-amd64`. The replay image's check proves
it holds only its closure and that replay passes its audit; the execution image's also exercises the pinned Redis
snapshot/reload, the engine tests and the Live loopback tests that start a run again on its Redis
(`tests.live_loopback.harness.needs_redis`).
They do not replace the paired CLI acceptance below, including nonzero funding and the intended strategy and market
inputs.

A replay command without `--runtime` pulls `main` and records the manifest digest it resolved;
`--runtime` takes another CI tag or digest reference. The identity (`image_ref` with its
`@sha256:` digest, `image_digest`, `platform`, `runtime_contract`, `build_revision`) is read from the
image (`runtime.image.resolve`), and
`python -m engine.run --describe` inside it reports its code hashes and the resolved
configuration. Replay and audit run with no network, a read-only root, read-only source and input
mounts and one writable report mount. A freeze or confirmation accepts only a run on an image
whose revision is on origin/main and whose observed code equals that commit's bytes.

The v8 source proof covers every file of the replay closure. For main-build validation, the required
map comes from the unique literal `RUNTIME_SOURCE_PATHS` declaration in the trusted Git revision,
read without executing it, and must equal the contract's layout.

The project is an installable package: `uv run --frozen --project REPO python SCRIPT` imports
the product packages (`engine`, `market`, `ledger`, `report` and the rest) from a script anywhere, and the image imports `engine` from any
directory. A Nautilus probe is such a host script; it needs no `PYTHONPATH` and no `docker run`.

## Reports

Besides the native orders, fills, positions, account and returns reports, the runner writes
`order_events.jsonl.gz`, `exposures.csv.gz` and `fill_volumes.csv`.

`fill_volumes.csv` gives every native fill (by event ID) the LAST volume of the one-minute execution bar of its
minute: the fill time floored to the minute is the bar's open, and the bar is stamped at its close. A minute
without a bar has an empty volume. The ledger seals the fills' share of their minute's volume from it
(`capital.participation@1`); a run without the file is not sealed.

`order_events.jsonl.gz` holds the unchanged `to_dict()` of every native event of every cached order,
read after the replay: initialization, submission, acceptance, updates, fills, cancellation and
expiry, which the terminal order rows lack. Orders are grouped by client order ID and keep their own
event order; line order across orders is not the engine's processing order. The gzip header time
is zero, so equal histories give equal bytes; event IDs are fresh UUIDs in every run.

In `exposures.csv.gz`, a row labelled with one-minute bar timestamp T holds a position open after every event
before the next bar timestamp, including fills stamped between bars, valued with the native
`Position.notional_value` and `Position.unrealized_pnl` at T's MARK. An observer values the
positions once the first MARK of the next timestamp shows that point reached, and the runner values
the last timestamp after every component stopped. It adds no timer: in probes a five-minute timer
made a run with many resting orders more than ten times slower. Balances and margins are not
repeated: use the latest account state before the next bar timestamp. A held contract without a
MARK at a bar (a hole in its one-minute data) is valued at its latest MARK while that is at most 60
minutes old (`engine.config.MARK_CARRY_MAX_MINUTES`, an uncalibrated example value); each such hole is one
interval in the summary's `mark_carry` and a limitation. A run fails integrity if a timestamp or an
open position goes unvalued: one `CAPITAL_VALUATION_GAP` finding per unvalued interval.

During its warm-up a source receives its history and sends no order (`ORDER_RULE`). The
independent auditor checks native `OrderSubmitted` and `OrderEmulated.ts_event` against
`summary.trade_start_by_strategy`, captured from the runner's plan before source construction. Each
submitting strategy instance uses the later of the global trading start and its own input readiness
(listing and declared history included), even when its order targets another contract. A submission
before that instant is `ORDER_BEFORE_TRADE_START` and makes the entire run invalid, including an
unfilled order; exactly at it is allowed by this check. Missing or invalid starts or unplanned
submitters are `TRADE_START_INVALID`; with the input coverage receipt the auditor also checks the
window, exported instance identities and listing floors. It never uses source diagnostics or a
mutable strategy attribute as the start. There is no runner-side order interception or timestamp
repair. Causal input clocks remain a separate source-review obligation. Old summaries lacking this
metadata cannot pass the new audit; old pinned images and sealed verdicts are unchanged. New code
requires a CI-built image digest before research replays can use this boundary.

Outside an instrument's entry membership (including PRE_CLOSE and monthly universe gaps), every
exit and protective order must carry native `reduce_only=True`; an unmarked intended exit also fails.
`load.entry_windows` rebuilds intervals from the trusted coverage receipt with the same
`episode_membership` intersection used by the runner. `audit.entry_findings` checks the actual target
instrument, native submissions/emulation/releases/updates/fills and each old entry's remaining quantity.
A resting entry or partially filled entry must have its remainder ended by native cancellation/expiry
at the cutoff, even if it never fills. Cancellation/expiry at the cutoff is allowed; an entry fill
there still fails. There is no one-bar tolerance, forced exit at pool removal or automatic cancellation;
rejoining the pool restores entry permission. The pinned PRE_CLOSE does not itself reject entry
orders; CLOSE rejects even exits. A GTD requested expiry between matching events can produce its
native OrderExpired only at the next matching event: ensure the native cancellation/expiry is complete
by the cutoff, do not substitute the requested deadline. Violations are
`ENTRY_ORDER_OUTSIDE_MEMBERSHIP`; absent/invalid receipts, scope or native flags are
`ENTRY_SCOPE_INVALID`. No new ledger field or net-position execution model is added. Native settlement
orders already carry `reduce_only=True` and need no name-based exemption from this check.

The auditor checks report identities, links, submission timing, entry membership, stop protection throughout the replay and reported
account economics, the same way for every strategy. It first
reconciles the order event history with the orders and fills reports, then applies each timestamp's
events together and reads, per strategy and instrument, the position and its stop coverage
(`engine.protection`, each order's native status rebuilt from its events: a triggered stop no longer covers). A
position larger than that for longer than one one-minute bar fails the run; `audit.json` lists each
such interval in `uncovered_intervals` with its start, end, quantities, the orders filled into the
position and the stops whose end uncovered it. A source declaring `USES_STOP_LOSS` other than `True` is
refused at load (`STOP_LOSS_REQUIRED`).
Shortfalls lasting at most one minute are neither refused nor listed; passing this audit does not
prove continuous protection. This stop-coverage threshold is separate from the entry cutoff, which
has no one-bar tolerance. Partial-fill quantities already reconcile through native events and
reports; the source restores protection from the actual native position minus working stop coverage.

The auditor (`python -m engine.audit --run REPORTS --output FILE`) exits 0 when the run passes, 1
with findings (the result is written) and 2 without auditing when a report or the event history is
missing or the summary is unreadable. It reads the coverage receipt `input-coverage.json` from the
report directory's parent: the entry-membership audit requires it even without lifecycle events;
missing membership must not become unrestricted permission. With the receipt, `load.lifecycle_events` rebuilds the window's terminations from the
exported episodes and checks them against the native counts (an episode needs the lifecycle bundle unless it is a
derived one, `load.derived_instruments`: the contract's one piece, stopped by one CLOSE status at the close of its last
exported bar or resumed after a halt, or numbered pieces in time order, each but the last so stopped); before each termination without a
settlement price (a CLOSE status with no `InstrumentClose`) every native position of the contract
must be flat and every order filled or ended (`POSITION_OPEN_AT_TERMINATION`,
`ORDER_OPEN_AT_TERMINATION`, one finding per order); an order created at or after any termination is
`LATE_ORDER_EVENT` (the engine's own `EXPIRATION-` orders at a settlement excepted). A settlement price
is the engine's own settlement and reconciles like any fill; a CLOSE status at or before it closes
the market. A contract whose bars stop more than 60 minutes before the window's end and before its
termination (or without one) is `DATA_ENDS_WITHOUT_TERMINATION`; one terminated at or before the window's start
has no bar to check. Every finding starts with a code of
`audit.FINDINGS` followed by its locating detail; the ledger rebuilds the same events with the same
function at ingest.

A strategy constructor, callback, callback registered on the clock (`set_timer`, `set_timer_ns`,
`set_timer_zoned`, `set_time_alert`, `set_time_alert_ns`, `register_default_handler`), `replay_diagnostics` or
`replay_integrity_findings` that raises leaves a structured receipt in `runtime_failures.jsonl` before
the exception goes on; the runner then exits nonzero even when the engine caught the exception and
finished. So does any exception that ends the runner before its verdict, with its stage
(`execution_binding`, `load`, `inputs`, `replay`, `reports`) and, for a refusal, its code. Each line
(`runtime-failure`) is one distinct (exception type, stage, instrument, message) with `count` and
the first `traceback`; message and traceback are clipped, and after 100 distinct records further new
ones are counted in one `receipt_overflow` record, so a callback failing on every bar stays one line.
The file is rewritten when a record is new or its count reaches a power of two, and once more when
the runner ends. Without a failure the file is not written.

The auditor does not prove a source's signal clock, order geometry, staged-exit races or other
source-specific invariants. Native order events prove submission and fill times, but cannot
independently prove when an arbitrary strategy decided; a self-reported decision timestamp is not
an independent audit. Source contracts, native precheck evidence and independent source review
continue to cover causal clocks. Source-specific integrity checks and native probes provide evidence
for their stated properties before those properties are claimed.

The fingerprint stage (`python -m engine.compare`) reads the reports and writes only
`fingerprint.json`: per table (orders, fills, positions, account, returns, order events, exposures,
fill volumes) the row count and a whole-table hash, after renumbering the random event and
snapshot UUIDs by first appearance (trade IDs are derived, and kept) and sorting every table by all its columns; the account,
returns and exposures files also carry their byte hash. The execution capture keeps the hash of the
whole file; the run row keeps the fingerprint itself. A formal replay executes once and seals its
fingerprint after the independent audit; sealing alone does not verify repeatability. Native detail
is regenerated on demand by `replay reproduce`, restoring the sealed execution environment and, for
quotes, both margin rates. A run without a fingerprint is stored invalid (`FINGERPRINT_MISSING`), and a sealed run is
reproduced only when they match. `engine/compare.py` is part of the runtime identity
(`fingerprint_source_sha256`), so a freeze or confirmation checks its bytes against the image's revision.
There is no automatic second execution on the first use of an order mechanism. Repeated execution
under one identity checks repeatability for the scenarios exercised; changes to execution mechanisms
need relevant engineering scenarios, and behavior-preserving changes use the paired acceptance below.
Neither result establishes consistency for untested sources, windows or hosts.

## Paired acceptance

A change that should preserve behavior (strategy refactor, runner, data adaptation, dependency or
Nautilus) is accepted by paired native replays of the same source, inputs, window and account: the reference in
the current main image, the candidate in the pull request's image (a research change to a strategy
follows the `research-round` skill instead). Run a BTC/ETH pilot of each
affected source, then the full instrument set. `replay explore` trades inside an open line's development
period and a temporary ledger has no line, so open one there first: publish the source, precheck it over at
most 7 trading days (`PRECHECK-ARGS`), record a review of that precheck and select the line. `items.json`
holds `api`, `causal`, `activity` and `readiness`, each
`{"status": "passed", "note": "paired-acceptance fixture, not a review"}`; `line select` returns the
development period every trading window here lies in:

```bash
LEDGER=$(uv run --frozen python -m cli.main ledger temp | jq -r .profile)  # never the active ledger
uv run --frozen python -m cli.main candidate publish --ledger "$LEDGER" \
  --file "$STRATEGY_WORKDIR/strategy.py" --strategy-id acceptance --entry-class ENTRY-CLASS \
  --description "paired-acceptance fixture"
uv run --frozen python -m cli.main replay precheck --ledger "$LEDGER" --market-day head \
  --candidate acceptance@1 --runtime ghcr.io/qoeop/trade-runtime:main \
  --output "$STRATEGY_WORKDIR/precheck" -- PRECHECK-ARGS > "$STRATEGY_WORKDIR/precheck.json"
uv run --frozen python -m cli.main source review --ledger "$LEDGER" --candidate acceptance@1 \
  --runtime "$(jq -r .image_ref "$STRATEGY_WORKDIR/precheck.json")" \
  --trial-id "$(jq -r .trial_id "$STRATEGY_WORKDIR/precheck.json")" --verdict passed \
  --items "$STRATEGY_WORKDIR/items.json" --reviewer paired-acceptance
uv run --frozen python -m cli.main line select --ledger "$LEDGER" --start acceptance@1 --slug paired-acceptance
uv run --frozen python -m cli.main replay explore --ledger "$LEDGER" --line paired-acceptance \
  --runtime ghcr.io/qoeop/trade-runtime:main \
  --strategy-file "$STRATEGY_WORKDIR/strategy.py" --strategy-class ENTRY-CLASS \
  --output "$STRATEGY_WORKDIR/reference" -- RUNNER-ARGS
uv run --frozen python -m cli.main replay explore --ledger "$LEDGER" --line paired-acceptance \
  --runtime ghcr.io/qoeop/trade-runtime:pr-N \
  --strategy-file "$STRATEGY_WORKDIR/strategy.py" --strategy-class ENTRY-CLASS \
  --output "$STRATEGY_WORKDIR/candidate" -- RUNNER-ARGS
uv run --frozen python -m engine.compare_reports \
  "$STRATEGY_WORKDIR/reference/reports" "$STRATEGY_WORKDIR/candidate/reports"
uv run --frozen python -m cli.main ledger service stop --ledger "$LEDGER"
```

The comparator pairs orders, fills and positions by content: client order IDs are fresh UUIDs every
run and HEDGING position IDs depend on the runner, so it masks every UUID, leaves out position and
venue order IDs and sorts each table by its remaining columns; the account and returns stay strict.
When the contract changes, the source must accept both constructors, and the reference runs from a
checkout of the reference commit, whose `replay explore` passes that runner its own arguments. Inspect orders, fills, positions, fees, funding
adjustments, account rows, returns and per-coin diagnostics, plus each run's audit. A clean exit is
not parity. Brackets, OTO children and other order lists, whose native handling changed between
Nautilus releases, are refused (`FORBIDDEN_ORDER_APIS` in `engine/load.py` and `engine/order_rules.py`), so no
run reaches them.

## History

`runtime.image` knows only `replay-contract@v8` (`engine.config.RUNTIME_CONTRACT`); no image or seal of an earlier contract is read
or executed.

## Recovery boundaries

A stored run holds the revision's source, resolved configuration, observed runtime identity, input
identity (market, market day, pool rule and contracts) and the hashes and semantic fingerprint
of the native reports, in the research ledger and its `dolt_backup` copy. It does not hold the image or the exported Catalogs: full replay
recovery needs the image (pull its digest from GHCR) and the market day, which a new export
turns into the same Catalogs. Historical local custody addresses are not product dependency paths.

Upgrading Nautilus starts with the paired acceptance above. The exported Catalogs follow the pinned
Catalog format (decimal128 prices and sizes, UTC timestamp columns); the pinned release has no Python
writer for funding updates, so the exporter writes those in the Catalog's own layout
(`data/funding_rates/`). `uv.lock` is part of the export cache key, so a new pin never reuses an old
export.
