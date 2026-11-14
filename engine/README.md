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
native `InstrumentStatus` (PRE_CLOSE, CLOSE) and `InstrumentClose` events. The runner checks that
the engine consumed exactly the exported counts. There is no second matching or account engine.

A source declares `WARMUP = {period: bars}` (`warmup.py`), keyed by Binance kline period (1, 3, 5, 15, 30
minutes; 1, 2, 4, 6, 8, 12 hours; 1 day). The keys are also the periods it may aggregate to; a period it only
aggregates to has 0 bars. An instance's start T is the later of `--trade-start` and its contract's listing or,
while a declared history does not hold yet, the first whole minute at which it does. At T the runner requests,
for each period P with n > 0 bars, `{id}-{P}-LAST-EXTERNAL` over [floor(T, P) - n P, floor(T, P) - 1 ms]. The
source's `on_historical_bars` receives the n adjacent bars once per period, each stamped 1 ms before its bucket
ends, and then its `on_start` runs. It sees no data stamped before T, and until `on_start` its orders are
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
Klines that miss or are not adjacent are `WARMUP_INSUFFICIENT` or `WARMUP_NOT_ADJACENT`, and a fetch or
delivery not done by T + 45 s is `WARMUP_TIMEOUT`; no order can go out before the warm-up ends. Paper
refuses the run and Live stops it. A live aggregation closes on a timer, but the bucket's last Binance minute
arrives after the bucket's end (up to 0.47 s in 84 minutes of trials), so Paper and Live build it 5 s later
(`history.BUILD_DELAY_US`); rc7 then stamps it at the bucket's end plus 5 s, not at the end as a replay does.

Paper and Live also check the contract's terms against the market's (`engine.config.TERMS_COMPARED`: tick size,
step size, minimum notional): Paper at start against the terms `paper start` wrote from the run's market day,
Live at each entry's admission against the terms `prepare` read from the market's latest day. A difference is
`TERMS_CHANGED`, with both values. Paper's Sandbox cannot take the replay's margin rates (rc7's Python cache cannot
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
(maintenance = notional x the rate, not divided by leverage), and the instruments carry the two rates.
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
<id>}), tick)`: a strategy subscribes with `subscribe_data` on that data type and gets the tick as
`data.data` in `on_data`. The venue never sees custom data, so trades match no order and move no book; a
native `TradeTick` would overwrite the venue's L1 book whatever `trade_execution` says (probed on
2.0.0rc7: a market order after a trade below the bid filled at the trade's price, not the quoted ask).
A month of the trading window without exported trades is `TRADES_MISSING`. A source subscribing to trades
the run does not stream (no `--trade-ticks`, or native `subscribe_trades`, which is never served) would see
none: the runner stops after the chunk it subscribed in and refuses `TRADES_NOT_SERVED`. Paper trading
streams no trades (its orders match bars, as in the bar environment), so a trade subscription stops a paper
run with the same code.

Open interest and long/short ratios (`market import-metrics`) are signal input in either environment. The
entry's `--metrics` exports every stored row the window shows by the rule `binance-metrics-visible-v1`
(the receipt's `metrics_rule`): a row stamped `create_time` gets `ts_event = create_time + 5 min`, the
instant its open interest describes, and `ts_init = create_time + 10 min`, past the public REST
publication. Both are whole minutes, so in the bar environment an order the row prompts fills at the close
of the bar that ends there, never at a price older than the decision. The receipt counts the rows
(`counts.metrics`, present only then). The runner streams them as `CustomData(metrics_data_type(<id>),
Metrics(...))`: `engine.run.Metrics` holds `instrument_id`, `sum_open_interest` (base asset), the three
ratios `count_toptrader_long_short_ratio`, `sum_toptrader_long_short_ratio` and `count_long_short_ratio`
as exact `Decimal` (`None` where the archive left one empty), `ts_event` and `ts_init`. A strategy
subscribes with `subscribe_data(DataType("Metrics", metadata={"instrument_id": <id>}))` and reads
`data.data` in `on_data`. Unlike `--trade-ticks`, `--metrics` is also passed to the runner, which then
refuses `METRICS_MISSING` for a month of an active contract's trading window without exported metrics; an
image older than the option refuses it as `UNKNOWN_OPTION` at the probe. It stays out of the effective
configuration: the exported metrics files already carry it into the input identity. A subscription to metrics
the run does not stream, and any in paper trading, is `METRICS_NOT_SERVED`.

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
  and unstreamed custom data keep `TRADES_NOT_SERVED` and `METRICS_NOT_SERVED`. Paper and Live stream neither trades
  nor metrics. Paper and Live give the source the first MARK of each minute and one funding update per settlement
  (`engine.cadence`), as a replay does.
- Orders (`engine.order_rules`, code `ORDER_RULE`): positions are HEDGING, so each entry order opens its own position
  and a strategy may hold long and short positions and entries on one contract together (user, 2026-11-11; the
  simulated venue is HEDGING too, since on a NETTING venue a reduce-only exit of a virtual short is canceled while the
  net is long). An entry is a base-quantity LIMIT or STOP_MARKET order (a market entry is a marketable limit); the
  strategy's open positions on the contract at their average open price and its open entries at their limit or
  trigger price, both sides added, with the new entry stay within 3 times the native portfolio's USDT equity;
  an exit is reduce-only, names its strategy's open position and fits it, and one position's working stops hold at
  most its quantity; no modifications, order lists, emulation,
  execution algorithms, contingent or linked orders, quote quantities or order parameters; a GTD order expires at
  least 600 seconds after it is sent (Binance's limit); a strategy cancels and closes only its own orders and
  positions; every order is on the strategy instance's own contract. A source naming `submit_order_list`,
  `bracket`, `add_exec_algorithm` or `close_all_positions` is refused at load.
- Stop coverage (`engine.protection`): a position is covered when its own reduce-only stops (submitted with its
  position ID) on the closing side that are ACCEPTED (neither triggered nor filled) hold its quantity in unfilled
  quantity. Native order events do not name a resting stop's position, so the replay audit sums positions and stops
  per strategy, contract and side; with one position's stops held within its quantity, that is the same judgment. A gap longer than one
  minute of event time fails a replay's audit, is journalled once as Paper's `protection_gap`, and stops Live after
  30 more seconds for its open-order check.

## Streaming and memory

`BacktestNode` with one data configuration per contract and type loads every configuration whole
and merge-sorts them before it streams to its engine, so its memory grows with the window: on
one-minute bars, 40 contracts took 2.8 GiB for three months and 5.3 GiB for six, about 0.26 GiB per
million events. The runner therefore drives the pinned `BacktestEngine` itself. Bars and MARK
updates (and quotes and trades) come from the exported Catalogs through `ParquetDataCatalog.query`, one
query per data type and UTC day over only the files that hold rows of that day (found from each file's
row group statistics), merged by `ts_init`; funding and lifecycle events are read whole. Events of one
`ts_init` keep the node's order (contract by contract: MARK, quotes, trades, funding, bars, status,
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
uv run --frozen python -m cli.main replay explore \
  --strategy-file "$STRATEGY_WORKDIR/strategy.py" --strategy-class ENTRY-CLASS \
  --output "$STRATEGY_WORKDIR/pool" -- \
  --universe pool \
  --start 2020-02-01T00:00:00Z --trade-start 2020-09-01T00:00:00Z \
  --end 2026-10-01T00:00:00Z
```

A draft file needs no export. Exploration hashes the file it runs; a sealed run binds the source
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
  `uv.lock` also pins the dev group, so a ruff or mypy version change still rebuilds it. Tags: `main`, `pr-N`,
  `sha-COMMIT`.
  `tests/runtime/test_replay_closure.py` keeps the closure, both source lists, the Dockerfile's copies and the
  workflow's replay paths equal.
- **Execution image** ([`runtime/Dockerfile`](runtime/Dockerfile)) for Paper and Live: the replay image's steps
  unchanged, then the pinned Redis and the rest of `engine/`. It is built whenever an `engine/` file or another image
  input changes. Tags: `exec-main`, `exec-pr-N`, `exec-sha-COMMIT`. Its tested digest is the release's runtime
  (`TRADE_RUNTIME_IMAGE`, deploy/README.md), and `paper start` and `paper serve` default to `exec-main`;
  Live runs the release's digest, which each run freezes when it is prepared.

Each image's shared tags are published after both native checks pass and the reports of their protected-entry replay
(`tests.engine.test_fill_model.audited_replay`: a market entry with its reduce-only stop, written and audited by the
product) compare across the two CPUs. Per-platform tags append `-arm64` or `-amd64`. The replay image's check proves
it holds only its closure and that replay passes its audit; the execution image's also exercises the pinned Redis
snapshot/reload and the engine tests.
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
read without executing it, and must equal the contract's layout or a map its earlier images report
(`runtime.image.EARLIER_SOURCE_PATHS`): until 2026-11-13 the v8 replay image also held `engine/live_errors.py`,
which the Live modules alone import, so those images and their runs still reproduce.

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
the last timestamp after every component stopped. It adds no timer: in rc3 probes a five-minute
timer made a run with many resting orders more than ten times slower. Balances and margins are not
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
exported episodes and checks them against the native counts; before each termination without a
settlement price (a CLOSE status with no `InstrumentClose`) every native position of the contract
must be flat and every order filled or ended (`POSITION_OPEN_AT_TERMINATION`,
`ORDER_OPEN_AT_TERMINATION`, one finding per order); an order created at or after any termination is
`LATE_ORDER_EVENT` (the engine's own `EXPIRATION-` orders at a settlement excepted). A settlement price
is the engine's own settlement and reconciles like any fill; a CLOSE status at or before it closes
the market. A contract whose bars stop more than 60 minutes before the window's end and before its
termination (or without one) is `DATA_ENDS_WITHOUT_TERMINATION`. Every finding starts with a code of
`audit.FINDINGS` followed by its locating detail; the ledger rebuilds the same events with the same
function at ingest.

A strategy constructor, callback, callback registered on the clock (`set_timer`, `set_timer_ns`,
`set_time_alert`, `set_time_alert_ns`, `register_default_handler`), `replay_diagnostics` or
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
affected source, then the full instrument set:

```bash
LEDGER=$(uv run --frozen python -m cli.main ledger temp | jq -r .profile)  # never the active ledger
uv run --frozen python -m cli.main replay explore --ledger "$LEDGER" --runtime ghcr.io/qoeop/trade-runtime:main \
  --strategy-file "$STRATEGY_WORKDIR/strategy.py" --strategy-class ENTRY-CLASS \
  --output "$STRATEGY_WORKDIR/reference" -- RUNNER-ARGS
uv run --frozen python -m cli.main replay explore --ledger "$LEDGER" --runtime ghcr.io/qoeop/trade-runtime:pr-N \
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
not parity. Before 2.0.0rc7, Nautilus rejected a bracket's target when the entry's fill bar reached its
stop and canceled a partially filled entry's stop and target when the entry ended, and before
2.0.0rc5 an OTO child kept a quantity smaller than its entry's fill (rc7 resizes it to the fill);
the product refuses those order shapes (`FORBIDDEN_ORDER_APIS` in `engine/load.py` and
`engine/order_rules.py` refuse brackets, OTO children and other order lists), so no run reaches them.
Across rc3 and rc7 the comparator also reports two representation changes that carry no economics:
the orders report writes an absent contingency or emulation trigger as empty (rc3:
`NO_CONTINGENCY`, `NO_TRIGGER`), and the account report no longer repeats each funding
settlement's state as a second `reported=False` row.

## Paper trading

`python -m engine.paper` runs one complete strategy source, constructed as a replay constructs it, in a
Nautilus `LiveNode` on live Binance USD-M public data (no key) with the Sandbox's simulated fills: the
user's authorization of 2026-10-25 covers exactly this, and nothing else live
(`docs/plans/paper-trading-design.zh.md`). It refuses to start while any exchange credential variable is
in its environment, so start it with an allowlisted one:

```bash
env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" uv run --frozen python -m engine.paper \
  --strategy-file S.py --strategy-class C --strategy-sha256 H --symbols BTCUSDT \
  --universe membership.json --maker-fee 0.0002 --taker-fee 0.0005 --output /tmp/paper-run
```

The Sandbox takes the replay's account, fill model, book type and bar ordering, and the given maker and
taker rates (the market's assumption, which a replay reads from its export receipts). The strategy sees
the replay's cadence: the first MARK update of each minute and one funding update per settlement. The
Sandbox settles no funding; `events.jsonl` records each settlement with the positions it applies to.
`STOP` in the output directory, SIGTERM, SIGINT or `--duration-seconds` cancels the working orders,
waits for the cancels and stops the node; positions stay open and are valued at their latest MARK in
`summary.json`.

`python -m cli.main paper start|resume|stop|seal|list` runs it as the product does
(`paper/runs.py`): the candidate's source is copied from the research ledger into the separate Paper database
(`ledger/paper.sql`) and the run declared there (`paper_run`), then the runner container starts on a
Docker network of its own with no route out, beside an egress proxy (`python -m engine.egress`) that is the
only container also on the outbound bridge and tunnels to `fapi.binance.com` and `fstream.binance.com` on
443 alone. Docker gets an allowlisted environment and passes no host variable into either container.
`paper stop` writes the run's `STOP` file and seals; SIGTERM comes only after a timeout, since on SIGTERM
the node also shuts down by itself and the strategy misses its cancels. `paper seal` captures a run that
ended by itself. The seal stores the run's files (`paper_file`): the journal by UTC day, the summary, the
egress and runner logs and `seal.json`, whose readings add the funding the Sandbox does not settle
(`docs/plans/paper-run-storage-decision.zh.md`). Runs are admitted by memory, not by count (`TRADE_PAPER_MEMORY`,
`docs/plans/paper-admission-by-memory.zh.md`), one per source at a time.

Paper recovery keeps the same unsealed run, pinned image and inputs. Each runner owns a loopback-only
native Redis cache; immutable RDB originals and their exact journal cuts are retained. The daemon invokes
`paper resume`, never a replacement `paper start`, after an interruption. Missing/dirty checkpoints,
changed inputs, unhandled journal tails, unsupported strategy state or a missing original container refuse
recovery and retain the account records. Explicit STOP/duration still seals. The original per-source limit
is three actual recovery launches per hour, including failures before the runtime can journal.

`PAPER_RECOVERY = 1` is an explicit source protocol: reviewed `on_save/on_load` hooks own all private state;
`on_start` re-establishes the minute subscription and the aggregations `WARMUP` declares, without custom
routing or dynamic changes. User timers and nonterminal orders are outside this protocol. A source must
not rely on native account event-count/history representation or unsaved cache history. A recovery warms the
source again at its own T as a start does (history, then the unfinished buckets from their minutes), then
calls `on_load` with the saved state and then `on_start`. It resumes only within the same bucket of every
declared aggregation and before an unobserved funding settlement. No downtime trades or settlements are
invented. Native Redis readback checks orders, positions, balances, margins and account events before the
atomic cut is published.

A seal stores the exact journal bytes as `events/native.jsonl.gz`, including any interrupted final line, plus
current and actually-used recovery originals. Verification hashes the decompressed byte prefix; parsed UI
events are not recovery originals. Details, storage review and bounded native evidence are in
`docs/plans/paper-native-recovery.zh.md`.

## Live execution

`python -m engine.live` is a separate, credential-bearing Binance USD-M entry point. It does not use
the Paper Sandbox account, delayed callbacks, fee model, funding adjustments or checkpoint protocol.
A run is prepared, started and reconciled only from the Live page, through the paired control
([Live on this host](../deploy/remote/README.md#live-on-this-host)), with a credential saved there. It uses a private
execution directory and never writes an execution into the research ledger or Paper database. Every effect requires
the release's own control snapshot and current release authority. All installed keys share one durable run/reconcile
slot.
Missing installation metadata does not enable standalone execution. `python -m cli.main live status|logs|stop` takes
the canonical `--root` and a run ID: `status` and `logs` only observe, `stop` only requests STOP; the paired
controller performs host cleanup. Native account/order/position ownership is unchanged.

As for Paper, the Live page chooses the run: the candidate is the version selected in the research graph, and the
contracts (default: its last research replay's) and leverage are typed there. Preparation reads the candidate at the
research ledger's head, which becomes the run's `research_at`; a candidate absent there or whose source does not load
is refused (`LIVE_SOURCE_MISSING`). The contracts' membership comes from the market directory (`LIVE_UNIVERSE` when it
cannot), written once to `universes/<sha256>.json` under the Live root and frozen by hash in the request.
`preflight` captures immutable source inputs from the research reader at that commit, pins a main-CI
runtime digest, queries the account and applies the account and source checks `start` will repeat, so `status`
says `preflight_failed` and `logs` gives the refusal before any account slot is taken. Live runs only the
candidate's own source, read from the ledger at that commit; there is no adapted file, and a source hash that is no
longer the prepared one is refused (`LIVE_IDENTITY_CHANGED`). The result shows the candidate and its
out-of-sample registrations at that commit. They inform the operator and no validation is required.
Preparation also needs replay evidence at research_at: a passed sealed run, or a completed `replay explore` whose
audit passed and whose trading window lies inside a research trial's window of the same source (a window it already
saw, so no new exposure and no holdout spent), of that exact source on exactly the run's symbols in `bars`, on a
replay image whose `--describe`
reports the execution image's `source_files_sha256`, `audit_source_sha256` and `dependency_lock_sha256` (the same
replay code). A sealed run on other replay code counts through an explore that reproduces it on matching code
(`replay reproduce`). Without one it refuses `LIVE_EVIDENCE_MISSING`; the manifest lists each (`evidence`) and the
review shows them. In `preflight` and `run` the runner then needs one that started within 10% of the USDT wallet it
observes, or refuses `LIVE_EVIDENCE_BALANCE`. To back a run, replay the candidate at the wallet: `candidate export`,
then `replay explore` of that file with `--starting-balance` the wallet and the run's `--symbols`, inside the
window of one of its research trials.
`start` takes the prepared run ID, the same saved credential version and the run's `source_sha256` as the
confirmation, then repeats
account admission. A run trades each of its contracts with its own instance of the source, as a replay does: each
instance has its own strategy ID (`LIVE-<run>-<coin>`) and orders only on its own contract (`ORDER_RULE`, as in replay and Paper),
and instances coordinate legs through state the source shares between them (decision
`docs/plans/cross-line-fusion-20261111.zh.md` §5–§7). Admission requires a flat account, Hedge/Multi-assets mode, and
on every contract CROSS margin, the declared leverage, no automatic margin addition and Binance status `TRADING`. The
venue's leverage is observed, never changed or copied into a simulated account. A complete v2 account response must show finite nonnegative wallets
and eligible USDT wallet cash and available balance each covering the cash floor (85% of the USDT wallet, at most 100 USDT).
Other collateral is not converted into an entry allowance. CROSS does not isolate this budget from
the rest of the account. Credentials are mounted only into the Live runner, not placed in argv or Docker environment.

The execution client uses native `HEDGING` with `use_position_ids=False`; the source runs native `HEDGING`
(virtual positions, one per entry order, on the account's LONG and SHORT sides) with UUID client order IDs. Allocation, initialization and registration must
preserve each instance's assigned strategy identity and those settings. Native managed stop is disabled and
native market exit must use reduce-only orders. The strategy OMS describes local
ownership; it is separate from the account's ability to hold both LONG and SHORT legs.

Order commands remain closed until a fresh account observation after native startup passes admission.
Account reads run in one read-only background task; the existing Observer consumes the result while
native socket and timer events continue. The worker never touches the node, source, order or cache.
Late results after STOP or the 30-second deadline cannot dispatch an entry.

A lost connection closes entries; it does not end the run (`engine/live_connection.py`, design
`docs/plans/live-continuous-operation-design-20261110.zh.md` §3.2). A disconnect before the connected start is
verified still ends the run, since nothing was admitted. After it, any Binance socket that goes down closes the entry
gate: working entries get one native cancel each (REST, so a lost socket does not block it; an entry can still fill
if the cancel is lost or loses the race, and its source protects it as usual). An entry the source submits, or one
still waiting for its account check, passes every other entry check and is held unsent (`entry_held`; not in the
native cache, so nothing counts, cancels or fills it). When the gate reopens it takes its account check as any entry
and is sent once, unchanged (`entry_released`), if that happens within 60 seconds of its decision (for GTD, early
enough that it leaves with at least 605 seconds before it expires; every GTD entry is sent with that much left) and
before the source receives another bar of the type it decided on. Otherwise the run ends with
`LIVE_CONNECTION_UNVERIFIED` before that bar reaches the source (`entry_refused`, detail `entry_hold_expired` or
`entry_hold_bar`): the source cannot see a product refusal, and the pinned Python `Strategy` has no native
`deny_order`. A gate closed for a reason no check clears (below) refuses entries at once, held ones included, except a
missing bar or a contract not trading. After a missing bar alone, an entry staged when it closed, and a new one that
passes every entry check while the run holds a position, are denied natively and the run goes on (`entry_denied`).
When a comparison, or an entry's own account read, finds a contract's Binance status other than `TRADING`, entries on
that contract alone close (`contract_status`, with its `symbol`): its staged and held entries and every new one on it
that passes the entry checks are denied natively, flat or not, and the run goes on; working entries and positions with
their exchange stops stay, and the other contracts trade on. Its status is then read every minute; back at `TRADING`,
the run's entries reopen after the same two agreeing comparisons as after a reconnect. A start again (to warm up, or
on a new image) waits while a contract is not trading. The run node registers an
`ExecutionAlgorithm` (`LIVE-GATE`) whose `deny_order` puts the source's order in the native cache as DENIED and gives
the source `OrderDenied`; nothing is sent. Its denials, read back from the journal in later starts whose reloaded cache
still holds them, are no native failure. An order the cache already holds, an entry submitted from within a denial's
callbacks, or a denial that fails is refused, and the run ends. `live compare` attributes a fill the gate delayed, withdrew or denied, and a
decision Live refused after a hold, to the cause `entry_gate` (decisions `docs/plans/live-entry-hold-20261113.zh.md`,
`docs/plans/live-bars-missing-rewarm-20261113.zh.md`).
Reductions, cancels and closes from the source and the Observer go on (REST); exchange stops stay at Binance.
When every socket is back, entries reopen only after two comparisons of a REST read with the native cache, at least 30
seconds apart (one native position and open-order reconciliation cycle), both agree, contract by contract, on its
instance's positions per side and open orders by venue ID, on the account modes, nothing on a symbol outside the run,
and a live bar received since the reconnect. A disagreement restarts the check. Orders at Binance the cache does not
know are canceled with every order on their contract (native cancel-all, regular and conditional), and entries then
stay closed for the run, as they do after changed account modes. A missing external bar on any contract (Binance's
stream does not resend a close it missed) is not patched: entries on every contract close and working ones are
withdrawn; a position keeps its instance and exits. Once no instance holds a position, order or held entry, no
instance sees a further bar, and after two agreeing comparisons this start ends
without closing anything (`rewarming`, exit status 3). The control starts the run again, whose warm-up reads Binance's
complete bars (decision `docs/plans/live-bars-missing-rewarm-20261113.zh.md`). If that warm-up fails, the start ends the
same way once more (`rewarming` with `retry`; it counts toward the control's three starts an hour); a second failure ends
the run. Flat with only reduce-only orders left at Binance, the run waits with entries closed and cancels nothing. Once
agreeing comparisons (every five minutes) have seen them at Binance for ten minutes, the user is told
(`orphan_orders`): 10 to 20 minutes after the account went flat. The comparison also
runs every five minutes while entries are open; two disagreeing reads in a row close them.
While nothing is open, a connection older than 23 hours is renewed natively (`reconnect_socket`) between seconds 20 and
40 of a minute, moving Binance's 24-hour cut away from positions and the bar boundary. With a position open, the
existing 60-second rule for a missing mark price still stops the run. A socket down for a minute, a check not passed
in ten minutes, entries closed for the run, for a missing bar or for a contract not trading, a start again to warm up
(and its one retry),
reduce-only orders left after a missing bar, and the reopening after such a notice are Telegram notices. No custom
reconciliation engine or second trading client is used.

A run never ends by itself, so its native cache must not grow without bound (design §3.9). Redis rewrites its AOF once
it has doubled past 64 MB, dropping the expired health probes and replaced values; Nautilus's own lists (orders,
positions, account states) stay whole, since every start reloads them and its reports read the whole run. The
Observer refreshes the native account every 60 seconds, and each entry's own account read refreshes it too: Nautilus's
risk engine checks an entry's margin against the native free balance, which a canceled or expired order leaves reduced
until a REST refresh (Binance's stream sends no account update for it). rc7 appends each state, about 0.85 KB, to a
Redis list it never trims and reads whole at each start: about 0.45 GB a year, against 2.6 GB at the earlier 10
seconds. In memory, Nautilus purges account states older than a day each hour, starting an hour after the start, so a
start still loads the whole list first.

An Observer failure sends the same one cancel per working entry and ends the run unresolved. A source that leaves
the running state by itself (`stop`, `fault`, `degrade`) enters the normal STOP path, marked failed.

Orders follow the shared order rules above; Binance Futures in the pinned release refuses linked OCO/OTO order
lists, which the rules exclude everywhere. Live adds custody on top: the account is flat when the run starts; each
entry then waits, in order, for its own fresh account check (cash of at least the budget, the 3-times exposure limit
against that check's equity) before dispatch, and may join the run's open positions and orders. The drawdown brake counts the whole run.
A GTD order goes to Binance with its expiry, which Binance
[keeps to the second](https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/New-Order)
and refuses when less than 600 seconds ahead; the order can end up to a second early, or late in extreme markets,
and in the 2026-11-06 trial such an end came back `CANCELED`, not `EXPIRED`. An expiry is no precise end time, and
a stop placed GTD stops protecting when it ends.
The Observer temporarily holds only that unsubmitted native order, then checks its expiry, current native
cache, connection, STOP, persistence, native source Running state and cash budget before calling native submit.
The order's strategy/trader identity must match the registered native source, so a foreign OrderFactory
cannot bypass the source's history or recovery identity. It never retries,
fabricates an order event or persists a dispatch queue. An entry rejected before native submission ends
the run. A run may enter any number of times; each entry passes its own admission.
Besides the native portfolio equity of the order rules, Live also measures the 3-times limit
(`engine.order_rules.ENTRY_EQUITY_MULTIPLE`, user 2026-11-09 and 2026-11-10) against the lower of USDT wallet and
available balance in the account observation the entry's own admission read, which may hold the run's own positions
and orders on its contracts (no other symbol's), and checks the status, terms and minimum size of the entry's own
contract. That admission still
requires USDT wallet and available cash of at least the budget, so the budget is a cash floor, not a size limit:
a source sizing from equity at up to 3 times stays admitted however its equity grows. The venue leverage is observed, never set; an entry above the
cash needs it set high enough on the venue. It is not a realized execution amount or loss guarantee, including for a SELL filled higher
than its limit. The native global notional cap is omitted because it also rejects necessary reductions;
all other native risk checks remain enabled. Reductions also require the position to be the instance's own, on
the run's account and the instance's contract. Live does not claim hostile-code isolation for the source.

Before a `preflight` or `start` takes the account, the control's process reads the key's own permissions once from
`api.binance.com`, which the runner's egress deliberately cannot reach: a key that can withdraw is refused
(`LIVE_KEY_WITHDRAWAL`), an unclear answer or failed read is refused (`LIVE_KEY_UNVERIFIED`), and so is a key with
no IP restriction (`LIVE_KEY_IP_UNRESTRICTED`), for every run, timed or not. The runner then bounds its own clock against the venue's time, because native
requests may sign with it while signed reads here carry the venue's time: at most 1000 ms ahead (the venue's limit) and
2500 ms behind (half the 5000 ms `recvWindow`), or `LIVE_CLOCK`. The reading is kept in the private preflight snapshot.

How to write a candidate that
runs in Live: `.agents/skills/research-round/references/strategy-authoring.md`, section Live. On every one-second
observation of a `run`, each open position needs stop coverage (`engine.protection`, the audit's rule), read from
the native cache because Binance Hedge orders carry no `reduceOnly` on the wire. After 90 seconds without cover from when the gap opened (the
audit's one bar plus the native open-order check; fills do not extend it), or when the check itself cannot run, the
run is marked failed and takes the STOP path. A stop the native cache holds but the venue lost is found only by
native reconciliation. A failed flat run keeps the account slot until `reconcile`. If the close is rejected or
fails, it is not retried: the node stops with the position open and possibly no stop on the venue, and `status` says
`unresolved` (see [Unresolved Live runs](#unresolved-live-runs)).

The drawdown brake (`engine/live_brake.py`, design §3.5, user 2026-11-10) replaces the per-run loss limit. Every
15 seconds during a `run` the runner reads the account over REST; equity is the USDT wallet plus its unrealized result,
so fees and funding count. The run's highest equity starts at the equity it armed with and is journalled whenever it
rises (`equity_peak`), so a start again carries it on. Once equity is the brake's share below it (`drawdown_brake`,
the user's 15% maximum-drawdown target, or a tighter share the run was prepared with), the run takes the STOP path
with `stop_reason` `drawdown`, writes the account read beside it, is not a failure, and is not started again. With a
position open and no equity read for 60 seconds the brake cannot be applied: the run stops, failed
(`drawdown_unverified`); so does a position with no mark price of its contract for 60 seconds (`mark_missing`). The cash floor is 85% of
the USDT wallet at the first arming (the first trial admits at most 100 USDT, `LIVE_BUDGET`): each entry still needs
that much USDT wallet and available cash, a last line should the brake fail. The brake does not bound a gap or a
rejected close; a trigger makes one close attempt. Do not transfer or trade by hand during a run.

Each entry's account read and the connection's comparisons also bound the clock (`LIVE_CLOCK`): an entry that passes
every other entry check but the clock is denied natively through the gate (`entry_denied`, `entry_clock_skew`) and the
run goes on, the next entry taking its own read; a read with no usable server time, or no gate to deny with, still
refuses it and ends the run, and so does an entry submitted from within a denial's callbacks. A
comparison that fails the clock closes entries until it agrees. While a run trades the paired control reads its key's
permissions every hour: a failure (withdrawals on, IP restriction gone, unreadable) is journalled once
(`key_check_failed`) and a Telegram notice; the run goes on.

A run has an optional duration (none: it runs until stopped), counted from its first arming. SIGTERM or SIGINT (a
host restart, a release, `docker stop`) interrupts it instead of stopping it (design
`docs/plans/live-continuous-operation-design-20261110.zh.md` §3.4): working entries get their cancels, positions and
their exchange stops stay, and the runner records `interrupted` and exits 3. An armed run whose latest start ended
with no ending event (`clean_stop`, `reconciled_flat`, `venue_flat`, `reconcile_stopped`, `unresolved`) and no
`STOP` file, so also a killed runner, is started again as itself by the paired control, with the credential it was
started with, from the same native cache; at most three run launches an hour, then the control records
`restart_limited` once and the user decides. Every other start of an armed run is refused `LIVE_COLD_RESTART`. A
start again checks the clock and account modes: on a flat account it builds the source, warms up and trades (event
`resuming`); with anything open it holds (`resuming` with `held`): no source, no entries, the account read every 30
seconds, until the account is flat (its stops, or a close at Binance), when `venue_flat_while_held` ends that start
with exit 3 and the next one trades. A source cannot yet rebuild its state around an open position, so a held run
waits for that. STOP during a held start ends it as `reconcile` does. Each step is a Telegram notice.

STOP disables opening decisions, cancels owned opening orders, repeating the cancel every 5 seconds while one
stays open (after a request with an unknown outcome, as a native cancel-all scoped to the order's side, because
native `cancel_order` sends nothing for a PENDING_CANCEL order; withheld while that side holds a reduce-only order
and a position is open, leaving the order unresolved), waits for their final states and closes owned
positions through Nautilus. Protective orders are
retained until flat. A clean stop requires the
completed native state and a fresh exchange observation to agree. Unknown outcomes retain the account
slot and private originals. `reconcile` reopens the same native cache and queries the venue without
constructing the trading source; it registers an inert native Strategy with the original identity
and HEDGING override before cache load, so an entry missing its first fill retains its original OMS.
It does not resume arbitrary strategy callbacks or issue trading commands. A verified flat
reconciliation can release custody for a new, explicitly started run. Native reconciliation never matches a close
made at Binance, which has no order this process knows: on a Hedge account the unmatched quantity becomes a separate
EXTERNAL position, and a cancelled stop stays accepted in the cache. So `reconcile` first reads the whole account, and
again when it ends: with no position on any symbol and no open or conditional order, it records `venue_flat` and
releases the slot without a native match. The next run starts from a fresh native identity, so the stale cache is
never reused; this run's native records may lack the close, and the account snapshot in its directory is the record.
A run whose runners are all proven exited without `armed.json` or a `connecting` event never constructed its
source, so it placed no order: the paired controller releases the slot and `status` reports `not_armed`. Its run-id cannot start again; use
a new one. A runner that is still alive, a missing container or an unknown launch keeps the slot.
A manifest's format (`live-run-4`) binds the checks to the runner: an older image refuses it before arming. 0.x
keeps no compatibility between versions: a run an earlier version prepared stays on disk under `runs/`, and no
listing, release check or operation reads it; only its runner container, while still running, keeps the account
(`live/inventory.py`). A run without a credential version is unknown ownership and blocks credential changes
(`LIVE_CREDENTIAL_BUSY`).
An ended run (`clean_stopped`, `reconciled_flat`, `venue_flat`, `not_armed`, or a finished preflight) gives up its containers and
network when the paired controller maintains it or another run starts: their logs go to `containers/` in the run directory,
where `logs` then reads them, and `lifecycle.jsonl` records the result for `status`. An unresolved run, or any runner
that has not exited, keeps everything `reconcile` needs. After a removal `reconcile` is refused; a run that only
preflighted may still `start` and gets a new network and egress.
Reconciliation accepts the retained account modes without requiring positive funds or an empty account.
Native Multi-assets cached balances can differ from reported balances after zero updates or margin
initialization. They are not the authority for entry cash or a claim of full collateral accounting.

### Evidence pack

Each Live run keeps what a replay of its source needs for comparison in `evidence/` of its private output
(`engine/live_evidence.py`), never the ledger:

- `market.jsonl`, in Paper's journal shape: every bar the source received (`bar`; `historical_bar` for one a
  history request delivered). Bars after a stop request reach neither the source nor the file. Quotes, trades,
  MARKs and funding rates are not kept: `live compare` settles funding at Binance's published rates.
- `reports-<ns>/`, written when the node stops in `run` and `reconcile`: `orders.csv`, `fills.csv`,
  `positions.csv`, `account.csv` and `order_events.jsonl.gz` from the native cache, through the same writers a
  replay uses (`engine.write_reports`).
  A reconciliation resumes the run's cache, so its reports cover the whole run; `account.csv` does too for a node that
  ran under an hour, and otherwise holds the last day of account states (the native purge above).

The account, its settings, the wallet and Binance's instrument terms and commission at start are the
`preflight-*.json` and `connected-account-*.json` observations beside it. Recording never changes the run: a failed
write journals `evidence_unavailable` once per part and the run goes on.

### Unresolved Live runs

`status` says `unresolved` when a run ended without proof that the account is flat: a failed check, a
rejected or failed close, a runner that failed, or a `reconcile` stopped before flat. A killed or interrupted
runner is not unresolved: the control starts it again. A position may remain at Binance,
with or without its stop, and nothing will close it. When Telegram notifications are set up on the Live page,
the paired control sends a message within about ten seconds of seeing the run unresolved, but only from its
retained records and with no delivery guarantee: someone must still watch `status` for the whole of a real run and
act at once. `stop_reason` and `live logs` say what happened.

1. If `status` says `running`, stop it (Stop on the Live page, or `live stop`) and wait until it no longer does.
2. At Binance, on the same account, close the position and cancel every open and conditional order, including the
   run's stops. Release needs the whole account flat: any other position or order keeps the slot.
3. Reconcile the account on the Live page (Reconcile account…). On a flat account it ends at once and `status` says
   `venue_flat`, with the slot released. If it finds anything open it observes without trading until the run's
   duration or a `live stop` (after any `live stop` of this run, at once), checks the account again and ends
   `unresolved`: act at Binance and reconcile again.

A run that is flat but failed (exit code 1) takes step 3 alone.

Use one fixed private root for the configured account. The local lock cannot exclude manual trading or
another host. Keep its inputs, native cache, logs and lifecycle originals together; a dead container is
not evidence of a flat account. See [the implementation and storage decision](../docs/plans/binance-live.zh.md).

## History

`runtime.image.LAYOUTS` knows only `replay-contract@v8`; no image or seal of an earlier contract is read
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
